# Configuration

Copy `.env.example` to `.env` on each host. `src/config.mjs` loads `.env` from the repo root if the variable is not already in the environment.

Paths below use `~` for `$HOME` / `%USERPROFILE%`.

## Required

| Variable | Meaning |
|---|---|
| `HF_SIDE` | `dirty` or `clean` |
| `MATRIX_HOMESERVER_URL` | `https://matrix.example.com` |

`npm run login` writes `user_id`, `access_token`, `device_id` into the session file. You do not set the token by hand.

## Session and data

| Variable | Default |
|---|---|
| `HF_SECRETS_DIR` | `~/.hf-pipe/secrets` (or `~/.cursor/secrets` if that already exists) |
| `MATRIX_SESSION_FILE` | `{HF_SECRETS_DIR}/matrix-session.json` |
| `MATRIX_DATA_DIR` | `~/.hf-pipe/data/{side}` |
| `HF_LOCAL_DIR` | `~/.hf-pipe/local` |
| `HF_CLEAN_ROOT` / `HOT_ROOT` | optional extra writable root on clean (legacy folder pipe) |
| `HF_CLEAN_PROJECT` | optional default cwd on clean |
| `HF_LAB_SCRIPT` | optional helper script for the `lab` job |
| `HF_LAB_CONFIG` | optional YAML with `host_aliases` |
| `MATRIX_OIDC_ISSUER` | `{homeserver}/auth/` |
| `MATRIX_USER_ID` | from session |
| `HF_ENV_FILE` | extra env file |

## Network

| Variable | Default | Meaning |
|---|---|---|
| `HF_RPC_BIND` | `127.0.0.1` | HTTP bind. Docker: `0.0.0.0` |
| `HF_RPC_PORT` | `18765` | HTTP port |
| `HF_RPC_URL` | `http://127.0.0.1:18765` | MCP / `dirty.py` |
| `HF_EVENT_TYPE` | `org.hf.pipe` | to-device type |
| `HF_DNS_PIN` | empty | `host=IPv4,host2=IPv4` |
| `HF_SYNC_DEAD_MS` | `120000` | exit if sync stuck |
| `HF_TEMP_KEEP_MS` | `0` | delete leftover hotfolder temp older than this. In-flight `outbox`/`mxinbox` json is kept at least 20s |
| `HF_TEMP_SWEEP_MS` | `30000` | how often the daemon and `CursorMCP` (`temp-sweep.mjs`) sweep |
| `HF_TEMP_ROOT` | `HF_LOCAL_DIR` or `~/bin/hotfolder/local` | override sweep root |
| `HF_OPEN_BROWSER` | `1` | `0` prints the login URL only |

## Devices

| Variable | Default |
|---|---|
| `HF_DEVICE_NAME` | `hf-dirty` or `hf-matrix` from side |
| `HF_PEER_CLEAN_NAME` | `hf-matrix` |
| `HF_PEER_DIRTY_NAME` | `hf-dirty` |
| `HF_PEER_NAME` | extra substring match |
| `HF_PEER_DEVICE` | skip name lookup, use this device id |

## Docker

`docker-compose.yml` mounts volume `hf-pipe-data` at `/data` and sets `HF_SECRETS_DIR`, `MATRIX_DATA_DIR`, `HF_LOCAL_DIR` under it. Login and hop must use the same volume so the session file is visible to the daemon.

Publish only loopback:

```text
127.0.0.1:18765:18765
```

## Cursor MCP

See `examples/mcp.json`. `cwd` must be the clone. After changing `mcp.json`, restart Cursor.
