import net, { BlockList, isIP } from "node:net";
import { lookup as lookupHost } from "node:dns/promises";

export const DEFAULT_CURSOR_HOST_SUFFIXES = [".cursor.sh", ".cursor.com", ".cursorapi.com"];
export const DEFAULT_CURSOR_HOSTS = ["cursor.sh", "cursor.com", "cursorapi.com"];
export const DEFAULT_CODEX_HOSTS = ["openai.com", "chatgpt.com", "oaistatic.com", "oaiusercontent.com"];
export const DEFAULT_CODEX_HOST_SUFFIXES = DEFAULT_CODEX_HOSTS.map((host) => `.${host}`);
// VS Code downloads the official Codex extension through these endpoints.
export const DEFAULT_EXTENSION_HOSTS = ["marketplace.visualstudio.com"];
export const DEFAULT_EXTENSION_HOST_SUFFIXES = [".gallery.vsassets.io", ".gallerycdn.vsassets.io"];

export function normalizeHost(host) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
}

export function hostAllowed(host, options = {}) {
  const name = normalizeHost(host);
  if (!name) return false;
  if (options.publicInternet === true) {
    // shortcut: the VPN profile uses IPv4 TCP; add IPv6 when its CONNECT path is supported.
    return isIP(name) === 0 || publicIpv4(name);
  }
  const hosts = options.hosts || [...DEFAULT_CURSOR_HOSTS, ...DEFAULT_CODEX_HOSTS, ...DEFAULT_EXTENSION_HOSTS];
  const suffixes = options.suffixes || [...DEFAULT_CURSOR_HOST_SUFFIXES, ...DEFAULT_CODEX_HOST_SUFFIXES, ...DEFAULT_EXTENSION_HOST_SUFFIXES];
  if (hosts.includes(name)) return true;
  return suffixes.some((suffix) => name.endsWith(suffix));
}

const privateIpv4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
]) privateIpv4.addSubnet(address, prefix, "ipv4");

export function publicIpv4(address) {
  return isIP(address) === 4 && !privateIpv4.check(address, "ipv4");
}

export async function connectTcp(host, port, options = {}) {
  let target = host;
  if (options.publicInternet === true) {
    const records = await (options.lookup || lookupHost)(host, { family: 4, all: true });
    target = records.find((entry) => publicIpv4(entry.address))?.address;
    if (!target) throw new Error("VPN target must resolve to a public IPv4 address");
  }
  return new Promise((resolve, reject) => {
    const socket = (options.connect || net.connect)({ host: target, port });
    const onError = (error) => reject(error);
    socket.once("error", onError);
    socket.once("connect", () => {
      socket.removeListener("error", onError);
      resolve(socket);
    });
  });
}
