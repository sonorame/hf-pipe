# Native Cursor через HTTP CONNECT

На удаленной стороне (clean) обычный Cursor ходит в облако Cursor не своим исходящим TCP, а через HTTP CONNECT хопа. TLS остается между Cursor и облаком: хоп копирует октеты, сертификат не подменяет.

```text
Cursor на clean
        | HTTP CONNECT 127.0.0.1:18766
хоп clean (прокси)
        | HFP1 STREAM на том же datachannel, что RPC
хоп dirty (dialer)
        | TCP только к именам Cursor
облако Cursor (api2.cursor.sh и соседние хосты)
```

Порт CONNECT не равен RPC. По умолчанию CONNECT - `18766`, RPC - `18765`.

## Контракт потока

Кадры STREAM живут в том же бинарном канале HFP1, что ping и RPC. Типы `20..23` (OPEN, DATA, ACK, CLOSE) не пересекаются с ping (`1`, `2`) и RPC (`10`, `11`).

На одном datachannel сначала уходят RPC-кадры, потом STREAM.

Имена, которые dirty может набрать: `cursor.sh`, `cursor.com`, `cursorapi.com` и хосты с этими суффиксами. Остальные CONNECT получают `403`. Если datachannel еще не `open`, прокси отвечает `502`.

Поток к сокету Cursor - `Duplex`:

- `_write` - байты клиента (ClientHello и дальше) уходят на dirty как DATA;
- входящие DATA с dirty попадают в поток через `push`, не через `write`.

`PassThrough.write` входящих серверных байт снова эмитит `data` и отправляет TLS сервера обратно как клиентский DATA. Handshake тогда падает с `UNEXPECTED_MESSAGE` / `ERR_SSL_PROTOCOL_ERROR`. Регрессия: тест `server bytes are not sent back as client data`.

## Протокол хопа

В исходниках репозитория версия handshake по умолчанию - `3` (`HOP_PROTOCOL_VERSION`, либо `HF_PROTOCOL_VERSION`). Живой pack может держать bootstrap на версии `2`: тогда child получает `HF_PROTOCOL_VERSION=2` и принимает только кадры с той же версией.

Подписанный release несет `protocolVersion` в manifest. Bootstrap сверяет его до `fork` worker. Стороны с разной версией не применяют SDP.

Не копировать новый `bootstrap.mjs` из git (ожидает `3`) поверх живого pack, который проверяет `2`. Единица выкладки - signed release целиком, current и previous.

## Установка на clean

Cursor должен быть закрыт.

```text
node src/cursor-egress-apply.mjs
```

Скрипт:

- пишет в `settings.json` ключи `http.proxy`, `https.proxy`, `http.proxySupport=override`, `cursor.general.disableHttp2`;
- ставит ярлык `Cursor (hf-pipe).lnk` с `--proxy-server=http://127.0.0.1:18766`;
- ставит исходящие правила firewall для `Cursor.exe`: loopback разрешен, остальной IPv4 и IPv6 запрещены.

Правила требуют права администратора. Имена: `HFPipe-Cursor-allow-loopback`, `HFPipe-Cursor-block-out-v4`, `HFPipe-Cursor-block-out-v6`.

Запускать Cursor из ярлыка с `--proxy-server`, не в обход прокси.

Снять:

```text
node src/cursor-egress-apply.mjs --uninstall
```

Это убирает ключи прокси из settings, ярлык и правила `HFPipe-Cursor-*`.

## Проверка

1. На dirty `GET http://127.0.0.1:18765/status` дает `"rtc": true`. Обе стороны - один `buildId` и одна `protocolVersion`.
2. На clean порт `127.0.0.1:18766` в состоянии Listen.
3. CONNECT на `api2.cursor.sh:443` через этот порт отвечает `HTTP/1.1 200 Connection Established`, затем TLS 1.3 и HTTP к облаку.
4. В логе хопа dirty есть `egress open ... api2.cursor.sh 443`, без шквала `dial-error` на каждый ClientHello.

Chat Cursor после этого ходит тем же CONNECT. Ошибка `ERROR_RATE_LIMITED` - ответ облака, не обрыв TLS.

## TLS inspection на dirty

Dirty открывает обычный TCP к облаку. Если на этой машине включена подмена сертификатов исходящего TLS, цепочка, которую видит Cursor на clean, заканчивается локальным CA инспектора, которого на clean нет. Python с проверкой сертификата тогда дает `CERTIFICATE_VERIFY_FAILED`. Chromium/Cursor - `ERR_CERT_AUTHORITY_INVALID` или другой отказ проверки. Исключение - процесс хопа dirty (Node) из инспекции, либо доверенный CA инспектора на clean. Это не шов mux.

## Откат

- Хоп: `previous` в `state.json` живого pack, не файл с диска. Теги git: `hf-pipe-clean-cursor-egress-2026-09-22` (CONNECT), `hf-pipe-egress-tls-mux-2026-09-22` (Duplex, без эха TLS).
- Cursor: `cursor-egress-apply.mjs --uninstall` и удаление правил `HFPipe-Cursor-*`.
