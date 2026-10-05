# Инструкция по откату

Снимки исходного кода сохранены в git-тегах. Файлы сессий и бинарные сборки в git не хранятся.

## Возврат к базовой версии

Для отката на стабильный снимок используйте тег:

```text
git fetch --tags
git checkout working-baseline-2026-09-15
```

Срезы 2026-09-22:

```text
hf-pipe-egress-tls-mux-2026-09-22
hf-pipe-clean-cursor-egress-2026-09-22
```

Первый - Duplex mux без эха TLS в CONNECT. Второй - сам выход Cursor через CONNECT.

Срезы 2026-09-16 (от новых к старым):

```text
hop-doctor-selfheal-2026-09-16
hop-rtc-epoch-instance-2026-09-16
hop-rtc-dead-gen-2026-09-16
hop-rtc-offer-session-2026-09-16
hop-rtc-keep-peer-2026-09-16
hop-retry-etimedout-2026-09-16
hop-undici-connect-60s-2026-09-16
```

После переключения установите зависимости и запустите нужную сторону:

```text
npm install
npm start -- clean
npm start -- dirty
```

Обратите внимание: при циклическом перезапуске процесс Node не перечитывает модули на лету, поэтому при переключении веток обязательно остановите и заново запустите процесс хопа.

## Возврат на актуальную ветку main

```text
git checkout main
```

Файл сессии `matrix-session.json` при переключении веток не затрагивается, так как находится в каталоге `~/.hf-pipe/secrets/` и добавлен в `.gitignore`.
