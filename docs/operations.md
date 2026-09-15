# Operations

This is the operator path after clone. No hostnames from a private lab.

## 1. Env

```bash
cp .env.example .env
```

Set `MATRIX_HOMESERVER_URL`. Set `HF_SIDE=clean` on the remote host and `HF_SIDE=dirty` on the operator. Optional: `HF_DNS_PIN=homeserver.example=203.0.113.10` if local DNS dies after sleep.

## 2. Install

Native: `npm install` (Node 20+).

Docker: `docker compose build`.

## 3. Login

Native:

```bash
npm run login
```

A browser tab opens. Complete SSO or the device-code page. If the browser does not open, copy the URL from the terminal (`HF_OPEN_BROWSER=0` also prints only the URL).

Docker:

```bash
docker compose run --rm --service-ports login
```

Confirm, wait for `Session saved`, stop the container.

## 4. Confirm the device in Element

1. Open Element (or another client) as the **same** Matrix user.
2. Settings -> Sessions (sometimes "Devices").
3. Find the new session:
   - remote hop: display name `hf-matrix`
   - operator hop: display name `hf-dirty`
4. Verify / confirm it. Until this is done, to-device events may not flow.

Login uses those display names. Override with `HF_DEVICE_NAME` before login if you need other labels, then set `HF_PEER_CLEAN_NAME` / `HF_PEER_DIRTY_NAME` to match.

## 5. Start hops

Remote:

```bash
npm start -- clean
```

Operator:

```bash
npm start -- dirty
```

Leave both running. The loop restarts Node if it exits.

Logs to expect:

- `session @user:server DEVICEID to-device org.hf.pipe`
- `hf-pipe rust crypto off`
- `rpc http 127.0.0.1:18765` (dirty)
- `rtc turn` then `rtc up`

## 6. Check the tunnel

On the operator:

- browser: `http://127.0.0.1:18765/status` -> `"rtc": true`
- `python src/dirty.py ask hostname`

`npm run doctor` prints Node version, DNS, and `GET /_matrix/client/versions`.

## 7. Cursor

Merge `examples/mcp.json` into `~/.cursor/mcp.json`. Point `args` / `cwd` at this clone. Restart Cursor. Call `clean_status`. If it reports rtc down, restart both hops.

## 8. Windows screenshot

Screenshot runs PowerShell on the **clean** host. The hop process must run in the interactive user session (the same session as the desktop). Task Scheduler: interactive logon, not SYSTEM.

Live viewer, mouse and keyboard are not part of the hop.

## If RTC stays down

1. Both hops started, both sessions confirmed.
2. `HF_PEER_DEVICE` set to the other device id if names do not match.
3. Homeserver `voip/turnServer` returns `turn:` or `turns:` with `transport=tcp`.
4. `npm run doctor` on both hosts.
5. Restart hops after hibernate (clock jump already exits 7 and the loop comes back).

## Rollback

Tag `working-baseline-2026-09-15` is an older snapshot of the hop. See `ROLLBACK.md`.
