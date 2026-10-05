# hf-pipe

This glossary records the product's operational vocabulary so that agent workflows use the same names as the system and its operators.

## Operations

**Operator plugin**:
A local Codex plugin that packages the `hf-pipe` operating workflow and its `clean-pc` MCP connection. It does not include Cursor hooks, secrets, or release artifacts.
_Avoid_: Cursor configuration, operator package

**Live runtime**:
The existing dirty-side Matrix/WebRTC installation at `~\.cursor\matrix-mcp-e2ee`, including its signed releases and `HFPipe-dirty` supervision. The operator plugin reuses it rather than copying it.
_Avoid_: plugin runtime, copied runtime

**Clean host**:
The remote execution side of an `hf-pipe` connection, reachable from the dirty operator machine only through the hop and `clean-pc`.
_Avoid_: remote machine, target

**Dirty host**:
The operator-side machine that initiates requests through the hop.
_Avoid_: local machine, source
