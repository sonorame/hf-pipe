# Changelog

## 1.3.0

Removed the operator live viewer (`GET /`, `GET /view`, `GET /shot`) and remote mouse/keyboard (`mouse`, `key`, `type`, `input.ps1`, MCP `clean_mouse` / `clean_key` / `clean_type`).

The hop is CLI plus screenshot: `POST /ask`, `GET /status`, filesystem, shell, `clean_screenshot`. The operator already has the remote desktop in person. A browser remote-desktop page was unused.

Rollback of the old page: tag `working-baseline-2026-09-15`.
