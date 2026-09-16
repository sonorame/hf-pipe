export type PeerMemory = {
  id: string;
  at: number;
};

export type ListedDevice = {
  device_id?: string;
  display_name?: string;
  last_seen_ts?: number;
};

export type PeerResolveInput = {
  envPeer?: string;
  remembered?: PeerMemory | null;
  incoming?: string;
  listed?: string | null;
  listFailed?: boolean;
  now: number;
  ttlMs?: number;
};

export type PeerResolveResult = {
  id: string;
  source: "env" | "listed" | "incoming" | "remembered" | "fresh";
};

export const PEER_FRESH_MS = 15_000;

export function isFreshPeer(
  mem: PeerMemory | null | undefined,
  now: number,
  ttlMs = PEER_FRESH_MS,
): boolean {
  return Boolean(mem?.id && now - mem.at < ttlMs);
}

export function pickPeerFromDevices(
  devices: ListedDevice[],
  myDevice: string,
  needles: string[],
): string | null {
  const others = devices.filter((d) => d.device_id && d.device_id !== myDevice);
  const hits = others
    .filter((d) => {
      const name = String(d.display_name || "").toLowerCase();
      return needles.some((n) => n && name.includes(n));
    })
    .sort((a, b) => (b.last_seen_ts || 0) - (a.last_seen_ts || 0));
  return hits[0]?.device_id || null;
}

export function resolvePeerId(input: PeerResolveInput): PeerResolveResult {
  if (input.envPeer) {
    return { id: input.envPeer, source: "env" };
  }
  if (input.listed) {
    return { id: input.listed, source: "listed" };
  }
  if (input.incoming) {
    return { id: input.incoming, source: "incoming" };
  }
  if (input.listFailed && input.remembered?.id) {
    return { id: input.remembered.id, source: "remembered" };
  }
  throw new Error("no peer hf device");
}
