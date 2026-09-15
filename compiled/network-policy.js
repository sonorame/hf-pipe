import dns from "node:dns";
import net from "node:net";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
/** Node lookup order. Official: dns.setDefaultResultOrder. Not Agent family: 4. */
export const DNS_RESULT_ORDER = "ipv4first";
/** RFC 8305 via net.socket.connect. Official default is true unless --no-network-family-autoselection. */
export const AUTO_SELECT_FAMILY = true;
export const AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS = 500;
/** Static A records when Windows getaddrinfo / local DNS are dead. Read at lookup time. */
export const PINNED_A = {
    "mtx-1.zala-soft.com": "78.85.7.132",
};
let pinsInstalled = false;
let dispatcher;
const origLookup = dns.lookup.bind(dns);
const origPromisesLookup = dns.promises.lookup.bind(dns.promises);
function normalizeHost(hostname) {
    return String(hostname || "").trim().replace(/\.$/, "").toLowerCase();
}
function pinnedIp(hostname) {
    return PINNED_A[normalizeHost(hostname)];
}
function loadUndici() {
    return require("node:undici");
}
export function pinnedLookup(hostname, options, callback) {
    if (typeof options === "function") {
        callback = options;
        options = {};
    }
    const ip = pinnedIp(hostname);
    const familyWanted = options && typeof options === "object" ? options.family : undefined;
    if (ip && familyWanted !== 6) {
        if (options && options.all) {
            callback(null, [{ address: ip, family: 4 }]);
        }
        else {
            callback(null, ip, 4);
        }
        return;
    }
    origLookup(hostname, options, callback);
}
function installPinnedLookup() {
    if (pinsInstalled)
        return;
    pinsInstalled = true;
    dns.lookup = pinnedLookup;
    dns.promises.lookup = ((hostname, options) => {
        const opts = options && typeof options === "object" ? options : {};
        const ip = pinnedIp(hostname);
        if (ip && opts.family !== 6) {
            if (opts.all) {
                return Promise.resolve([{ address: ip, family: 4 }]);
            }
            return Promise.resolve({ address: ip, family: 4 });
        }
        return origPromisesLookup(hostname, options);
    });
    try {
        const undici = loadUndici();
        dispatcher = new undici.Agent({
            connect: {
                lookup: pinnedLookup,
            },
        });
        undici.setGlobalDispatcher(dispatcher);
    }
    catch {
        dispatcher = undefined;
    }
    console.error(new Date().toISOString(), "hf net pin", "mtx-1.zala-soft.com", PINNED_A["mtx-1.zala-soft.com"]);
}
export function pinnedFetch(input, init) {
    applyNodeNetworkPolicy();
    try {
        const undici = loadUndici();
        return undici.fetch(input, { ...(init || {}), dispatcher });
    }
    catch {
        return fetch(input, init);
    }
}
export function pinHost(hostname, ip) {
    const key = normalizeHost(hostname);
    if (!key || net.isIP(key))
        return;
    PINNED_A[key] = ip || PINNED_A["mtx-1.zala-soft.com"];
}
export function applyNodeNetworkPolicy() {
    dns.setDefaultResultOrder(DNS_RESULT_ORDER);
    net.setDefaultAutoSelectFamily(AUTO_SELECT_FAMILY);
    if (net.getDefaultAutoSelectFamilyAttemptTimeout() < AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS) {
        net.setDefaultAutoSelectFamilyAttemptTimeout(AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS);
    }
    installPinnedLookup();
}
//# sourceMappingURL=network-policy.js.map