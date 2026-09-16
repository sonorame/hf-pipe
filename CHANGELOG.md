# История изменений

## 1.3.1

- `scripts/hop-up.cmd` - один клик: поднять демон грязной, дождаться RTC, прогнать `src/hop-doctor.mjs`.
- `hop-doctor.mjs` - самодиагностика GREEN/RED по цепочке (node, сессия, DNS, TCP 443, versions, TURN, /status, end-to-end ping, планировщик). Первый RED - виновный шов.
- Самолечение offerer: `rtcRecycleAction` soft 45с пересоздает peer, hard 120с делает `exit(7)` для restart-loop. Answerer остается пассивным.
- Watchdog больше не убивает процесс, пока RTC жив, а Matrix sync завис.
- Тег `hop-doctor-selfheal-2026-09-16`.

## 1.3.0

- Удален интерактивный веб-просмотр экрана через браузер (`GET /`, `GET /view`, `GET /shot`) и управление мышью/клавиатурой (`mouse`, `key`, `type`, `input.ps1`, MCP-инструменты `clean_mouse`, `clean_key`, `clean_type`).
- Хоп ориентирован на надежный CLI-доступ и снятие статических снимков экрана: `POST /ask`, `GET /status`, операции с файловой системой, shell и `clean_screenshot`.
- Исходный код с веб-просмотром сохранен в теге `working-baseline-2026-09-15`.

## 1.2.0

- Кроссплатформенная сборка: поддержка работы в Docker, запуск на Linux, macOS и Windows.
- Универсальная конфигурация через `.env` без привязки к путям конкретного стенда.
- Добавлена очистка устаревших временных файлов очереди (`temp-sweep.mjs` и `hotfolder-temp.mjs`).
- Поддержка CI-пайплайна на GitHub Actions.
