# hf-pipe

Канал с грязной Windows на чистую (EDSIZHW0038), когда прямого TCP нет.

Грязная сторона открывает Cursor и MCP. Чистая сторона принимает shell, файлы, скрин, мышь и клавиатуру. Сигналинг - Matrix to-device `org.hf.pipe`. Полезные данные - WebRTC datachannel через TURN/TCP (mtx-1). Комнаты Matrix для транспорта не используются.

## Что умеет

- shell, list/tree/glob/grep, read/write
- скрин виртуального стола (PNG/JPEG)
- мышь: move, click, dblclick, rightclick, scroll, drag
- клавиатура: Unicode-текст и аккорды (`ctrl+c`, `enter`, стрелки)
- локальный просмотр на грязной: `http://127.0.0.1:18765/`
- самоподъем: цикл `start-*.cmd` + задача планировщика `CursorMCP` + выход демона, если `/sync` мертв дольше 2 минут

## Стороны

| Сторона | Каталог | Запуск |
|---|---|---|
| dirty | `C:\Users\Malykh_Kirill\.cursor\matrix-mcp-e2ee` | `start-dirty.cmd` или `install-watchdog.cmd` |
| clean | `%USERPROFILE%\.cursor\matrix-mcp-e2ee` (node.exe из `Desktop\hf-matrix-pack`) | `start-clean.cmd` из пака или `install-watchdog.cmd` |
| MCP | тот же dirty + `~\.cursor\mcp.json` сервер `clean-pc` | Cursor поднимает stdio сам |

Сессия Matrix: `%USERPROFILE%\.cursor\secrets\matrix-session.json` (не в git).

## Быстрый старт

Чистая: один раз `install-watchdog.cmd` в `%USERPROFILE%\.cursor\matrix-mcp-e2ee`. В Element подтвердить устройство `hf-matrix`. Окно `start-clean.cmd` из пака можно свернуть.

Грязная: `install-watchdog.cmd` в `matrix-mcp-e2ee`. В Cursor должен быть MCP `clean-pc`.

Проверка с грязной:

```text
py -3.12 C:\Users\Malykh_Kirill\bin\hotfolder\dirty.py ask hostname
py -3.12 C:\Users\Malykh_Kirill\bin\hotfolder\dirty.py ask mouse --op move 400 300
```

Браузер: `http://127.0.0.1:18765/`

## Настройка

- `HF_RPC_PORT` (по умолчанию 18765) - HTTP на dirty, только localhost
- `HF_EVENT_TYPE` (по умолчанию `org.hf.pipe`)
- `HF_PEER_DEVICE` - зафиксировать device id соседа
- `HF_SYNC_DEAD_MS` (по умолчанию 120000) - после этого демон выходит, цикл поднимает снова
- TURN берется из `GET /_matrix/client/v3/voip/turnServer`, только TCP/TLS, `iceTransportPolicy=relay`

## GitHub

Репозиторий пока локальный. Когда будешь готов: private repo, без `node_modules`, без `*.pid`, без `secrets`, без скринов. Этот каталог `projects/hf-pipe` - описание и манифест; рантайм живет в путях таблицы выше.
