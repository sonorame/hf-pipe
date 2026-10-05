# Codex в VS Code через hf-pipe

## Kilo с подпиской ChatGPT

Установленный Kilo может использовать прямой OpenAI OAuth provider. Для него отдельное расширение `openai.chatgpt` не требуется. `src/kilo-codex-launch.ps1` создаёт профиль `~\.hf-pipe\vscode-kilo-codex` и ярлык `Kilo Codex (hf-pipe)`, задаёт CONNECT-прокси и модель `openai/gpt-6-astra`. Процессный `KILO_CONFIG_CONTENT` дополняет встроенный каталог моделями GPT-6 Astra, GPT-6.1 Sol и GPT-6 Luna, выбирает стандартный агент `build` и сохраняет прежнюю конфигурацию LM Studio. Все три модели проверены 2026-10-05 реальными запросами через подписку ChatGPT: каждая вернула `PIPE_OK` без ошибки. Для применения нового каталога закрыть выделенное окно VS Code и открыть его через ярлык заново: конфигурация передаётся при запуске процесса.

В Kilo открыть Settings → Providers → OpenAI и выполнить вход ChatGPT. Поддерживаются browser и headless OAuth. Для headless входа можно открыть страницу и ввести код на dirty, пока процесс авторизации на clean опрашивает OpenAI через трубу. Auth-файл создаёт сам Kilo на clean; перенос токенов с dirty не требуется.

Проверять фактический Kilo backend, OpenAI OAuth и ответ модели. `http.proxy` передаётся расширением Kilo дочернему процессу в `HTTP_PROXY`/`HTTPS_PROXY`; loopback исключается из прокси. Маршрут не использует Kilo Gateway.

При TLS-инспекции на dirty для Kilo используется отдельный `~\.hf-pipe\kilo-codex-ca.pem`: существующий CA bundle clean плюс CA из цепочек OpenAI, проверенных системным trust store dirty. `scripts/inspect-openai-ca.mjs` запускается на dirty с `node --use-system-ca`; он экспортирует только публичные CA, не приватные ключи. Bundle задаётся через `kilo-code.new.extraCaCerts` и `NODE_EXTRA_CA_CERTS`. Проверка сертификата остаётся включённой; глобальный trust store не меняется.

## Отдельное расширение Codex

Маршрут: Codex на clean → CONNECT `127.0.0.1:18766` → HFP1 STREAM → dirty → OpenAI. TLS проходит сквозь хоп без подмены сертификата.

Пакет обеих сторон должен разрешать домены OpenAI, ChatGPT и адреса загрузки официального расширения VS Code. Политика задана в `src/egress-dialer.mjs`; произвольные домены и IP не разрешаются.

На clean запустить PowerShell-скрипт из активного подписанного release:

```powershell
& '<runtime>\releases\<current>\src\codex-egress.ps1' -InstallExtension -Launch
```

Скрипт устанавливает `openai.chatgpt`, создаёт отдельные данные VS Code в `~\.hf-pipe\vscode-codex` и ярлык `Codex (hf-pipe)`. Текущие окна VS Code не закрываются. Запуск через ярлык передаёт `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` дочернему Codex, а Chromium получает `--proxy-server`. Loopback исключён из прокси для локального OAuth callback. Переменные не устанавливаются глобально для других программ.

Пользователь входит в собственный аккаунт через панель Codex. Не переносить auth.json с dirty. Полная проверка требует ответа Codex после входа и свежих `egress open` для OpenAI в логе dirty. Наличие расширения и ответ CONNECT сами по себе этого не доказывают.

Настройка направляет приложение через прокси; отдельного firewall запрета прямого выхода для всех экземпляров Code.exe она не устанавливает. Такой запрет затронул бы другие окна VS Code и их LAN-подключения.

Для отката приложения закрыть выделенное окно и использовать обычный VS Code. Откат хопа выполнять целыми подписанными пакетами на обеих сторонах.
