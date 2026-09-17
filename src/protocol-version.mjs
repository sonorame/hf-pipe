export const HOP_PROTOCOL_VERSION = 2;

export function decorateControlFrame(frame, options = {}) {
  return {
    ...frame,
    senderBuildId: String(options.buildId || process.env.HF_BUILD_ID || "dev"),
    protocolVersion: Number(
      options.protocolVersion || process.env.HF_PROTOCOL_VERSION || HOP_PROTOCOL_VERSION,
    ),
  };
}

export function validateControlFrame(frame, options = {}) {
  const local = Number(options.protocolVersion || process.env.HF_PROTOCOL_VERSION || HOP_PROTOCOL_VERSION);
  const remote = Number(frame?.protocolVersion || 0);
  const remoteBuildId = String(frame?.senderBuildId || frame?.buildId || "unknown");
  if (remote !== local) {
    return {
      ok: false,
      reason: `protocol mismatch local=${local} remote=${remote}`,
      remoteBuildId,
    };
  }
  return { ok: true, remoteBuildId };
}
