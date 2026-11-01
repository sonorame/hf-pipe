import { isIP } from "node:net";

export function matrixVpnConfig({ homeserver, matrixIpv4, testTransport = false }) {
  const matrixHost = new URL(homeserver).hostname;
  if (isIP(matrixIpv4) !== 4) throw new Error("Resolve the Matrix IPv4 address before starting the TUN");
  return {
    log: { level: "warn", timestamp: true },
    dns: {
      servers: [
        { type: "hosts", tag: "matrix", predefined: { [matrixHost]: matrixIpv4 } },
        { type: "https", tag: "remote", server: "1.1.1.1", path: "/dns-query", tls: { enabled: true, server_name: "cloudflare-dns.com" }, detour: "hfpipe" },
      ],
      rules: [{ domain: [matrixHost], action: "route", server: "matrix" }],
      final: "remote", strategy: "ipv4_only",
    },
    inbounds: testTransport ? [
      { type: "mixed", tag: "apps", listen: "127.0.0.1", listen_port: 18880 },
      { type: "direct", tag: "dns-test", listen: "127.0.0.1", listen_port: 18853 },
    ] : [{
      type: "tun", tag: "apps", interface_name: "HFPipeVPN",
      address: ["198.18.250.1/30", "fd42:6866:7069::1/126"], mtu: 1400,
      auto_route: true, strict_route: true, dns_mode: "hijack",
      route_exclude_address: [`${matrixIpv4}/32`],
    }],
    outbounds: [
      { type: "http", tag: "hfpipe", server: "127.0.0.1", server_port: 18866 },
      { type: "direct", tag: "direct" },
    ],
    route: {
      auto_detect_interface: true, default_domain_resolver: "remote",
      rules: [
        ...(testTransport ? [{ inbound: ["dns-test"], action: "hijack-dns" }] : []),
        { port: 53, action: "hijack-dns" },
        { ip_cidr: [`${matrixIpv4}/32`], action: "route", outbound: "direct" },
        { ip_version: 6, action: "reject" },
        { ip_is_private: true, action: "route", outbound: "direct" },
        { network: "udp", action: "reject" },
      ],
      final: "hfpipe",
    },
  };
}
