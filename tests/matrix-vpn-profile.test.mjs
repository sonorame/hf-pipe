import assert from "node:assert/strict";
import test from "node:test";
import { matrixVpnConfig } from "../src/matrix-vpn-profile.mjs";

test("the VPN profile keeps Matrix outside the TUN and sends DNS and application traffic through hf-pipe", () => {
  const config = matrixVpnConfig({ homeserver: "https://matrix.example.org", matrixIpv4: "8.8.8.8" });
  assert.equal(config.inbounds[0].type, "tun");
  assert.deepEqual(config.inbounds[0].route_exclude_address, ["8.8.8.8/32"]);
  assert.equal(config.dns.servers.find((server) => server.tag === "remote").detour, "hfpipe");
  assert.equal(config.dns.servers.find((server) => server.tag === "matrix").predefined["matrix.example.org"], "8.8.8.8");
  assert.equal(config.route.final, "hfpipe");
  assert.equal(config.outbounds.find((outbound) => outbound.tag === "hfpipe").server_port, 18866);
});
