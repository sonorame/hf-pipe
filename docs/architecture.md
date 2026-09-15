# Architecture

hf-pipe is a two-process hop. Both processes log in as the same Matrix user, on different devices. They never open a TCP listener toward each other.

```text
[Cursor / python]
        | stdio MCP or HTTP
        v
[dirty hop]  127.0.0.1:18765
        | to-device org.hf.pipe   lane=rtc|d2c|c2d
        v
   Matrix homeserver
        ^
        | TURN TCP/TLS  iceTransportPolicy=relay
        v
[clean hop]
        | fs / shell / screenshot
        v
   remote session
```

## Why this split

Direct TCP between the hosts is not available. A homeserver both hosts can already reach is the signaling path. A TURN server both hosts can already reach is the data path. After SDP/ICE, RPC does not go through Matrix events.

## Planes

| Plane | Transport | Content |
|---|---|---|
| Signaling | Matrix `sendToDevice` type `org.hf.pipe` | SDP, ICE, tiny control frames |
| Media / RPC | WebRTC datachannel `hf` via TURN TCP or TURNS | Binary HFP1, 16 KiB chunks, REQ/RES |
| Operator API | HTTP `127.0.0.1` | `/status`, `/ask` |
| Cursor | MCP stdio | proxies POST `/ask` |

Envelope:

```json
{ "hf": 1, "lane": "rtc", "frame": {} }
```

Lanes: `rtc` signaling, `d2c` dirty-to-clean jobs, `c2d` results. Job payload prefers the datachannel. to-device is the fallback when RTC is down and the frame is small enough.

## Components

| Module | Job |
|---|---|
| `src/index.mjs` | side switch, session, HTTP, to-device pump |
| `src/matrix/client.ts` | matrix-js-sdk, hop sync filter, no rust crypto |
| `src/network-policy.ts` | ipv4first, Happy Eyeballs, optional DNS pin, `pinnedFetch` |
| `src/rtc-pipe.mjs` | werift PeerConnection, TURN TCP, HFP1 |
| `src/clean-jobs.mjs` | filesystem, shell, screenshot |
| `src/hf-clean-mcp.mjs` | MCP tools on the operator |
| `src/login.mjs` | OIDC device code, SSO fallback |

Hop does not call `initRustCrypto`. `keys/upload` 400 "already exists" is mapped to 200 so a hop device does not knock the homeserver over.

Sync filter for hop: `room.rooms: []`. Presence and room timelines are not needed.

## Peer discovery

Both sides list `GET /_matrix/client/v3/devices` and pick the other device by display name:

- dirty looks for `hf-matrix` (override `HF_PEER_CLEAN_NAME`)
- clean looks for `hf-dirty` or `cursor mcp` (override `HF_PEER_DIRTY_NAME`)

Pin a device id with `HF_PEER_DEVICE` if names collide.

## HTTP on dirty

| Path | Method | Result |
|---|---|---|
| `/status` | GET | `{ rtc, pid, side }` |
| `/ask` | POST | one RPC job, JSON body `{ id, type, body }` |

Bind: `HF_RPC_BIND` (default `127.0.0.1`). Docker sets `0.0.0.0` and publishes the port only on the host loopback.

## Jobs

`ping`, `context`, `lab`, `shell`, `list`, `tree`, `glob`, `grep`, `read`, `write`, `screenshot`.

Screenshot coordinates are pixels of the remote virtual desktop when the capture helper is present.

Optional `HF_CLEAN_PROJECT` is the default cwd for shell. Optional `HF_LAB_SCRIPT` is a helper invoked by the `lab` job.

## Restart

1. `scripts/run.mjs` (and `start-*.cmd`) loop: Node exits, wait 4s, start again.
2. If `/sync` is not `SYNCING` / `PREPARED` / `CATCHUP` for `HF_SYNC_DEAD_MS` (default 120s), the process exits 7.
3. If the wall clock jumps more than 60s (hibernate), the process exits 7.
4. Windows optional: Task Scheduler task, interactive token of the logged-in user.

RTC: dirty sends a new offer if the datachannel is not up. A `connecting` state older than 8s does not keep the PC stuck.

## Boundaries

- No inbound TCP from dirty to clean or the reverse.
- No Matrix room as a command bus.
- Operator native file tools see the operator disk. Remote disk is MCP or `dirty.py`.

## HTTP stack

One fetch per process: Node `globalThis.fetch` / undici, `fetchFn: pinnedFetch`. Not `node-fetch` plus `https.Agent`, not `family: 4`. DNS pin is optional (`HF_DNS_PIN`) for hosts whose OS resolver dies after sleep.
