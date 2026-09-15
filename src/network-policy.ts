import dns from "node:dns";
import net from "node:net";
import { Agent, setGlobalDispatcher, fetch as undiciFetch } from "node:undici";

/** Node lookup order. Official: dns.setDefaultResultOrder. Not Agent family: 4. */
export const DNS_RESULT_ORDER = "ipv4first" as const;

/** RFC 8305 via net.socket.connect. Official default is true unless --no-network-family-autoselection. */
export const AUTO_SELECT_FAMILY = true;

export const AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS = 500;

/** Static A records when Windows getaddrinfo / local DNS are dead. Read at lookup time. */
export const PINNED_A: Record<string, string> = {
  "mtx-1.zala-soft.com": "78.85.7.132",
};

let pinsInstalled = false;
let dispatcher: Agent | undefined;
const origLookup = dns.lookup.bind(dns);
const origPromisesLookup = dns.promises.lookup.bind(dns.promises);

function normalizeHost(hostname: string): string {
  return String(hostname || "").trim().replace(/\.$/, "").toLowerCase();
}

function pinnedIp(hostname: string): string | undefined {
  return PINNED_A[normalizeHost(hostname)];
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
  if (ip) {
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
    if (ip) {
      if (opts.all) {
        return Promise.resolve([{ address: ip, family: 4 }]);
      }
      return Promise.resolve({ address: ip, family: 4 });
    }
    return origPromisesLookup(hostname, options as any);
  }) as typeof dns.promises.lookup;

  dispatcher = new Agent({
    connect: {
      lookup: pinnedLookup,
    },
  });
  setGlobalDispatcher(dispatcher);
  console.error(
    new Date().toISOString(),
    "hf net pin",
    "mtx-1.zala-soft.com",
    PINNED_A["mtx-1.zala-soft.com"],
  );
}

export function pinnedFetch(input: any, init?: any): Promise<Response> {
  applyNodeNetworkPolicy();
  return undiciFetch(input, { ...(init || {}), dispatcher } as any) as Promise<Response>;
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
