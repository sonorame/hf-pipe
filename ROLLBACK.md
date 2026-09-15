# Откат

Тег `working-baseline-2026-09-15` - снимок hop после ребута чистой, когда DNS/Matrix снова отвечали. Секреты и `node.exe` в git нет.

## Откатить исходники

```text
cd C:\Users\Malykh_Kirill\Desktop\projects\hf-pipe
git fetch
git checkout working-baseline-2026-09-15
```

Дальше скопировать файлы из `src/` в рантайм:

- грязная: `C:\Users\Malykh_Kirill\.cursor\matrix-mcp-e2ee\`
- чистая: `C:\Users\Kirill\Desktop\hf-matrix-pack\`
- клиент: `C:\Users\Malykh_Kirill\bin\hotfolder\dirty.py` и `pipe.py`

`compiled\network-policy.js` -> `dist\network-policy.js` на обеих машинах. Процесс node перезапустить (`start-clean.cmd` / `start-dirty.cmd`). `boot retry` модуль не перечитывает.

Вернуться на голову:

```text
git checkout main
```

Не откатывать `matrix-session.json` из git: его там нет.
