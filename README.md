# hf-pipe

**Удаленный shell, файлы и screenshot между хостами, когда прямое TCP-соединение между ними невозможно.**

Сигналинг работает через Matrix to-device. Передача данных идет через WebRTC datachannel поверх TURN/TCP. Комнаты чата в качестве транспорта не используются.

[Быстрый старт](#быстрый-старт) · [Запуск без Docker](#запуск-без-docker) · [Запуск в Docker](#запуск-в-docker) · [Куда нажимать и что делать](#куда-нажимать-и-что-делать-дальше) · [Архитектура](docs/architecture.md) · [Cursor CONNECT](docs/cursor-egress.md) · [Параметры окружения](docs/configuration.md)

![CI](https://github.com/sonorame/hf-pipe/actions/workflows/ci.yml/badge.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

## Для чего нужен инструмент

Две машины находятся в изолированных сетях, между которыми нет маршрутизации и невозможно открыть прямой сетевой порт. При этом с одной машины требуется выполнять команды на другой, просматривать файлы и снимать screenshot удаленного рабочего стола.

hf-pipe решает это без VPN и проброса портов:
1. Обе стороны подключаются к общему Matrix-серверу (сигналинг).
2. Обе стороны поднимают WebRTC datachannel через TURN-сервер с TCP/TLS.
3. Оператор на локальной машине обращается только к локальному адресу `127.0.0.1:18765` или использует инструменты MCP в Cursor.

| Сторона | Роль | Описание |
|---|---|---|
| **dirty** | Оператор | Машина, где запущен Cursor, MCP-сервер или скрипт управления. Локальный RPC-сервер на 127.0.0.1 |
| **clean** | Удаленный хост | Машина, на которой выполняются команды, читаются файлы и делается screenshot |

Названия сторон - это роли процессов в туннеле. Операторская сторона инициирует запросы, удаленная сторона выполняет задачи.

## Что умеет

- Команды shell с таймаутом и выбором рабочего каталога.
- Файловые операции: `list`, `tree`, `glob`, `grep`, чтение (`read`) и запись (`write`).
- Снимок удаленного экрана (`screenshot`).
- Native Cursor на удаленной стороне через HTTP CONNECT `127.0.0.1:18766` (тот же datachannel, TLS до облака Cursor).
- Подключение к Cursor через встроенный MCP-сервер (`clean_*`).
- Запуск вспомогательных скриптов на удаленном хосте (`clean_lab`).
- Автоматический перезапуск worker без разрыва Matrix control plane.
- Подписанные Ed25519 release, атомарная активация и откат на предыдущую версию.
- Локальная панель обеих сторон, журнал причин и счетчики операций.

```text
Cursor / консоль
        |  localhost HTTP 18764/18765
   supervisor dirty
        |  Matrix to-device  (health, SDP / ICE, подписанный release)
        |  локальный IPC
   WebRTC worker dirty
        |  WebRTC datachannel через TURN/TCP  (shell, файлы, screenshot)
   WebRTC worker clean
        |  локальный IPC
        |  HTTP CONNECT 127.0.0.1:18766  (Cursor -> облако Cursor)
   supervisor clean
        |  файловая система, shell, screenshot
   удаленная ОС
```

## Требования

- Node.js 22+
- Python 3 (для вызова CLI через `src/dirty.py`)
- Доступный обеим машинам сервер Matrix (Synapse + MAS/OIDC или любой homeserver, выдающий access token)
- TURN-сервер с поддержкой TCP или TLS (выдается через `GET /_matrix/client/v3/voip/turnServer`)
- Две сессии одного и того же пользователя Matrix

| Возможность | Windows | macOS | Linux | Docker |
|---|---|---|---|---|
| Демон хопа, RPC, файлы, shell | Да | Да | Да | Да |
| Снятие screenshot | Да (через PowerShell) | В разработке | В разработке | Не внутри контейнера |

Снятие screenshot на удаленной стороне использует PowerShell-скрипт `capture-loop.ps1`. Поэтому удаленный хоп (`clean`) для снятия экрана запускается в интерактивной пользовательской сессии Windows. Работа с файлами и shell поддерживается на любой операционной системе.

## Быстрый старт

```bash
git clone https://github.com/sonorame/hf-pipe.git
cd hf-pipe
cp .env.example .env
# укажите адрес MATRIX_HOMESERVER_URL и роль HF_SIDE
npm install
npm run login
```

В браузере откроется страница подтверждения. Войдите под общим пользователем.

Затем запустите процессы:

**На удаленной машине (clean):**

```bash
# в .env: HF_SIDE=clean и HF_DEVICE_NAME=hf-matrix
npm start -- clean
```

**На машине оператора (dirty):**

```bash
# в .env: HF_SIDE=dirty и HF_DEVICE_NAME=hf-dirty
npm start -- dirty
```

Проверьте общую панель в браузере:

`http://127.0.0.1:18764/` показывает build, Matrix, RTC, последний сбой и операции обеих машин.

API worker остается на `http://127.0.0.1:18765/status`; поле `"rtc": true` означает, что datachannel поднят.

Проверка через консоль оператора:

```bash
python src/dirty.py ask hostname
python src/dirty.py ask shell whoami
python src/dirty.py ask screenshot
```

## Запуск без Docker

Windows:

```bat
scripts\start.cmd clean
scripts\start.cmd dirty
```

Для постоянной работы установите одну интерактивную задачу планировщика на каждой машине:

```bat
src\install-watchdog.cmd clean
src\install-watchdog.cmd dirty
```

Linux / macOS:

```bash
chmod +x scripts/start.sh
./scripts/start.sh clean
./scripts/start.sh dirty
```

Задачи `HFPipe-clean` и `HFPipe-dirty` запускают стабильный bootstrap после входа в Windows. Bootstrap проверяет подпись, hash и protocol version, следит за supervisor и откатывает release после повторного падения до `booted`.

## Запуск в Docker

Один и тот же образ работает на обеих сторонах. Файлы сессии и кэш сохраняются в volume, а не в слои контейнера.

```bash
cp .env.example .env
docker compose run --rm --service-ports login
# войдите по ссылке, дождитесь надписи "Session saved", завершите команду
docker compose up -d hop
```

RPC-порт открывается только на локальном интерфейсе хоста: `127.0.0.1:18765`. Внутри контейнера задается `HF_RPC_BIND=0.0.0.0`, чтобы порт был доступен при пробросе.

Снятие screenshot экрана Windows из контейнера не поддерживается - для захвата экрана запускайте `clean` хоп нативно в сессии пользователя.

## Куда нажимать и что делать дальше

1. Скопируйте файл `.env.example` в `.env`. Заполните `MATRIX_HOMESERVER_URL` и выберите сторону `HF_SIDE` (`clean` или `dirty`).
2. Выполните установку зависимостей: `npm install` (или `docker compose build`).
3. Запустите авторизацию: `npm run login`. Откроется браузер для входа по SSO или коду устройства. Войдите под учетной записью, выделенной для туннеля.
4. Откройте Matrix-клиент (например, Element) под этим же пользователем: перейдите в **Параметры -> Сессии** (Settings -> Sessions). Подтвердите добавленные устройства:
   - на удаленной машине устройство называется `hf-matrix`;
   - на машине оператора устройство называется `hf-dirty`.
5. Запустите хопы на обеих машинах: `npm start -- clean` на удаленной и `npm start -- dirty` на операторской. Окна оставьте открытыми.
6. На машине оператора проверьте статус: откройте в браузере `http://127.0.0.1:18765/status`. Значение `"rtc": true` говорит об успешном подключении.
7. Подключение Cursor: скопируйте блок из `examples/mcp.json` в `~/.cursor/mcp.json`, укажите в `cwd` путь к каталогу репозитория и перезапустите Cursor. Инструменты `clean_status`, `clean_shell`, `clean_screenshot` и другие станут доступны в окне диалога.
8. Если статус RTC не поднимается: оставьте окна `start-clean.cmd` и `start-dirty.cmd` открытыми. Демон сам собирает трубу заново. `scripts\hop-up.cmd` не нужен для повседневной работы.

Пошаговое руководство с пояснениями: [docs/operations.md](docs/operations.md).

## Структура проекта

```text
src/            Исходный код хопа, MCP-сервера, авторизации и задач
scripts/        Кроссплатформенные скрипты запуска и тестов
docs/           Подробные документы по архитектуре, переменным и эксплуатации
examples/       Пример конфигурации для Cursor MCP
Dockerfile      Сборка контейнера хопа
docker-compose  Запуск контейнера с монтированием хранилища данных
```

Расположение рабочих данных на диске (не попадает в git):

| Путь | Назначение |
|---|---|
| `~/.hf-pipe/secrets/matrix-session.json` | Access token и идентификатор устройства |
| `~/.hf-pipe/secrets/matrix-refresh.dpapi` | Refresh token, защищенный Windows DPAPI |
| `~/.hf-pipe/keys/release-private.dpapi` | Закрытый ключ release только на dirty |
| `<runtime>/releases/` | Неизменяемые signed release, current и previous |
| `~/.hf-pipe/data/{dirty,clean}/` | Локальное состояние клиента Matrix |
| `~/.hf-pipe/local/` | Очереди задач и сохраненные файлы screenshot на стороне оператора |
| `<runtime>/logs/` | Журнал bootstrap, supervisor и worker |

Сессия Matrix MCP в `~/.cursor/secrets` к hop не относится.

## Безопасность

- RPC-сервер по умолчанию слушает только `127.0.0.1`. Не публикуйте порт 18765 в локальную сеть или интернет.
- Файл `matrix-session.json` содержит access token учетной записи. Доступ к нему должен быть ограничен (права 0600 на Unix). В git он игнорируется.
- ICE работает исключительно в режиме `relay` (только через TURN). Локальные и публичные адреса хостов не раскрываются.
- Matrix передает только health, RTC signaling и подписанные release. Shell, файлы и screenshot передаются только по WebRTC.

## Документация

- [Native Cursor через HTTP CONNECT](docs/cursor-egress.md)
- [Архитектура и потоки данных](docs/architecture.md)
- [Справочник переменных окружения](docs/configuration.md)
- [Эксплуатация и решение проблем](docs/operations.md)
- [Инструкция по откату](docs/rollback.md)

## Лицензия

MIT
