# Matrix TLS: доверие ОС и восстановление после обновления CA

Дата: 2026-10-05. Исследование исходников и официальной документации; runtime, CA stores и исходники продукта не изменялись.

## Что известно об инциденте

По доказательствам родительской задачи clean получала `SELF_SIGNED_CERT_IN_CHAIN` с 06:16 UTC до штатного перезапуска в 06:39 UTC; после него тот же live build работает. Это согласуется с устаревшим trust snapshot, но **не доказывает обновление системного CA**: также возможны смена предъявленной цепочки, восстановление HTTPS inspection или иной сетевой маршрут. Для различения нужны fingerprints issuer/root до и после и сравнение старого процесса со свежим probe в момент отказа. Источник времён — родительская диагностика; этот подаудит не перечитывал секреты или clean logs.

## Подтверждённая семантика Node

`tls.getCACertificates('system')` доступна с **22.15.0** и во всей ветке 24; `setDefaultCACertificates()` — с **22.19.0 / 24.5.0**. Для программной загрузки system trust декларации `node >=22.0.0` недостаточно. Лучше поднять minimum до 22.15 либо явно поддержать старые версии через утверждённый PEM bundle; молча продолжать без нужного CA нельзя. [Node 22.18 TLS API](https://nodejs.org/download/release/v22.18.0/docs/api/tls.html#tlsgetcacertificatestype), [Node 22.19 setter](https://nodejs.org/download/release/v22.19.0/docs/api/tls.html#tlssetdefaultcacertificatescerts).

В Node 24.19 `system` и `extra` возвращают кэшированные JS arrays; native system store дополнительно хранится в process-wide function-static vector. Повторный `getCACertificates('system')`, новый undici Agent и новый Worker thread не дают свежего чтения ОС. Setter сбрасывает **default** store, не system cache. Подтверждение — выполняемый код, не комментарий: [lib/tls.js:132–136,193–207](https://github.com/nodejs/node/blob/v24.19.0/lib/tls.js#L132), [crypto_context.cc:807–825,1156–1163](https://github.com/nodejs/node/blob/v24.19.0/src/crypto/crypto_context.cc#L807).

`--use-system-ca` включает системное доверие в defaults; `NODE_EXTRA_CA_CERTS` читается при запуске процесса. Explicit TLS `ca` **заменяет** defaults, поэтому необходимо объединить default и system, сохранив extra CA. [Node CLI](https://nodejs.org/download/release/v22.15.0/docs/api/cli.html#--use-system-ca), [NODE_EXTRA_CA_CERTS](https://nodejs.org/download/release/v22.15.0/docs/api/cli.html#node_extra_ca_certsfile), [Node 24 TLS options](https://nodejs.org/download/release/v24.19.0/docs/api/tls.html#tlscreatesecurecontextoptions).

## Безопасный путь для pinned undici

При boot: получить `default + system`, deduplicate и передать массив в `Agent({connect:{lookup:pinnedLookup,timeout,ca}})`. `rejectUnauthorized` и стандартная hostname verification остаются включёнными; URL сохраняет hostname/SNI, pin меняет только DNS lookup. Undici передаёт connect options в `tls.connect` и кэширует TLS sessions внутри connector. [Undici 7.29 connector:61–92](https://github.com/nodejs/undici/blob/v7.29.0/lib/core/connect.js#L61).

Для актуализации во время работы безопаснее контролируемый перезапуск процесса под supervisor. Альтернатива без перезапуска всей трубы: **свежий дочерний процесс**, запущенный тем же Node, пользователем и trust policy, считывает новый system/default snapshot; основной процесс строит новый dispatcher с этим PEM и переключает будущие запросы. Старые pools/sessions нужно завершить по явной политике deadline. Повторно собирать union из старого `getCACertificates('default')` опасно при удалении доверия: старый CA может сохраниться; свежий snapshot должен формироваться целиком в helper. Это предлагаемая архитектура, пока не реализованная и не проверенная live.

## Тест, который доказывает восстановление

1. Локальный TLS fixture: trusted root A, сервер с SAN hostname и leaf A; pinned lookup ведёт hostname на loopback. Запрос succeeds; leaf неизвестного root B и неверный SAN отвергаются.
2. В изолированном PEM fixture заменить A на B. Старый Agent остаётся на A; fresh snapshot + новый Agent принимает B и отвергает A. Не устанавливать test roots в production Windows store.
3. Для проверки именно **Windows system cache** использовать disposable VM/account: прогреть Node cache, добавить тестовый root штатным OS механизмом, сравнить старый процесс и свежий child, затем проверить removal. Fake loader unit test эту native семантику не доказывает.
4. Проверить Node 22.15, 22.19 и 24.19; timeout helper, malformed/empty snapshot и stalled pool должны приводить к понятной ошибке без ослабления TLS. Финально прогнать живые Matrix sync→RTC answer→clean_context на общем подписанном пакете обеих сторон.

Первый практический фикс — явное системное доверие при старте плюс диагностические trust counts/hash, Node version и issuer fingerprints без токенов. Автоматический reload/restart по одному certificate error требует отдельного lifecycle решения: ошибка не удостоверяет новый CA и не должна сама расширять доверие.
