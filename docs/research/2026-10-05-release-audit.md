# Аудит release, bootstrap, rollback, build/deploy и CI — 2026-10-05

## Область и доказательства

Исследован текущий рабочий код dirty workspace, включая незакоммиченные изменения. Источники — собственный исходный код, package-lock и тесты проекта; секреты и live runtime не читались, live daemon не запускался. Номера строк относятся к коду на момент аудита. P1 — блокировка установки/обновления/восстановления; P2 — существенная надежность или неполное покрытие. Ни один пункт не утверждает, что соответствующий отказ уже наблюдается на clean host.

Безопасная локальная проверка на синтетическом временном release подтвердила: `verifyRelease` принимает signed manifest с `await import("./missing.mjs")`; вычисляемый CLI URL bootstrap для `/home/ci/...` содержит `file:////home`, а реальный import.meta.url — `file:///home`. Проверочный файл удален. Полную suite и реальные CI результаты собирает основной аудит; повторный запуск suite здесь не выполнялся.

## Доказанные находки

### R1 — P1: bootstrap bundle не включает обязательный модуль protocol-version

- Источник: `scripts/build-bootstrap-bundle.mjs:29`–`46`; `src/bootstrap.mjs:7`.
- Триггер: распаковка нового bootstrap bundle в пустой runtime и запуск bootstrap.
- Причина: список файлов bundle не включает `protocol-version.mjs`, хотя bootstrap статически импортирует его из своего каталога. Копия в `releases/<id>/src` этот импорт не удовлетворяет. Проверяется только signed release, а целостность stable bundle не проверяется.
- Результат: `ERR_MODULE_NOT_FOUND` до верификации release и до rollback.
- Исправление: собирать stable bundle из единого перечня его транзитивных зависимостей; включить protocol-version; проверять stable граф отдельно. Для существующей Cursor утилиты также обнаружена отсутствующая зависимость: `scripts/build-release.mjs:73` копирует `cursor-egress-apply.mjs`, но не `cursor-proxy-config.mjs`, импортируемый в `src/cursor-egress-apply.mjs:10`. Учитывая пользовательскую цель Codex, решить отдельно, нужна ли эта Cursor утилита в пакете вообще.
- Проверка: построить, распаковать в пустой каталог без исходного repo, запустить bootstrap с синтетическим подписанным child, подтвердить boot и rollback. Тест одного лишь наличия bootstrap-файла в `tests/build-release.test.mjs:18` этого не проверяет.

### R2 — P1: создание candidate release изменяет активный stable runtime

- Источник: `scripts/build-release.mjs:57`–`75`, `:107`–`109`; `src/bootstrap.mjs:56`, `:89`–`92`; `src/release-runtime.mjs:98`–`102`.
- Триггер: построить новый candidate с измененной версией протокола или stable bootstrap в существующий runtime, даже без `--activate`.
- Причина: `copyStable` и перезапись `release-public.pem` выполняются до/независимо от `options.activate`. Stable `protocol-version.mjs` обновляется, пока state.current ссылается на старый release.
- Результат: после рестарта старый current может отвергаться новым stable bootstrap из-за protocol mismatch; переход на previous не помогает, если он имеет прежний протокол. Signed rollback управляет только release directory, а не измененными stable файлами.
- Исправление: build должен создавать независимый candidate; установку stable runtime проводить отдельной версионируемой транзакцией с проверкой совместимости и сохранением старого stable поколения. Согласовать допустимые протоколы current/previous.
- Проверка: build без activate не изменяет ни state, ни stable bytes; candidate с protocol N+1 не препятствует запуску current/previous N; interrupted activation восстанавливается.

### R3 — P1: смена версии протокола блокирует собственный канал deployment

- Источник: `scripts/deploy-release.mjs:73`–`75`; `src/index.mjs:469`–`472`, `:506`; `src/protocol-version.mjs:21`–`30`.
- Триггер: deploy candidate N+1 на clean host, который еще выполняет протокол N.
- Причина: deployment control frame маркируется протоколом candidate, а clean сначала строго сравнивает его с локальным; stage тоже требует локальный протокол. Никакой миграционный control контракт не предусмотрен.
- Результат: clean отклоняет release-stage, dirty ждет acknowledgment до 180 секунд; штатного пути обновления двух сторон через version bump нет.
- Исправление: отделить стабильный deployment control protocol от payload runtime protocol; определить negotiated compatibility/migration и rollback для двух сторон.
- Проверка: интеграционный fixture со старой clean и новой dirty версией проходит stage, coordinated activate и rollback; заведомо несовместимый candidate отклоняется явно до promotion.

### R4 — P1: booted отправляется раньше рабочей готовности, выключая rollback

- Источник: `src/index.mjs:47`–`55`, `:900`–`910`, `:1025`–`1035`; `src/bootstrap.mjs:134`–`137`, `:155`–`161`.
- Триггер: регрессия после импортов/network setup, например отказ открытия dirty HTTP порта или ошибка поздней инициализации; либо candidate бесконечно повторяет Matrix boot.
- Причина: supervisor отправляет booted до загрузки сессии, HTTP сервера, Matrix клиента и RTC; bootstrap начисляет failure только при `!booted`. Последующий crash/retry loop не переключает previous. Зависший после booted child не ограничен startup timer.
- Результат: valid signed release может быть операционно неработоспособным, но автоматический rollback не наступит. Гарантия восстановления <=60 секунд этим механизмом не обеспечивается.
- Исправление: определить критерий локальной готовности и post-activation probation; различать ожидаемый сетевой outage и регрессию candidate, следить за heartbeat, ограничивать repeated exits/hangs в probation и откатывать по наблюдаемому состоянию. Не превращать временный внешний outage в бессистемный rollback.
- Проверка: synthetic child отправляет booted и затем падает/перестает heartbeat; previous действительно запускается в пределах согласованного 60-секундного бюджета. Отдельно тестировать отсутствие сессии и временный Matrix outage.

### R5 — P1: Docker build запускает prepare до копирования tsconfig и src

- Источник: `Dockerfile:5`–`10`; `package.json:12` (`prepare: tsc`).
- Триггер: `docker build` из чистого checkout.
- Причина: слой `npm ci` выполняется после копирования только package files; lifecycle prepare вызывает tsc, а tsconfig и исходники еще не скопированы.
- Результат: сборка контейнера прерывается до явного `npm run build`. Docker build не входит в `.github/workflows/ci.yml:22`–`23`.
- Исправление: копировать необходимые build inputs до install либо явно управлять lifecycle installation и последующим build, сохранив необходимые dependency install scripts.
- Проверка: реальный Docker build из чистого контекста в CI; smoke запуска с synthetic configuration. Дополнительно текущий CMD `node src/index.mjs` не передает сторону, а `src/index.mjs:1025`–`1035` требует `dirty|clean|daemon`: согласовать CMD с HF_SIDE или передавать аргумент. README пример запуска необходимо проверять вместе с образом.

### R6 — P1: потеря одного файла ключа молча заменяет signing identity

- Источник: `src/release-key.mjs:69`–`85`; `scripts/build-release.mjs:108`.
- Триггер: после существующих релизов исчез public PEM или private DPAPI, либо пара сохранена не полностью после прерывания.
- Причина: при отсутствии любого из двух файлов генерируется новая пара, имеющийся файл перезаписывается; build затем устанавливает новый public key в runtime.
- Результат: старые current/previous подписаны прежней identity и перестают проверяться; clean host сохраняет старый trust key и не принимает новые релизы.
- Исправление: fail closed при неполной существующей паре; для восстановления public key вывести его из проверенного private key, когда это возможно; rotation делать явным отдельным протоколом с trust migration и аварийным восстановлением.
- Проверка: удаление одного файла в synthetic key fixture не перезаписывает surviving identity; mismatched pair диагностируется; deliberate rotation сохраняет рабочий previous.

### R7 — P2: staging существующего buildId подтверждает непроверенный старый каталог

- Источник: `src/release-transfer.mjs:50`–`57`.
- Триггер: на clean есть поврежденный `releases/<id>`; отправлен исправный signed архив с тем же id.
- Причина: проверяется incoming staging, затем при существующем destination staging удаляется. Destination не проверяется и не сравнивается с incoming manifest.
- Результат: clean сообщает successful stage, хотя каталог, который затем будет promoted, может быть поврежден или содержать иной valid build с тем же manually supplied id.
- Исправление: проверять существующий destination и сравнивать signed identity/content; поврежденный каталог quarantinе с безопасной заменой, конфликт id — явный отказ.
- Проверка: good duplicate идемпотентен; corrupt duplicate не подтверждается как staged; conflicting signed content с тем же id отклоняется.

### R8 — P2: deploy сообщает успех до проверки нового рабочего канала

- Источник: `scripts/deploy-release.mjs:113`–`128`; `src/index.mjs:517`–`526`.
- Триггер: clean подтверждает state promotion, но после scheduled restart candidate не стартует; dirty restart HTTP возвращает 400/503 либо завершается connection error до выполнения action.
- Причина: `release-activated` отправляется до рестарта, dirty state меняется до acknowledgment, ответ локального HTTP restart не проверяется и любое исключение подавляется. Финальный `ok:true` не зависит от health/RTC/ping нового release. Потеря acknowledgment оставляет state двух сторон частично измененным.
- Результат: формальный успех означает отправку/активацию, а не восстановленный hop; оператор может получить ложное подтверждение обновления.
- Исправление: различить staged/committed/running/healthy; persistent deployment transaction с idempotent retry и rollback; проверять ожидаемое завершение supervisor и buildId обеих сторон через health и RPC ping после reconnect.
- Проверка: lost ack, HTTP non-2xx, failed restart, clean rollback и delayed reconnect приводят к правильному статусу и recovery, не к `ok:true`. End-to-end budget сверить с <=60 секунд.

### R9 — P2: signed package не замыкает runtime зависимости

- Источник: `scripts/build-release.mjs:88`–`96`; `src/release-runtime.mjs:48`–`63`; `src/hf-clean-mcp.mjs:2`–`4`; `src/index.mjs:348`–`350`.
- Триггер: bootstrap bundle установлен на новый host без runtime ancestor node_modules; либо общий node_modules содержит версию, отличную от release package-lock.
- Причина: release содержит src/dist/package files, но не node_modules; bare imports не проверяются verifyRelease. В изученных build/bundle/stage путях нет install dependencies. В рабочем старом runtime ancestor node_modules могут случайно удовлетворять импорты, что не доказывает самодостаточность пакета.
- Результат: signature/hash проверка проходит, а startup падает с missing dependency; rollback application source не возвращает версию общего dependency tree.
- Исправление: явный signed dependency/bundling contract: offline production dependencies в release либо pinned и проверяемое immutable dependency окружение; проверить fresh install отдельно от upgrade.
- Проверка: stage/boot на чистом host без repo и глобальных modules; проверить изменение dependency lock и rollback к прежнему dependency набору.

### R10 — P2: verifyRelease не проверяет dynamic import completeness

- Источник: `src/release-runtime.mjs:15`, `:48`–`63`; `src/index.mjs:348`, `:350`.
- Триггер: подписать release со сломанным dynamic import, либо потерять файл, который находится только динамическим поиском и не вошел в manifest.
- Доказательство: synthetic signed release с `await import("./missing.mjs")` возвращает manifest из verifyRelease без ошибки. Regex охватывает только static import/export, bare package imports сознательно пропускаются.
- Результат: «verified» гарантирует подлинность перечисленных байтов, но не полную исполнимость приложения.
- Исправление: явно ограничить обещание verifier и добавить build graph/bundle validation + isolated packaged startup. Для обязательных динамических entrypoints вести машинно проверяемый перечень.
- Проверка: missing required dynamic module и required bare dependency отвергаются на package gate; optional imports остаются допустимыми.

### R11 — P2: заявленный Node minimum ниже minimum зависимости

- Источник: `package.json:8` (`>=20.3.0`); `package-lock.json:2351`–`2357` (undici 7.29.0 требует `>=20.18.1`).
- Триггер: пользователь устанавливает поддержанный package.json Node 20.3–20.17.
- Результат: install engine warning/failure и потенциальная несовместимость HTTP runtime; CI проверяет latest Node 20, а не объявленную нижнюю границу.
- Исправление: поднять engines до фактического minimum (или pin совместимую зависимость) и синхронизировать docs/.nvmrc/CI.
- Проверка: install/build/network smoke на точной минимальной поддерживаемой версии.

## CI и кроссплатформенность

- До исправлений основным агентом `tests/bootstrap.test.mjs:47` удалял начальный slash у POSIX pathname через `.slice(1)`; исполнялся неверный путь, state не менялся. Корректное преобразование — fileURLToPath. Отдельно product CLI gate `src/bootstrap.mjs` строил `file:////home/...` на POSIX: нужен pathToFileURL. Эти две причины независимы; исправление одного тестового пути не чинит gate.
- `tests/build-release.test.mjs` без platform skip обращался к Windows DPAPI через ensureReleaseKeyPair; POSIX CI не может выполнить такой тест. Честный временный skip допустим, но полноценная цель — portable build fixture с test signer, а DPAPI проверять отдельным Windows интеграционным тестом. `tests/release-transfer.test.mjs:9` уже явно Windows-only.
- CI `.github/workflows/ci.yml` выполняет npm ci и npm test на Ubuntu/Windows/macOS Node 20/22. Не запускает Docker build, fresh bootstrap bundle, multi-version deployment и post-activation health. Поэтому green suite не является release delivery gate.
- Тест rollback покрывает child, падающий до booted. Не покрывает early booted + late crash, heartbeat hang, lost ack, stable protocol replacement, dependency rollback и incomplete signing key.

## Предложенный порядок исправлений

1. Закрыть fresh-install/package gate: stable dependency graph, Docker build, корректный bootstrap CLI, минимум Node.
2. Изолировать build от active runtime и закрепить signing-key identity; определить двухсторонний migration/rollback контракт.
3. Ввести readiness/probation/heartbeat с измеряемым recovery <=60 секунд и честным статусом deployment.
4. Добавить staged artifact identity checks и автономное immutable dependency окружение.
5. Зафиксировать CI gate для распакованного пакета и двух synthetic hosts, затем проверить затронутый live path через clean-pc по package-unit/delivery-gate. До такой проверки live recovery и успех реального deployment остаются непроверенными.
