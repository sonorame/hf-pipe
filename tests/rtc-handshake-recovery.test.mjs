import assert from "node:assert/strict";
import dgram from "node:dgram";
import { randomUUID } from "node:crypto";
import test from "node:test";

const { RTCPeerConnection } = await import(process.env.HF_RTC_TEST_ENTRY || "werift");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("RTC recovery deadline in loopback test");
    await pause(20);
  }
}
async function udp() {
  const socket = dgram.createSocket("udp4");
  await new Promise((resolve) => socket.bind(0, "127.0.0.1", resolve));
  return socket;
}
function hostPort(sdp) {
  const candidates = sdp.split(/\r?\n/).filter((line) => line.startsWith("a=candidate:"));
  assert.equal(candidates.length, 1, "the regression test must use only one loopback candidate");
  const fields = candidates[0].split(" ");
  assert.equal(fields[2], "udp");
  assert.equal(fields[4], "127.0.0.1");
  return Number(fields[5]);
}
function viaProxy(description, port) {
  return { type: description.type, sdp: description.sdp.replace(/^(a=candidate:\S+ 1 udp \d+ 127\.0\.0\.1) \d+/gm, `$1 ${port}`) };
}
function serverHelloDone(packet) {
  for (let offset = 0; offset + 13 <= packet.length;) {
    const length = packet.readUInt16BE(offset + 11);
    const end = offset + 13 + length;
    if (end > packet.length) return;
    if (packet[offset] === 22 && packet.readUInt16BE(offset + 3) === 0 && packet[offset + 13] === 14) {
      return Buffer.from(packet.subarray(offset, end));
    }
    offset = end;
  }
}

test("a connected datachannel survives a late duplicate DTLS ServerHelloDone", { timeout: 65000 }, async (t) => {
  const proxy = await udp();
  const blackhole = await udp();
  const configuration = {
    iceServers: [{ urls: `stun:127.0.0.1:${blackhole.address().port}` }],
    iceUseIpv4: false, iceUseIpv6: false, iceUseTcp: false,
    iceAdditionalHostAddresses: ["127.0.0.1"], iceInterfaceAddresses: { udp4: "127.0.0.1" },
  };
  const offerer = new RTCPeerConnection(configuration);
  const answerer = new RTCPeerConnection(configuration);
  let stopped = false;
  t.after(async () => {
    stopped = true;
    await Promise.allSettled([offerer.close(), answerer.close()]);
    proxy.close(); blackhole.close();
  });
  let firstPort;
  let secondPort;
  let duplicate;
  proxy.on("message", (packet, remote) => {
    if (stopped) return;
    assert.equal(remote.address, "127.0.0.1");
    if (remote.port !== firstPort) secondPort ||= remote.port;
    const target = remote.port === firstPort ? secondPort : firstPort;
    if (remote.port === firstPort) duplicate ||= serverHelloDone(packet);
    if (target) proxy.send(packet, target, "127.0.0.1");
  });
  const channel = offerer.createDataChannel("recovery");
  answerer.ondatachannel = ({ channel: incoming }) => {
    incoming.onmessage = ({ data }) => incoming.send(data);
  };
  const received = new Set();
  channel.onmessage = ({ data }) => received.add(String(data));
  await offerer.setLocalDescription(await offerer.createOffer());
  firstPort = hostPort(offerer.localDescription.sdp);
  await answerer.setRemoteDescription(viaProxy(offerer.localDescription, proxy.address().port));
  await answerer.setLocalDescription(await answerer.createAnswer());
  assert.equal(secondPort || hostPort(answerer.localDescription.sdp), hostPort(answerer.localDescription.sdp));
  secondPort = hostPort(answerer.localDescription.sdp);
  await offerer.setRemoteDescription(viaProxy(answerer.localDescription, proxy.address().port));
  await until(() => channel.readyState === "open" && offerer.connectionState === "connected" && answerer.connectionState === "connected");
  assert.ok(duplicate, "the proxy must capture the server's actual handshake packet");
  const before = `before-${randomUUID()}`;
  channel.send(before);
  await until(() => received.has(before));
  proxy.send(duplicate, secondPort, "127.0.0.1");
  await pause(34000); // Flight5's old retry loop failed after 33 seconds.
  assert.equal(offerer.connectionState, "connected");
  assert.equal(answerer.connectionState, "connected");
  const after = `after-${randomUUID()}`;
  channel.send(after);
  await until(() => received.has(after), 5000);
});
