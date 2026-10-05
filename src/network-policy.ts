import { createRequire } from "node:module";
import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";
import { formatErrorChain } from "./error-chain.js";
import { mapKeysUploadResponse } from "./hop-client-mode.js";

const require = createRequire(import.meta.url);

/** Node lookup order. Official: dns.setDefaultResultOrder. Not Agent family: 4. */
export const DNS_RESULT_ORDER = "ipv4first" as const;

/** RFC 8305 via net.socket.connect. Official default is true unless --no-network-family-autoselection. */
export const AUTO_SELECT_FAMILY = true;

export const AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS = 500;

/** Undici default connectTimeout is 10s. mtx-1 TLS from clean often takes longer. */
export const CONNECT_TIMEOUT_MS = 60_000;

/** Static A records when OS getaddrinfo / local DNS are dead. Filled from HF_DNS_PIN. */
export const PINNED_A: Record<string, string> = {};

/** Undici RetryAgent default errorCodes omit ETIMEDOUT / connect timeout. */
export const HOP_RETRY_ERROR_CODES = [
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ENETDOWN",
  "ENETUNREACH",
  "EHOSTDOWN",
  "EHOSTUNREACH",
  "EPIPE",
  "UND_ERR_SOCKET",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
] as const;

export const HOP_RETRY_METHODS = [
  "GET",
  "HEAD",
  "OPTIONS",
  "PUT",
  "DELETE",
  "POST",
] as const;

/** Several Windows SYN blackholes (~21s each) plus backoff. */
export const HOP_RETRY_MAX_RETRIES = 8;

export function hopRetryAgentOptions(): {
  maxRetries: number;
  minTimeout: number;
  maxTimeout: number;
  timeoutFactor: number;
  methods: string[];
  errorCodes: string[];
} {
  return {
    maxRetries: HOP_RETRY_MAX_RETRIES,
    minTimeout: 1_000,
    maxTimeout: 30_000,
    timeoutFactor: 2,
    methods: [...HOP_RETRY_METHODS],
    errorCodes: [...HOP_RETRY_ERROR_CODES],
  };
}

type UndiciMod = {
  Agent: new (opts: ReturnType<typeof hopUndiciAgentOptions>) => unknown;
  RetryAgent: new (dispatcher: unknown, opts: ReturnType<typeof hopRetryAgentOptions>) => unknown;
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

export function loadDnsPinsFromEnv(raw = process.env.HF_DNS_PIN || ""): void {
  for (const part of String(raw).split(/[,;\s]+/)) {
    if (!part) continue;
    const eq = part.lastIndexOf("=");
    if (eq < 1) continue;
    const host = normalizeHost(part.slice(0, eq));
    const ip = part.slice(eq + 1).trim();
    if (host && net.isIP(ip) === 4) PINNED_A[host] = ip;
  }
}

export function loadUndici(): UndiciMod {
  return require("undici") as UndiciMod;
}

export function hopDispatcherReady(): boolean {
  return dispatcher != null;
}

export function createHopDispatcher(undici = loadUndici()): unknown {
  const agent = new undici.Agent(hopUndiciAgentOptions(pinnedLookup as typeof dns.lookup));
  return new undici.RetryAgent(agent, hopRetryAgentOptions());
}

/** Undici default keepAliveTimeout is 4s. Hop /sync poll is 10s. */
export const KEEP_ALIVE_TIMEOUT_MS = 60_000;

export const KEEP_ALIVE_MAX_TIMEOUT_MS = 600_000;

export function hopUndiciAgentOptions(
  lookup: typeof dns.lookup,
  getCertificates = tls.getCACertificates,
): {
  connectTimeout: number;
  connections: number;
  keepAliveTimeout: number;
  keepAliveMaxTimeout: number;
  connect: { lookup: typeof dns.lookup; timeout: number; ca: string[] };
} {
  return {
    connectTimeout: CONNECT_TIMEOUT_MS,
    connections: 1,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    keepAliveMaxTimeout: KEEP_ALIVE_MAX_TIMEOUT_MS,
    connect: {
      lookup,
      timeout: CONNECT_TIMEOUT_MS,
      ca: [...new Set([...getCertificates("default"), ...getCertificates("system")])],
    },
  };
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
  const first = !pinsInstalled;
  if (first) {
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
  }

  if (!dispatcher) {
    const undici = loadUndici();
    dispatcher = createHopDispatcher(undici);
    undici.setGlobalDispatcher(dispatcher);
  }
  if (first) {
    const pins = Object.entries(PINNED_A);
    console.error(
      new Date().toISOString(),
      "hf net pin",
      pins.length ? pins.map(([h, ip]) => `${h} ${ip}`).join(", ") : "(none)",
      "connectTimeout",
      CONNECT_TIMEOUT_MS,
      hopDispatcherReady() ? "dispatcher on" : "dispatcher off",
      "retry on",
      "connections",
      1,
    );
  }
}

export async function pinnedFetch(input: any, init?: any): Promise<Response> {
  applyNodeNetworkPolicy();
  const url = typeof input === "string" ? input : String(input?.url || input || "");
  let res: Response;
  try {
    const undici = loadUndici();
    if (!dispatcher) {
      dispatcher = createHopDispatcher(undici);
      undici.setGlobalDispatcher(dispatcher);
    }
    res = await undici.fetch(input, { ...(init || {}), dispatcher });
  } catch (e) {
    console.error(new Date().toISOString(), "hf fetch", String(url).split("?")[0], formatErrorChain(e));
    throw e;
  }
  if (res.status !== 400 || !url.includes("/keys/upload")) return res;
  const body = await res.text();
  const mapped = mapKeysUploadResponse(url, res.status, body);
  return new Response(mapped.body, {
    status: mapped.status,
    headers: { "Content-Type": "application/json" },
  });
}

export function pinHost(hostname: string, ip?: string): void {
  const key = normalizeHost(hostname);
  if (!key || net.isIP(key)) return;
  if (ip && net.isIP(ip) === 4) {
    PINNED_A[key] = ip;
    return;
  }
  if (ip) return;
  const hs = String(process.env.MATRIX_HOMESERVER_URL || "")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split(":")[0];
  const fromHs = hs ? PINNED_A[normalizeHost(hs)] : undefined;
  if (fromHs) PINNED_A[key] = fromHs;
}

export function applyNodeNetworkPolicy(): void {
  dns.setDefaultResultOrder(DNS_RESULT_ORDER);
  net.setDefaultAutoSelectFamily(AUTO_SELECT_FAMILY);
  if (net.getDefaultAutoSelectFamilyAttemptTimeout() < AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS) {
    net.setDefaultAutoSelectFamilyAttemptTimeout(AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS);
  }
  loadDnsPinsFromEnv();
  installPinnedLookup();
}
