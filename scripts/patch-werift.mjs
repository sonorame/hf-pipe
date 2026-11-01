import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../node_modules/werift");
assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).version, "0.24.4", "Review the handshake patch before changing werift");
const marker = "// hf-pipe: werift 0.24.4 handshake recovery\n";

function once(source, pattern, replacement, expected = 1) {
  assert.equal([...source.matchAll(new RegExp(pattern.source, "g"))].length, expected, `Unexpected werift source: ${pattern}`);
  return source.replace(new RegExp(pattern.source, "g"), replacement);
}

function client(source) {
  const start = source.indexOf("DtlsClient = class");
  const from = start >= 0 ? start : source.indexOf("class DtlsClient extends");
  assert.ok(from >= 0, "DtlsClient not found");
  const end = start >= 0 ? source.indexOf("\n// ../dtls/src/flight/server/flight2.ts", from) : source.length;
  assert.ok(end > from, "DtlsClient handshake handler not found");
  let section = source.slice(from, end);
  section = once(section, /for \(const handshake of assembled\) \{/, "$&\n                    if (this.connected) return;");
  // A handler that was awaiting readiness may resume after Finished was accepted.
  section = once(section, /await this\.waitForReady\(\(\) => !!this\.flight5\);/, "$&\n                    if (this.connected) return;", 2);
  section = once(section, /await this\.waitForReady\(\s*\(\) => this\.dtls\.checkHandshakesExist\(targets\)\s*\);/, "$&\n                    if (this.connected) return;");
  return source.slice(0, from) + section + source.slice(end);
}

function flight(source) {
  return once(source, /async exec\(\) \{\s+if \(this\.dtls\.flight === 5\)/,
    "async exec() {\n    if (this.dtls.flight >= 7) return;\n    if (this.dtls.flight === 5)");
}

function connection(source) {
  return once(source, /async connect\(\) \{\s+log\d*\("start connect"\);[\s\S]+?\n +restartIce\(\) \{/, `async connect() {
    if (this.hfConnectPending) return this.hfConnectPending;
    const pending = Promise.all(this.dtlsTransports.map(async (dtlsTransport) => {
      const { iceTransport } = dtlsTransport;
      this.secureManager.setConnectionState("connecting");
      if (iceTransport.state !== "connected") await iceTransport.start();
      if (dtlsTransport.state !== "connected") await dtlsTransport.start();
      if (this.sctpTransport?.dtlsTransport.id === dtlsTransport.id && this.sctpTransport.sctp.state !== "connected") {
        await this.sctpManager.connectSctp();
      }
    })).then(() => this.secureManager.setConnectionState("connected"), (error) => {
      this.secureManager.setConnectionState("failed");
      throw error;
    });
    this.hfConnectPending = pending;
    try { await pending; } finally { if (this.hfConnectPending === pending) this.hfConnectPending = undefined; }
  }
  restartIce() {`);
}

const edits = [
  ["lib/index.mjs", (source) => connection(flight(client(source)))],
  ["lib/dtls/src/client.js", client],
  ["lib/dtls/src/flight/client/flight5.js", flight],
  ["lib/webrtc/src/peerConnection.js", connection],
].map(([name, transform]) => {
  const path = join(root, name);
  const source = readFileSync(path, "utf8");
  return [path, source.startsWith(marker) ? source : marker + transform(source)];
});
// Validate every upstream anchor before modifying any installed file.
for (const [path, source] of edits) writeFileSync(path, source);
console.log("werift 0.24.4: handshake recovery patch ready (ESM + CJS)");
