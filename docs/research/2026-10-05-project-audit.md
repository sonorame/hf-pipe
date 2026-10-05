# hf-pipe: аудит и план исправлений, 2026-10-05

## Согласованная цель

Ежедневная надежная работа clean-pc и Kilo с подпиской ChatGPT на clean host. Cursor не входит в приоритет исправлений. После сбоя труба должна самостоятельно восстановиться за 60 секунд. Запрос Kilo ожидает восстановления в пределах общего бюджета 60 секунд, затем завершается понятной ошибкой; бесконечное ожидание не допускается. Обновление GitHub main должно включать четыре существующих feature-коммита и незакоммиченные доработки Codex после проверки. Публикация исходников и выкладка live runtime - разные операции.

## Наблюдаемое состояние

- GitHub repository приватный, default branch `main`, ветки `master` нет. На начало аудита main=`b3315be`, feature head=`f35d0fa`; main отстает на четыре коммита. PR #3 содержит эти коммиты, все шесть CI jobs красные: https://github.com/sonorame/hf-pipe/pull/3 .
- Исходная рабочая копия: `feat/cross-platform`, незакоммиченные изменения source/tests/scripts и новые Codex файлы. Они сохранены; для публикации подготовлена отдельная ветка `codex/main-refresh` в отдельной копии.
- Первоначальный полный локальный `npm test`: 246 тестов, 241 pass, 5 fail. Четыре ошибки PowerShell/DPAPI/archive timeout, один failure персонального пути в tracked скрипте. Прогон в ограниченной оболочке до этого был невалиден из-за `uv_os_get_passwd ENOMEM`; он не использован как результат продукта.
- GitHub CI 2026-10-01: Windows 223/224, Linux/macOS 218 pass, 3 fail, 3 skip. Причины: персональный путь; непереносимый bootstrap test path и bootstrap CLI URL; Windows DPAPI в portable build test.
- Живые стороны сообщили build `a3b26f918be515b1`, protocol `2`. Source default protocol `3`: обновлять live только целым согласованным пакетом. Во время аудита `clean_context` сначала возвращал `rtc down`, затем самостоятельно восстановился. По журналу между heartbeat miss 05:57:54.809 UTC и DC open 06:00:10.695 UTC прошло 135.886 секунд. Это один наблюдаемый эпизод, не статистика доступности; целевой бюджет 60 секунд не выполнен. После него `clean_context` и `clean_shell hostname` успешно ответили.

## Доказательная база

Аудит использует исходный код, полный тестовый прогон, GitHub CI logs, read-only live health и изолированные пробы. Подробные причины, строки, сценарии и предлагаемые проверки:

1. [Транспорт, авторизация, RPC и ресурсы](2026-10-05-transport-audit.md): T1-T9.
2. [Egress и Kilo/Codex](2026-10-05-egress-audit.md): E1-E7.
3. [Release, bootstrap, rollback, Docker и CI](2026-10-05-release-audit.md): R1-R11.
4. [Изолированный воспроизводитель](probes/transport-audit.mjs): отмена stream, рост памяти, ошибка QoS, ложный status и коллизия IPC id; без сети и секретов.

Подотчеты содержат 27 записей; T2/E1, T3/E2 и T4/E3 описывают одинаковые дефекты. Это 24 отдельных пункта до дополнительной проверки зависимостей и наблюдаемого recovery. Source-аудит не доказывает успешную внешнюю эксплуатацию. Гипотезы про reconnect, JSONC и официальный Codex отделены от воспроизведенных дефектов.

## Пять приоритетных пакетов исправлений

### 1. Авторизовать peer и убрать зависимость HTTP от известных уязвимостей

**Приоритет P1, начать первым; нет зависимостей.**

- T1: входящий Matrix to-device event не проверяется по реальному sender/доверенному peer; `env.from` используется как заявленная identity. Проверять sender пользователя и доверенное устройство до SDP, ICE и release controls. Недостаточно совпадения protocol или имени устройства. Crypto/trust contract должен быть явно описан. Потенциальное последствие - чужой control/RTC путь к shell; живой exploit не выполнялся.
- Production `npm audit --omit=dev` выявил две уязвимые прямые зависимости: `undici@7.29.0` и `matrix-js-sdk@37.13.0`. Для undici особенно релевантны RetryHandler и decompress, поскольку hf-pipe использует RetryAgent/fetch. WebSocket/BalancedPool advisories не являются доказанной уязвимостью именно hf-pipe: эти пути отдельно не подтверждены. Matrix room-upgrade advisory имеет меньшую прямую применимость, поскольку hop filter исключает rooms.
- R6: неполная signing key pair должна приводить к явному отказу или восстановлению public key, а не молчаливому созданию новой identity. Ротацию ключа выполнять отдельным проверяемым переходом доверия.

**Проверка приемки:** чужой Matrix sender/device не меняет RTC state, не исполняет jobs и не принимает release; missing/mismatched key не перезаписывает trust; обновленные библиотеки проходят network-policy/Matrix/RTC regression и живой Kilo путь. Минимальный Node синхронизирован с lockfile, README и CI.

### 2. Сделать egress ограниченным по памяти и корректным при отмене

**Приоритет P1; можно начинать независимо от пакета 1.**

- T2/E1: ACK выдается без учета `push()`/`write()` backpressure. Проба накопила 6.55 MB при highWaterMark 16 KB; другая - 8 MiB и 128 ACK без чтения. Нужны byte credits и лимиты stream/общей памяти.
- T3/E2: destroy клиентского tunnel и error удаленного TCP не уведомляют противоположную сторону. Ввести единое идемпотентное завершение и освобождение callbacks/maps/socket/queues.
- T4/E3: QoS flush promise относится к всей очереди; ошибка второй задачи отклоняет promise первой, а вторая получает resolved. Каждая отправка должна иметь собственный promise и result.
- E4/T9: OPEN не подтверждает успешный TCP dial, CONNECT возвращает 200 раньше готовности; dial/header/body/pending stream не имеют общего ограниченного бюджета. Нужны OPEN_OK/ERROR, deadline/cancellation и ресурсные пределы.
- T6: RTC reassembly и очереди должны быть ограничены и привязаны к session epoch; jobs прошлого поколения не должны попасть в новый DC.

**Проверка приемки:** большой upload/download и Kilo streaming параллельно с shell/read не увеличивают RAM без лимита; cancel/error освобождают обе стороны; каждое job получает собственную ошибку; failed dial никогда не подтверждается 200; смена RTC поколения не переносит старые frames.

### 3. Согласовать RPC deadline, готовность и восстановление за 60 секунд

**Приоритет P1; зависит от корректной отмены пакета 2 для общей приемки.**

- T5: worker parentRpc имеет жесткий срок 120 секунд, clean shell/lab допускает больший timeout, execution использует sync shell. Передавать end-to-end deadline и request identity; отделить долгие jobs от event loop; явно определить результат неизвестного завершения вместо слепого retry побочных эффектов.
- T7/T8: status не должен превращать `up:false` + stale `dc:open` в ready; task.id не должен одновременно быть IPC request id. Независимые IPC IDs и корреляция late responses.
- R4: `booted` отправляется до реальной готовности и выключает rollback; нужен локальный readiness и probation с heartbeat, отличающий release-регрессию от внешнего network outage.
- Наблюдаемый recovery 135.886 секунд не укладывается в требование. Зафиксировать временной бюджет обнаружения, Matrix offer/answer, TURN/DC, worker restart и подтверждения ping; измерять весь путь. Нельзя исправлять это простым уменьшением таймера без причин и теста сделки offer/answer.
- T9: MCP status/ask должны иметь ограниченный deadline, проверяемый timeout range и явный abort; добавить counters pending RPC, ACK age, queued bytes, reconnect duration и причины ошибок.

**Проверка приемки:** после управляемого DC/worker/supervisor сбоя clean_context, shell/read и новый Kilo запрос возвращаются за <=60 секунд без ручного вмешательства; долгий shell не блокирует heartbeat, не дублируется и не теряет результат; статус соответствует реальному ping.

### 4. Сделать release транзакцией двух сторон с работающим rollback

**Приоритет P1; схема доверия из пакета 1 нужна до production выкладки.**

- R1/R9/R10: stable bundle и dependency graph должны быть полными, включая protocol-version и обязательные dynamic/bare imports; signature/hash подтверждают байты, но не исполнимость. Проверять fresh host без source repo и случайного ancestor node_modules.
- R2: build без activate сейчас изменяет stable runtime и trust key. Candidate должен быть независим; stable generation и compatible previous сохраняются транзакционно.
- R3: deployment control protocol не должен отвергать candidate N+1 до возможности его staging. Нужен согласованный migration/compatibility contract обеих сторон.
- R7/R8: existing staged destination тоже проверять; различать staged/committed/running/healthy. Потерянный ack, non-2xx restart и частичный promotion должны иметь идемпотентное продолжение или rollback, а не `ok:true`.
- E7: overlay текущего live release с несколькими source файлами не равно build текущего source tree. Единая сборка с commit/tree provenance, полный signed package и проверка фактического worker path обеих сторон.

**Проверка приемки:** fresh install, protocol migration N->N+1, corruption, partial activation, lost ack, interrupted boot и откат воспроизводятся; после каждой успешной операции совпадают build/protocol и проходят ping+Kilo. Никаких частичных подмен src/dist в live.

### 5. Упростить Kilo launcher и сделать поставку воспроизводимой

**Приоритет P2; полная приемка после пакетов 2 и 4.**

- E5: launcher и runtime берут proxy port из разных источников. Один валидируемый параметр, проверка стандартного и нестандартного порта.
- E6: shortcut привязан к конкретному release. Stable wrapper должен разрешать current verified release при запуске; upgrade/GC не ломает ярлык.
- R5: Docker install prepare запускается до копирования build inputs; CMD не согласован со стороной. Проверять настоящий Docker build/start в CI, либо явно сузить поддерживаемую поставку до Windows runtime.
- R11 и CI: заявленный Node minimum ниже требований lockfile. Переносимые package tests должны действительно выполнять signed build, а Windows DPAPI тесты оставаться отдельными на Windows. Минимальный Node и матрица проверок должны соответствовать зависимостям.
- Документация Kilo должна содержать один актуальный validation record: buildId/protocol/backend/provider/model/time/result и сохраняемый evidence. Реальные JSONC settings, CA bundle, OAuth, cancel/stream/reconnect проверять отдельно; наличие CONNECT 200 или расширения не доказывает ответ модели.

**Проверка приемки:** чистая установка Kilo profile, ChatGPT OAuth, реальный ответ модели, streaming/cancel, нестандартный port и upgrade без ручного обновления ярлыка; локальные модели и существующий профиль сохраняются.

## Дополнительные улучшения архитектуры

Не начинать с большого переписывания. Сосредоточить изменения вокруг четырех малых интерфейсов: authenticated peer session; cancellable stream с bounded byte credits; asynchronous job с deadline/result identity; coordinated release transaction с health/rollback. Тестировать поведение через эти же интерфейсы, а не regex presence исходника. Структурные проверки существующих tests полезны, но не заменяют аварийные сценарии.

## Публикация и ограничения проверки

Минимальные исправления публикации в отдельной копии: fileURLToPath в bootstrap test, pathToFileURL в bootstrap CLI, переносимый signed build test с временной Ed25519 парой вместо зависимости от Windows DPAPI, удаление персонального пути из комментария. Minimum Node поднят до 22, README/CONTRIBUTING/package-lock согласованы, CI проверяет Node 22/24 на трех ОС. Windows key/refresh/archive тесты сохранены. Изменение signing dependency не хранит тестовый private key в runtime и не меняет штатный DPAPI путь. Независимая проверка двух измененных package/bootstrap тестов: 2/2 pass, без skips.

Подготовленная копия прошла clean npm ci и build. Повторный полный локальный suite: 246 tests, 243 pass, 3 fail; оставшиеся Windows DPAPI/refresh/archive тесты не завершились из-за зависающего PowerShell на dirty. Это ограничение локальной проверки сохранено явно; окончательная CI проверка проводится на GitHub, включая обе Windows jobs. Живой runtime не обновлялся в ходе этого аудита.

Свежая проверка Kilo 7.3.54/OpenAI через существующий live runtime выполнена повторно на отдельном тестовом порту: GPT-6 Astra и GPT-6 Luna вернули `PIPE_OK`, `error:null`. Первая попытка завершилась до inference из-за занятого диагностического порта 18102; повтор использовал 18243 и отдельные файлы результата/журнала. Models catalog request к models.dev получает 403 по существующей allowlist; это не помешало двум inference запросам с явно заданным каталогом. Backend использовал существующий ChatGPT OAuth и проверку TLS с отдельным CA bundle; auth не переносился. Запросы не вызывали инструменты и не меняли рабочие файлы. Это проверка текущего live пакета, не доказательство fresh deployment подготовленного source tree.

## Первичные внешние источники

- [undici RetryHandler pending response body, patched 7.29.1](https://github.com/advisories/GHSA-pmjh-fq2x-6v4x): релевантный класс зависания при retry, проверять на используемом RetryAgent.
- [undici unbounded decompression, patched 7.29.1](https://github.com/advisories/GHSA-3xpg-4rpp-hhhm): риск потребления ресурсов HTTP responses; applicability требует учета фактических ответов.
- [matrix-js-sdk room upgrade validation, fixed >=38.2.0](https://github.com/advisories/GHSA-mp7c-m3rh-r56v): зависимость затронута по версии, но rooms не используются в hop traffic.
- [Skills Matt Pocock](https://github.com/mattpocock/skills/tree/main): grill-me делегирует grilling; использованы research и codebase-design для сбора первичных доказательств и проектирования следующих исправлений. Другие полезные навыки уже установлены.
- [i-have-adhd](https://github.com/ayghri/i-have-adhd): установлен и применяется к общению в этом чате.
