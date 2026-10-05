# hf-pipe: аудит транспорта, RPC и Codex egress

Дата: 2026-10-05. База исходников: рабочая копия, HEAD `f35d0fa721a5ccf4efc60a654d64febce3130751`. Фокус: ежедневные операции clean-pc, восстановление трубы, выход Codex через грязную. Cursor не входит в приоритеты.

Проверка read-only относительно продукта и live: читались исходники и тесты; запускался только изолированный воспроизводитель с fake IPC и in-memory streams. Реальную чистую сторону, TURN, Matrix и Codex endpoint этот аудит не проверяет: родительская задача сообщила `clean_context: rtc down`. Секреты не читались. Дефекты ниже относятся к исходникам; соответствие установленному пакету требует отдельной проверки обеих сторон.

## Сначала исправить

### T1 — P1: Matrix-вход не проверяет отправителя

- Источник: `src/index.mjs:740–746` принимает совпадающий type и envelope; `src/index.mjs:279–286` проверяет только поля `hf/lane/frame`; `src/index.mjs:699–700` доверяет `env.from` и записывает его как `incomingPeer`; `src/index.mjs:323–328` использует его в discovery. `src/matrix/client.ts` создаёт клиент без инициализации Rust crypto. `src/protocol-version.mjs:26–37` проверяет только число версии протокола.
- Триггер: to-device событие нужного типа от другого Matrix-отправителя, с корректным envelope/protocolVersion. Код передаёт его в RTC/control независимо от event sender; clean обрабатывает offer. Метаданные версии сборки не удостоверяют отправителя.
- Последствие: отсутствует проверка границы доверия для сигнализации, управления релизами и peer discovery. Подмена RTC peer потенциально открывает доступ к clean RPC с shell/write. Полный внешний сценарий эксплуатации не выполнялся, поэтому успешный RCE не утверждается.
- Исправление: сверять Matrix event sender с ожидаемым account; привязать сигнализацию к конкретной доверенной паре устройств и удостоверять envelope криптографически либо проверяемой E2EE device identity; не брать peer identity из непроверенного `env.from`. Контракт должен отвергать неизвестного отправителя до изменения состояния.
- Тест: foreign sender с настоящей protocolVersion не меняет peerCache, не достигает RTC/control, не вызывает promoteRelease; доверенная пара успешно восстанавливает RTC после перезапуска. Проверить отдельно plaintext rejection и sender/device binding.

### T2 — P1: egress ACK не учитывает скорость получателя, память не ограничена

- Источник: `src/egress-mux.mjs:179–184`: результат `stream.push()` и `socket.write()` игнорируется; ACK отправляется сразу, включая `rem.queued` до подключения. `src/egress-stream.mjs:72–100` ограничивает только число ещё не подтверждённых пакетов, не байты в consumer buffer.
- Триггер: быстрая загрузка Codex/расширения при медленном либо остановленном клиенте, либо клиент посылает данные, пока dirty TCP dial ещё не завершён.
- Воспроизведение: 100 входящих DATA по 65536 байт дают `readableLength=6553600` при `readableHighWaterMark=16384`; все DATA немедленно ACK. ACK-window больше не ограничивает память по всей цепочке.
- Исправление: кредит на байты, задержка подтверждения до разрешённого приёма, учёт `push=false`/`write=false`, ожидание consumer read/drain и жёсткая граница queued bytes на поток и на процесс. Одного `pause()` на upstream TCP недостаточно, если remote ACK продолжает освобождать окно.
- Тест: при остановленном consumer память остаётся ограниченной; после возобновления все байты сохраняются; одновременно ping/shell остаются отзывчивыми. Проверять обе стороны и pending dial queue.

### T3 — P1: отмена клиентского CONNECT не закрывает удалённый TCP

- Источник: `src/egress-proxy.mjs:64` уничтожает local stream при close клиентского socket. `src/egress-mux.mjs:52–83` имеет final/error, но не close/destroy cleanup; `drop()` в строках 33–47 не отправляет CLOSE. Remote socket слушает end/error, но не close (`163–167`).
- Триггер: пользователь отменяет ответ, Codex перезапускается либо локальный socket закрывается без normal writable final.
- Воспроизведение: `stream.destroy()` не отправляет TYPE_STREAM_CLOSE; затем mux принимает и ACK 100 DATA для уже уничтоженного stream. Local map сохраняет поток до общего recycle; dirty connection может оставаться открытым.
- Исправление: единый идемпотентный lifecycle потоков с propagation CLOSE на local destroy/error и remote error/close; удаление обеих записей и остановка pending callbacks/dial. Различать нормальный EOF и abort, чтобы не обрезать буферизованный ответ.
- Тест: отмена во время TLS/SSE, local error и remote reset закрывают второй socket и убирают state без ожидания RTC recycle; normal peer-end сохраняет все байты.

### T4 — P1: очередь QoS приписывает ошибку другой операции

- Источник: `src/egress-qos.mjs:13–32` flush возвращает результат всей очереди, а не конкретного job. `src/rtc-pipe.mjs:391–395` sendQos обещает завершение flush отправителю каждого frame.
- Триггер: первый job ожидает освобождения транспорта, второй уже поставлен в очередь и падает при отправке (например, DC закрылся).
- Воспроизведение: первый flush получает rejected от ошибки второго job, второй flush получает resolved. Это воспроизведено без сети.
- Последствие: RPC/stream может сообщить успех отправки потерянного frame либо ошибку успешного frame; нарушается причинная связь failure/caller и восстановление.
- Исправление: каждому queued job дать собственные resolve/reject; scheduler продолжает/завершает очередь по явной политике, но promise отправки принадлежит конкретному frame. При закрытии транспорта отвергать все ещё не выполненные jobs.
- Тест: ошибка второго job отклоняет только promise второго; pending остальные явно завершаются/отклоняются, без зависших jobs; повторить при RTC recycle с одновременно RPC и DATA.

### T5 — P1: несогласованные дедлайны RPC и риск повторного побочного эффекта

- Источник: `src/rtc-worker.mjs:20–28` parentRpc всегда timeout 120000 ms. `src/hf-clean-mcp.mjs:149–155` clean_shell допускает произвольный integer timeout и внешний бюджет t+3 sec. `src/clean-jobs.mjs:94–112` команда выполняется execSync с пользовательским timeout. `src/rtc-pipe.mjs:299–325` вызывает onRpc без журнала idempotency. `src/index.mjs:758–763` отмечает hotfolder frame seen только после ответа.
- Триггер: shell/lab команда идёт >120 sec или выполняет запись, а ответ теряется/RTC перезапускается. RPC таймаут означает отсутствие ответа, а не подтверждённую отмену выполнения. В случае hotfolder исходный frame остаётся непринятым и может выполняться повторно после восстановления.
- Последствие: пользователь видит supervisor timeout при ещё выполняющейся работе; автоматический либо ручной retry способен повторить изменение. Для стандартного shell timeout=120 sec также отсутствует запас на завершение/IPC после исполнения.
- Исправление: единый абсолютный deadline через HTTP→IPC→RTC→job, отдельная отмена, журнал job ID со статусом running/completed и повторной выдачей результата. Для операций с побочными эффектами выдавать ambiguous completion и проверять состояние перед retry. Выполнять shell в асинхронном управляемом процессе, сохраняя event loop supervisor.
- Тест: команда 130 sec при разрешённом бюджете завершается нормально; потеря ответа после write не повторяет write; после reboot результат запроса того же ID восстанавливается. Проверить очередь и отмену вместе с heartbeat.

### T6 — P1: RTC reassembly не ограничена и не проверяет геометрию frame

- Источник: `src/rtc-pipe.mjs:217–247` unpack принимает любой total/offset, takeComplete копит chunks по ID без TTL, предела и проверки type/total consistency; завершение определяется суммой длин, а не отсутствием gaps/overlaps. `src/rtc-pipe.mjs:108–129` closePc не очищает parts/waiters.
- Триггер: неполный большой RPC/stream frame перед обрывом канала; malformed frame от peer; overlap или offset вне declared total.
- Последствие: незавершённые данные переживают recycle и копят память; могут создаваться большие allocation, заполненные нулями gaps или truncation. Исключения takeComplete не перехвачены в dc.onmessage. Наличие отдельного лимита Matrix MAX_EVENT эту RTC-границу не защищает.
- Исправление: max logical payload по типу, bound количества/байтов partial assemblies, TTL, строгая проверка offsets/length/type/total и contiguous coverage; key включает session epoch/type/ID; очищать assemblies и сразу отвергать waiters при смене session.
- Тест: malformed/gapped/overlap/huge declarations отвергаются до allocation; 1000 incomplete IDs остаются в фиксированном budget; recycle очищает partials и отклоняет RPC немедленно. Изолированный source review; опасные allocation не запускались.

## Затем исправить

### T7 — P2: supervisor теряет реальное состояние RTC

- Источник: `src/rtc-worker.mjs:66–67` публикует `up: isRtcUp()`, но `src/rtc-worker-client.mjs:16–20,54,113` игнорирует up и определяет доступность только `snapshot.dc === open`. Настоящий `src/rtc-pipe.mjs:328–337` также требует connected peer и dcOpen.
- Триггер: data channel ещё open, но ICE/peer disconnected/failed. Также last snapshot может устареть, если worker завис без exit.
- Воспроизведение: status `{up:false,snapshot:{dc:'open',connection:'disconnected'}}` приводит к `client.isRtcUp() === true`.
- Исправление: хранить опубликованный worker up вместе с timestamp; после допустимого окна свежести считать состояние unavailable. Дать supervisor независимый heartbeat worker и lifecycle generation.
- Тест: dc=open+disconnected => down, устаревший snapshot => unavailable; HTTP status и clean-pc до вызова показывают правдивое состояние; connected fresh status => up.

### T8 — P2: task.id используется как IPC ID, параллельные запросы конфликтуют

- Источник: `src/rtc-worker-client.mjs:64–71` pending map keyed frame.id, перезаписывается вторым вызовом; timer первого удаляет запись с тем же key.
- Триггер: одновременно два вызова с одинаковым caller task.id, например повторная отправка hotfolder/HTTP клиента.
- Воспроизведение: два calls с ID same, один call-result: p2 resolves, p1 times out. При другом порядке таймер первого может убрать waiter второго до ответа.
- Исправление: независимый randomUUID IPC requestId, task.id остаётся business ID; explicit dedup бизнес-операции должен происходить на clean исполнителе, а не неявной перезаписью promise.
- Тест: два concurrent одинаковых task.id имеют разные IPC IDs и правильные ответы; late response/timer первого не влияет на второй.

### T9 — P2: локальные HTTP/MCP вызовы не имеют общего ограничения времени и размера

- Источник: `src/hf-clean-mcp.mjs:29–47,129` fetch status/ask без AbortSignal. `src/index.mjs:543–559` readJsonBody читает без max body; `666` передаёт Number(X-Timeout) без finite/min/max проверки. `src/egress-proxy.mjs:24–76` не задаёт timeout для CONNECT header/onConnect; `src/rtc-pipe.mjs:398–409` TCP dial без явного connect timeout.
- Триггер: локальный сервис зависает; клиент посылает большой body, бесконечный/некорректный timeout; TCP target не отвечает.
- Последствие: заявленные clean_* timeout не ограничивают fetch/status; очередь pending dials/HTTP buffers может продолжать расти. Loopback снижает внешнюю достижимость, но не исправляет зависание собственного клиента.
- Исправление: проверять timeout finite+range, ограничить body и количество concurrent operations; status имеет короткий AbortSignal, ask общий deadline+abort; TCP dial уничтожает socket по timeout; header timeout и stream idle policy согласованы с долгими Codex SSE.
- Тест: fake server never replies => tool заканчивает в установленном бюджете; oversized body =>413; NaN/negative/Infinity timeout=>400; stalled TCP dial очищает state и не блокирует RPC.

## Воспроизводимость и ограничения

Изолированный воспроизводитель: `docs/research/probes/transport-audit.mjs`. Запуск: `node docs/research/probes/transport-audit.mjs` из корня. Он не открывает сетевые соединения, не исполняет shell jobs, не использует session/env secrets и не меняет продукт.

Фактический вывод 2026-10-05:

```text
destroy sends CLOSE: false
ACKs after local destroy: 100
unread stream buffered bytes: 6553600 highWaterMark: 16384
QoS attribution: [ 'first rejected', 'second resolved' ]
worker says up=false, client says: true
p2 resolved
p1 timed out
```

Текущие `tests/egress-mux.test.mjs`, `tests/egress-qos.test.mjs`, `tests/rtc-worker-client.test.mjs` покрывают нормальную пересылку, приоритет очереди и базовый IPC. У них нет перечисленных выше slow-consumer/abort/per-job-failure/reused-ID сценариев. Весь suite в рамках данного подаудита не запускался; это отдельная проверка родительской задачи. Успешность существующих unit tests не снимает воспроизведённые контрактные ошибки.

Для принятия исправлений нужен общий подписанный пакет обеих сторон и живой прогон: clean_context, ping, shell, read/write, Codex streaming/download, отмена ответа, обрыв TURN/RTC, перезапуск worker и supervisor, восстановление без дублей. Исправление одного файла в установленном pack не даёт проверенного состояния всей трубы.
