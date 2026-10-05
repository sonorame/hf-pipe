# Egress и Codex: аудит 2026-10-05

Приоритет: ежедневная работа clean-pc и Codex/Kilo на clean. Источник — текущая рабочая копия, включая незакоммиченные изменения; выводы не означают, что та же версия уже находится на GitHub или в активном runtime. Продукт и живые стороны не изменялись. Секреты не читались, launcher/deployment/KES скрипты не запускались.

## Проверка

Команда `node --test tests/egress-stream.test.mjs tests/egress-qos.test.mjs tests/egress-proxy.test.mjs tests/egress-mux.test.mjs tests/egress-dialer.test.mjs`: **17 passed, 0 failed**, 2026-10-05. Это целевая проверка egress, не полный delivery gate.

Дополнительные изолированные пробы использовали реальные createEgressMux/createQosQueue, фиктивный Duplex и send-функцию; сеть, live runtime и ключи не использовались. Ниже зафиксированы фактические результаты и сценарии повторения.

## Подтверждённые дефекты

### E1 — P1: буфер потребителя не ограничен ACK window

Источники: [src/egress-mux.mjs:179](../../src/egress-mux.mjs#L179), [src/egress-mux.mjs:183](../../src/egress-mux.mjs#L183).

Результат пробы: открыть локальный stream и, не читая его, передать 128 DATA по 65536 байт. `readableLength = 8388608`, `readableHighWaterMark = 16384`, отправлено 128 ACK. Код игнорирует результат `push()` и `socket.write()`, а ACK выдаёт немедленно. Отправитель освобождает окно раньше, чем потребитель освобождает память. Размер загрузки/длительность потока превращаются в размер памяти процесса.

Исправление: определять кредиты в байтах и подтверждать при наличии приёмной ёмкости; учитывать readable backpressure и writable drain. Ограничить буфер на stream и общий буфер всех stream. Проверка: медленный/нечитающий CONNECT потребитель, большой download/upload, несколько одновременных потоков; RAM остаётся в заданном бюджете, RPC отвечает.

### E2 — P1: отмена clean и ошибка dirty не закрывают противоположную сторону

Источники: [src/egress-proxy.mjs:60](../../src/egress-proxy.mjs#L60), [src/egress-mux.mjs:52](../../src/egress-mux.mjs#L52), [src/egress-mux.mjs:167](../../src/egress-mux.mjs#L167), [src/egress-mux.mjs:33](../../src/egress-mux.mjs#L33).

Проба local cancel: `openLocal(); stream.destroy(); await setImmediate` отправила только OPEN (type 20), CLOSE отсутствует. У Duplex нет destroy/close hook для освобождения local map и уведомления peer. Закрытый клиент оставляет dirty TCP до внешнего EOF/timeout или закрытия всей трубы.

Проба remote error: после OPEN на fake socket отправить `socket.emit('error', Error('ECONNRESET'))`. Socket уничтожен, отправленных frames нет. Clean не получает CLOSE и может ждать до собственного application timeout.

Исправление: единое идемпотентное завершение stream, `_destroy` и socket error/close hooks; посылать CLOSE при локальной ошибке/отмене, исключая цикл после полученного CLOSE. Проверка: cancellation, ECONNRESET, закрытие до dial completion, потеря RTC; обе стороны и все callbacks освобождаются.

### E3 — P1: QoS привязывает ошибку к чужому отправителю

Источники: [src/egress-qos.mjs:12](../../src/egress-qos.mjs#L12), [src/egress-qos.mjs:22](../../src/egress-qos.mjs#L22), [src/rtc-pipe.mjs:391](../../src/rtc-pipe.mjs#L391).

Проба: поставить stream job, заблокировать его через promise, вызвать flush A; добавить RPC job, который бросает `Error('rpc failed')`, вызвать flush B; отпустить stream. Результат: A отклонён `rpc failed`, B успешно завершён. flush — promise всей очереди, а не конкретного job. Успешный stream может получить чужую ошибку и уничтожиться, RPC send не получает свою ошибку и дожидается общего timeout.

Исправление: push/enqueue возвращает отдельный promise задания; worker разрешает/отклоняет его после отправки. Проверка: отказ второго job не портит первый, каждый promise соответствует своему job, очередь продолжает работать после исключения.

### E4 — P1: CONNECT подтверждается до реального TCP connect, у dial нет deadline

Источники: [src/egress-mux.mjs:87](../../src/egress-mux.mjs#L87), [src/egress-mux.mjs:121](../../src/egress-mux.mjs#L121), [src/egress-proxy.mjs:56](../../src/egress-proxy.mjs#L56), [src/rtc-pipe.mjs:276](../../src/rtc-pipe.mjs#L276), [src/rtc-pipe.mjs:398](../../src/rtc-pipe.mjs#L398).

Проба повторяет реальную асинхронную доставку: send запускает peer.onFrame, но не ждёт его обработки; connectTcp возвращает никогда не завершающийся promise. `openLocal` уже вернул `{ok:true}`; dirty dial не завершён. CONNECT proxy на этом основании посылает HTTP 200. Реальный sendQos ждёт отправку OPEN, не результат подключения. Клиент получает ложную готовность, а pending remote stream и ранние TLS bytes остаются в памяти. Dial имеет лишь connect/error listeners, без timeout/cancel. remote queued не имеет лимита.

Исправление: явное STREAM_OPEN_OK/ERROR и ожидание результата с deadline; cancel dial при закрытии клиента/сессии, ограничить число pending dials и bytes до OPEN_OK. Менять контракт и подписанный пакет обеих сторон согласованно. Проверка: DNS failure, ECONNREFUSED, silent dial, клиент отменил ожидание, reconnect во время dial; до OPEN_OK нет 200, timeout предсказуем, pending resources равны нулю.

### E5 — P2: настроенный порт runtime не доходит до Codex/Kilo launcher

Источники: [src/cursor-proxy-config.mjs:8](../../src/cursor-proxy-config.mjs#L8), [src/rtc-pipe.mjs:419](../../src/rtc-pipe.mjs#L419), [src/codex-egress.ps1:3](../../src/codex-egress.ps1#L3), [src/kilo-codex-launch.ps1:3](../../src/kilo-codex-launch.ps1#L3).

Проба `egressPort({HF_EGRESS_PORT:'19000'})` вернула 19000. Оба launcher жёстко задают 18766, в том числе settings, process env и Chromium argument. Изменение поддерживаемого runtime параметра ломает оба приложения.

Исправление: один источник портов, явный параметр launcher или чтение валидированной runtime конфигурации; проверить port collision/range. Проверка: default и нестандартный port, реальный CONNECT и запрос Codex через каждый.

### E6 — P2: ярлык закрепляет launcher из конкретного release

Источники: [src/codex-egress.ps1:29](../../src/codex-egress.ps1#L29), [src/codex-egress.ps1:33](../../src/codex-egress.ps1#L33), [src/kilo-codex-launch.ps1:26](../../src/kilo-codex-launch.ps1#L26), [docs/codex-egress.md](../codex-egress.md).

Документация запускает script из `releases/<current>/src`. Ярлык записывает `$PSCommandPath` этого script. Следующая активация runtime сама не изменяет ярлык: изменения модели/CA/proxy в новом launcher не применяются; удаление старого release ломает запуск. Это подтверждённая зависимость путей; удаление release и upgrade на live в рамках аудита не выполнялись.

Исправление: стабильный wrapper, который каждый запуск разрешает текущий проверенный release, или обновление ярлыков как часть двухсторонней активации. Проверка: создать ярлык в release A, активировать B с отличающимся launcher, удалить A; запускается B.

### E7 — P2: stage-codex-egress не собирает текущую рабочую копию целиком

Источники: [scripts/stage-codex-egress.mjs:26](../../scripts/stage-codex-egress.mjs#L26), [scripts/stage-codex-egress.mjs:27](../../scripts/stage-codex-egress.mjs#L27), [scripts/build-release.mjs:103](../../scripts/build-release.mjs#L103).

Stage script копирует текущий live release и накладывает только `egress-dialer.mjs`, `egress-mux.mjs`, `codex-egress.ps1`. Изменённый `kilo-codex-launch.ps1`, другие egress dependencies, scripts/docs/tests и package metadata туда не попадают. Подпись подтверждает собранный гибрид, но не соответствие текущему исходному commit/tree. Сценарий: поменять Kilo launcher и запустить этот stage; новый launcher не окажется в пакете. Скрипт не запускался, поскольку он читает ключ и пишет live.

Исправление: один воспроизводимый build-release от выбранного source tree; provenance commit/tree digest, список dirty изменений и manifest сравнение. Разовые overlay scripts вынести из обычного delivery path. Проверка: изменение любого runtime source влияет на buildId и включается в пакет; отсутствие файла/несовпадение provenance блокирует stage.

## Ограничения и следующие проверки

1. Гарантии reconnect требуют проверки с управляемым каналом: QoS глобален; sendChunked читает глобальный `dc` после await, очередь не отменяется в closePc. Источники: [src/rtc-pipe.mjs:28](../../src/rtc-pipe.mjs#L28), [src/rtc-pipe.mjs:108](../../src/rtc-pipe.mjs#L108), [src/rtc-pipe.mjs:378](../../src/rtc-pipe.mjs#L378). Риск пересылки старых jobs/частей сообщений в новый session выведен из кода, отдельный live/интеграционный воспроизводитель здесь не выполнен. Исправление: generation-bound jobs, cancel queue/waiters/parts на disconnect; RPC failure должен возвращаться сразу, а не через 30 секунд.
2. Launcher читает VS Code settings через ConvertFrom-Json и переписывает весь объект. Для Windows PowerShell 5.1 нужно проверить реальные JSONC settings с comments/trailing commas и нестандартный путь VS Code. Источники: [src/codex-egress.ps1:14](../../src/codex-egress.ps1#L14), [src/kilo-codex-launch.ps1:13](../../src/kilo-codex-launch.ps1#L13). PowerShell на dirty известен как зависающий; эта ветка не объявлена воспроизведённой.
3. TLS проверка: Kilo launcher передаёт отдельный CA bundle, Codex launcher такого пути не задаёт. Это разница реализации, не доказательство сбоя Codex. Нужен реальный OpenAI OAuth + ответ из официального Codex, отдельно от Kilo; CA/проверка имени включены, без переноса auth с dirty. Источники: [src/kilo-codex-launch.ps1:15](../../src/kilo-codex-launch.ps1#L15), [src/codex-egress.ps1](../../src/codex-egress.ps1), [docs/codex-egress-validation.md](../codex-egress-validation.md).
4. Документ validation перечисляет несколько моделей по ходу проверки, а основной launcher содержит другой финальный каталог. Сохранить единый финальный результат с buildId, версией backend/provider, моделью, временем, результатом и отдельным evidence file. Старые эксперименты явно отделить от актуальной конфигурации.
5. Для аналитики release readiness нужны stream counters: active/pending dials, queued bytes, ACK age, dial latency, timeout/error reasons, proxy app status. `egress open` означает создание stream, а не успешный dial/авторизацию/ответ модели.

## Порядок исправлений

Сначала E2/E3 и отмена jobs при reconnect: убрать зависания и потерю корректной связи ошибки с запросом. Затем E1/E4: реальный flow control, bounded ресурсы и OPEN handshake. После этого E5/E6/E7: единая конфигурация, устойчивый launcher и воспроизводимая выкладка. Все изменения stream-контракта доставлять целыми подписанными пакетами обеих сторон; acceptance включает параллельный clean_shell/clean_read и настоящий запрос Codex/Kilo при download, cancellation и reconnect.
