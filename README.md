# hf-pipe

**Remote shell, files and screenshot when the two hosts cannot open TCP to each other.**

Signaling goes through Matrix to-device. Payload goes through a WebRTC datachannel over TURN/TCP. Chat rooms are not a control plane.

[Quick start](#quick-start) · [Native](#native) · [Docker](#docker) · [What to click](#what-to-click-next) · [Architecture](docs/architecture.md) · [Configuration](docs/configuration.md)

![CI](https://github.com/sonorame/hf-pipe/actions/workflows/ci.yml/badge.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

## Why

Two machines sit on networks that do not route to each other. You still need to run commands, read files and see a screenshot of the remote session. hf-pipe uses a Matrix homeserver that both sides can reach, then a TURN relay that both sides can reach. After that the operator talks to `127.0.0.1` only.

| Side | Role |
|---|---|
| **dirty** | Operator. Cursor, MCP, local RPC |
| **clean** | Remote host. Filesystem, shell, screenshot |

Names are roles, not hostnames. Dirty is whoever runs Cursor. Clean is whoever executes jobs.

## What it does

- shell, list / tree / glob / grep, read / write
- screenshot of the remote desktop
- optional helper script on the remote host (`HF_LAB_SCRIPT`)
- MCP tools for Cursor (`clean_*`)
- restart loop + optional OS watchdog if Matrix `/sync` dies

```text
Cursor / CLI
        |  localhost HTTP 18765
   dirty hop
        |  Matrix to-device  (SDP / ICE only)
        |  WebRTC datachannel via TURN/TCP  (RPC)
   clean hop
        |  fs, shell, screenshot
   remote host
```

## Requirements

- Node.js 20.3+
- Python 3 (optional CLI `src/dirty.py`)
- A Matrix homeserver both hosts can reach
- TURN with TCP or TLS, advertised by `GET /_matrix/client/v3/voip/turnServer`
- Two device sessions of the **same** Matrix user

| Job | Windows | macOS | Linux | Docker |
|---|---|---|---|---|
| hop daemon, RPC, files, shell | yes | yes | yes | yes |
| screenshot | PowerShell host process | not yet | not yet | not in the container |

Screenshot on the remote side currently calls `capture-loop.ps1`. Run the **clean** hop on the Windows session you want to capture. Files and shell work on any OS.

## Quick start

```bash
git clone https://github.com/sonorame/hf-pipe.git
cd hf-pipe
cp .env.example .env
# edit MATRIX_HOMESERVER_URL and HF_SIDE
npm install
npm run login
```

Browser opens. Confirm the device. Then:

**Remote host**

```bash
# .env: HF_SIDE=clean  and  HF_DEVICE_NAME=hf-matrix
npm start -- clean
```

**Operator**

```bash
# .env: HF_SIDE=dirty  and  HF_DEVICE_NAME=hf-dirty
npm start -- dirty
```

Check `http://127.0.0.1:18765/status`. When `"rtc": true`, the tunnel is up.

CLI:

```bash
python src/dirty.py ask hostname
python src/dirty.py ask shell whoami
python src/dirty.py ask screenshot
```

## Native

Windows:

```bat
scripts\start.cmd clean
scripts\start.cmd dirty
```

or keep the windowed loops:

```bat
src\start-clean.cmd
src\start-dirty.cmd
```

Unix:

```bash
chmod +x scripts/start.sh
./scripts/start.sh clean
./scripts/start.sh dirty
```

`scripts/run.mjs` restarts the process 4 seconds after exit. That is the watchdog for Node. Optional OS scheduler: `src/install-watchdog.cmd` (Windows Task Scheduler, interactive user, not SYSTEM).

## Docker

Same image on both hosts. Secrets live in a volume, not in the image.

```bash
cp .env.example .env
docker compose run --rm login
# print the URL, confirm the device, Ctrl+C when "Session saved"
docker compose up -d hop
```

RPC is published only on loopback: `127.0.0.1:18765`. Inside the container `HF_RPC_BIND=0.0.0.0` so the port mapping works.

Screenshot does not run inside Docker. Use native Node on the remote Windows session for capture.

## What to click next

1. Copy `.env.example` to `.env`. Set `MATRIX_HOMESERVER_URL` and `HF_SIDE`.
2. `npm install` (or `docker compose build`).
3. `npm run login`. A browser tab opens (device-code or SSO). Sign in as the Matrix user that both hops will share.
4. In Element (or another client already logged in as that user): **Settings -> Sessions**. Confirm the new device. Clean hop should be named `hf-matrix`. Dirty hop should be named `hf-dirty`.
5. Start **clean** on the remote host, **dirty** on the operator. Leave both processes running.
6. On the operator open `http://127.0.0.1:18765/status`. If it says `"rtc": true`, the tunnel is up.
7. Cursor: copy `examples/mcp.json` into `~/.cursor/mcp.json` (or merge). Set `cwd` to this clone. Restart Cursor. Tools `clean_status`, `clean_shell`, `clean_screenshot`, ... talk to the remote host.
8. If RTC stays down: `npm run doctor`, confirm both devices, check TURN TCP on the homeserver.

Step-by-step: [docs/operations.md](docs/operations.md).

## Layout

```text
src/            hop daemon, MCP, login, jobs
scripts/        cross-platform start
docs/           architecture, env, operations
examples/       Cursor MCP snippet
Dockerfile      hop image
docker-compose  volume + localhost port
```

State on disk (not in git):

| Path | What |
|---|---|
| `~/.hf-pipe/secrets/matrix-session.json` | access token, device id |
| `~/.hf-pipe/data/{dirty,clean}/` | Matrix client store |
| `~/.hf-pipe/local/` | operator inbox/outbox and screenshots |

Legacy files under `~/.cursor/secrets` are still read if present.

## Security

- RPC binds to localhost by default. Do not publish `18765` on a LAN interface.
- Session file is an access token. Mode `0600` on Unix. Not in git.
- ICE is `relay` only. Media does not try host/srflx candidates.
- Matrix rooms are not used for commands.

## Docs

- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [Operations](docs/operations.md)
- [Rollback](ROLLBACK.md)

## License

MIT
