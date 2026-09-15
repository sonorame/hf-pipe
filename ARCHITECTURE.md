# Архитектура hf-pipe

```text
[Cursor dirty] --stdio--> [MCP clean-pc] --HTTP 127.0.0.1:18765--> [index.mjs dirty]
                                                                      |  Matrix to-device (SDP/ICE)
                                                                      v
[index.mjs clean] <---- WebRTC datachannel TURN/TCP ---->  RPC HFP1 chunks
        |
        +-- clean-jobs: fs/shell/screenshot
        +-- input.ps1: SetCursorPos + SendInput
```

## Границы

- Грязная не открывает входящий TCP на чистую и не ходит на чистую по TCP.
- DFS и комнаты чата не являются каналом управления.
- Native Read/Write Cursor смотрят диск грязной машины. Чистый диск - только MCP / `dirty.py` / viewer.

## Matrix HTTP

Демон ходит в homeserver через Node `globalThis.fetch` (undici). `matrix-js-sdk` без `fetchFn`. До HTTP процесс ставит `dns.setDefaultResultOrder("ipv4first")` и оставляет Happy Eyeballs (`net.setDefaultAutoSelectFamily(true)`). Отдельный `node-fetch`+`https.Agent` и `family: 4` не используются.

## Сигналинг

Оба демона логинятся одним Matrix-пользователем, разными device id.

- dirty ищет display name с `hf-matrix`
- clean ищет `hf-dirty` или `cursor mcp`

Кадр: `{ hf:1, lane:"rtc"|"d2c"|"c2d", frame:{...} }` в to-device `org.hf.pipe`.

## Медиа

werift, TURN TCP 3478 и TURNS 5349, relay-only. Datachannel `hf`. Бинарный фрейм HFP1, куски 16 KiB, RPC REQ/RES. Скрин и ввод идут этим каналом, не Matrix media.

## Ввод

Координаты - пиксели виртуального стола (как `VirtualScreen` у скрина). Move/drag: `SetCursorPos`. Кнопки, колесо, клавиши: `SendInput`. Текст: `KEYEVENTF_UNICODE`.

Viewer на dirty рисует JPEG и мапит клик по картинке в эти координаты.

## Самоподъем

1. `start-clean.cmd` / `start-dirty.cmd` - бесконечный цикл, пауза 4 с после выхода node.
2. Демон пишет `hf.pid`. Если `/sync` не `SYNCING/PREPARED/CATCHUP` дольше `HF_SYNC_DEAD_MS`, `process.exit(7)`.
3. Старт: нет сессии или `bootClient` падает - ретрай, процесс не умирает сразу.
4. Планировщик `CursorMCP`: Hidden, `node.exe index.mjs`, IgnoreNew каждые 2 минуты, RestartOnFailure, AtLogOn. Интерактивный токен текущего пользователя, не SYSTEM (иначе SendInput не попадет в стол).

RTC: dirty сам шлет новый offer, если datachannel не up.

## MCP

stdio, процесс на dirty. Инструменты проксируют POST `/ask`. Картинка в MCP - base64, плюс файл `bin\hotfolder\local\shots\`.
