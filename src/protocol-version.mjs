export const HOP_PROTOCOL_VERSION = 3;

export function hopProtocolVersion(env = process.env, options = {}) {
  if (options.protocolVersion != null) return Number(options.protocolVersion);
  if (env.HF_PROTOCOL_VERSION != null && env.HF_PROTOCOL_VERSION !== "") {
    return Number(env.HF_PROTOCOL_VERSION);
  }
  return HOP_PROTOCOL_VERSION;
}

export function decorateControlFrame(frame, options = {}) {
  return {
    ...frame,
    senderBuildId: String(options.buildId || process.env.HF_BUILD_ID || "dev"),
    protocolVersion: hopProtocolVersion(process.env, options),
  };
}

export function validateControlFrame(frame, options = {}) {
  const local = hopProtocolVersion(process.env, options);
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
