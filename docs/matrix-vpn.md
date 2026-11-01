# Matrix VPN for the former dirty Windows laptop

This is a second, isolated hf-pipe pair. The Windows client uses the clean role
for TCP egress; its partner is the `hf-pipe-matrix-vpn` container on the VPS.
The primary work-clean pairing, `hf-pipe-dirty`, and Amnezia remain independent.

```
Windows applications → HFPipeVPN (sing-box TUN) → local CONNECT :18866
                    → WebRTC over Matrix TURN/TCP/TLS → second VPS dirty → Internet
```

Matrix REST carries signaling, not the application payload. Both Matrix HTTPS
and this server's TURN service must be reachable from the work network. A working
Matrix web login alone does not establish that TURN is reachable.

## Portable package

Extract `hf-pipe-matrix-vpn.zip` completely on the **former dirty** Windows laptop.
Do not run it on the primary work clean in place of its separate clean installer.

1. Run `Start-VPN.cmd` as your usual Windows user. First start asks you to sign
   into the same Matrix account as the VPS and enrolls this separate device.
2. Approve the administrator prompt for the TUN frontend. Only sing-box runs
   elevated; hf-pipe and its RPC endpoint run as your usual user.
3. Run `Check-VPN.cmd`. It checks the datachannel, adapter, VPS exit IP and Telegram
   HTTPS. Then request `HF_PIPE_OK` in the existing Codex extension.
4. Run `Stop-VPN.cmd` to disconnect. It signals the frontend, which sends Ctrl+C
   to sing-box's private console and waits for graceful adapter/route cleanup.

No scheduled tasks, system proxy, global hosts file, existing VPN configuration,
or primary hf-pipe files are changed. State and logs live in
`%USERPROFILE%\.hf-pipe\matrix-vpn`. Status: <http://127.0.0.1:18864/>.
Repeated starts reuse that device's identity; copy no Matrix session between PCs.
Enrollment is a time-limited, single-device capability. Keep the ZIP private.

The profile routes public IPv4 TCP through the VPS, including applications that
do not support proxies. DNS is intercepted and resolved using DoH over the same
TCP path. Matrix's resolved IPv4 address is excluded from the TUN and pinned for
the hf-pipe process. Local private networks remain direct. Non-DNS UDP and IPv6
are rejected in this first version. Telegram calls, QUIC and general UDP are
outside its scope; browsers normally fall back from QUIC to TCP.

## Safe home test

`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-matrix-vpn.ps1 -TestTransport`
uses a separate `.hf-pipe\matrix-vpn-test` directory and starts only a local mixed
proxy at `127.0.0.1:18880` plus DNS test listener `127.0.0.1:18853`. It never creates
a TUN or changes system routes. `check-matrix-vpn.ps1 -TestTransport` checks that
profile. Stop it with `stop-matrix-vpn.ps1 -TestTransport`.

Home transport testing cannot validate the work laptop's adapter, route cleanup,
or work network access to TURN. Validate these on the actual laptop before using
the connection for work. Existing TCP connections are lost on a pipe outage;
applications reconnect after hf-pipe recovers.

## Dependencies

The offline package bundles Node and production hf-pipe dependencies, sing-box
1.14.4 (Windows amd64) with its LICENSE and libcronet.dll, and signed Wintun 0.14.1
amd64 with its license. No driver is downloaded at first start.

- [sing-box TUN configuration](https://sing-box.sagernet.org/configuration/inbound/tun/)
- [Wintun](https://www.wintun.net/)

Verified download SHA-256:

```
sing-box-1.14.4-windows-amd64.zip
99185d75d314a07dbba4a130c8ad986cbeb629a07927975636b341ca61f991df
wintun-0.14.1.zip
07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51
```

The VPS opt-in `HF_EGRESS_PROFILE=vpn` permits public TCP destinations; the
default profile keeps its existing domain allowlist. The dirty resolves each VPN
target once and connects to the validated public IPv4 address, rejecting private
and reserved destinations. Run the second container without published ports,
with its own volume, memory/CPU limits, dropped capabilities and log rotation.

Build the portable directory with `scripts/build-matrix-vpn-package.ps1` after
compiling TypeScript. Supply a production runtime directory containing `node.exe`
and patched `node_modules`, a fresh enrollment JSON file, the extracted official
sing-box and Wintun distributions, and a new output directory. The builder checks
the sing-box version and Wintun signature and copies the three launcher commands.
Archive the contents of that directory. Do not publish enrollment JSON in Git.
