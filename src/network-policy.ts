import dns from "node:dns";
import net from "node:net";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Node lookup order. Official: dns.setDefaultResultOrder. Not Agent family: 4. */
export const DNS_RESULT_ORDER = "ipv4first" as const;

/** RFC 8305 via net.socket.connect. Official default is true unless --no-network-family-autoselection. */
export const AUTO_SELECT_FAMILY = true;

export const AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS = 500;

/** Static A records when Windows getaddrinfo / local DNS are dead. Read at lookup time. */
export const PINNED_A: Record<string, string> = {
  "mtx-1.zala-soft.com": "78.85.7.132",
};

type UndiciMod = {
  Agent: new (opts: { connect?: { lookup?: typeof dns.lookup } }) => unknown;
  setGlobalDispatcher: (dispatcher: unknown) => void;
  fetch: (input: unknown, init?: unknown) => Promise<Response>;
};

let pinsInstalled = false;
let dispatcher: unknown;
const origLookup = dns.lookup.bind(dns);
const origPromisesLookup = dns.promises.lookup.bind(dns.promises);

function normalizeHost(hostname: string): string {
  return String(hostname || "").trim().replace(/\.$/, "").toLowerCase();
}

function pinnedIp(hostname: string): string | undefined {
  return PINNED_A[normalizeHost(hostname)];
}

function loadUndici(): UndiciMod {
  return require("node:undici") as UndiciMod;
}

export function pinnedLookup(
  hostname: string,
  options: any,
  callback?: any,
): void {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  const ip = pinnedIp(hostname);
  const familyWanted = options && typeof options === "object" ? options.family : undefined;
  if (ip && familyWanted !== 6) {
    if (options && options.all) {
      callback(null, [{ address: ip, family: 4 }]);
    } else {
      callback(null, ip, 4);
    }
    return;
  }
  origLookup(hostname, options, callback);
}

function installPinnedLookup(): void {
  if (pinsInstalled) return;
  pinsInstalled = true;

  dns.lookup = pinnedLookup as typeof dns.lookup;

  dns.promises.lookup = ((hostname: string, options?: any) => {
    const opts = options && typeof options === "object" ? options : {};
    const ip = pinnedIp(hostname);
    if (ip && opts.family !== 6) {
      if (opts.all) {
        return Promise.resolve([{ address: ip, family: 4 }]);
      }
      return Promise.resolve({ address: ip, family: 4 });
    }
    return origPromisesLookup(hostname, options as any);
  }) as typeof dns.promises.lookup;

  try {
    const undici = loadUndici();
    dispatcher = new undici.Agent({
      connect: {
        lookup: pinnedLookup as typeof dns.lookup,
      },
    });
    undici.setGlobalDispatcher(dispatcher);
  } catch {
    dispatcher = undefined;
  }
  console.error(
    new Date().toISOString(),
    "hf net pin",
    "mtx-1.zala-soft.com",
    PINNED_A["mtx-1.zala-soft.com"],
  );
}

export function pinnedFetch(input: any, init?: any): Promise<Response> {
  applyNodeNetworkPolicy();
  try {
    const undici = loadUndici();
    return undici.fetch(input, { ...(init || {}), dispatcher });
  } catch {
    return fetch(input, init) as Promise<Response>;
  }
}

export function pinHost(hostname: string, ip?: string): void {
  const key = normalizeHost(hostname);
  if (!key || net.isIP(key)) return;
  PINNED_A[key] = ip || PINNED_A["mtx-1.zala-soft.com"];
}

export function applyNodeNetworkPolicy(): void {
  dns.setDefaultResultOrder(DNS_RESULT_ORDER);
  net.setDefaultAutoSelectFamily(AUTO_SELECT_FAMILY);
  if (net.getDefaultAutoSelectFamilyAttemptTimeout() < AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS) {
    net.setDefaultAutoSelectFamilyAttemptTimeout(AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS);
  }
  installPinnedLookup();
}
