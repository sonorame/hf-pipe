# Security

- RPC binds to `127.0.0.1` by default. Do not publish port 18765 on a LAN or public interface.
- `matrix-session.json` is an access token. Keep it out of git. Unix mode `0600`.
- ICE is relay-only. Host and srflx candidates are not used.
- Matrix rooms are not a command bus.

Report issues privately to the repository owner.
