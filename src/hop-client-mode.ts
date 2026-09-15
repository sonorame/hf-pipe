export function shouldInitRustCrypto(): boolean {
  const side = String(process.env.HF_SIDE || "").toLowerCase();
  return side !== "clean" && side !== "dirty";
}

export function mapKeysUploadResponse(
  url: string,
  status: number,
  body: string,
): { status: number; body: string } {
  const path = String(url || "");
  if (!path.includes("/keys/upload")) return { status, body };
  if (status === 400 && /already exists/i.test(body)) {
    return { status: 200, body: "{}" };
  }
  return { status, body };
}

export function hopSyncFilterDefinition(): {
  presence: { not_types: string[] };
  room: { rooms: string[]; ephemeral: { not_types: string[] }; state: { not_types: string[] }; timeline: { not_types: string[] }; account_data: { not_types: string[] } };
  account_data: { not_types: string[] };
} {
  const none = { not_types: ["*"] };
  return {
    presence: none,
    account_data: none,
    room: {
      rooms: [],
      ephemeral: none,
      state: none,
      timeline: none,
      account_data: none,
    },
  };
}
