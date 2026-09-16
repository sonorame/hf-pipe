export type HopInstanceClaim = {
  status: "busy" | "occupy";
  holderPid?: number;
};

export function claimHopInstance(s: {
  pidPath: string;
  pid: number;
  isAlive: (pid: number) => boolean;
  readFile: (path: string) => string | null;
  writeFile: (path: string, body: string) => void;
}): HopInstanceClaim {
  const raw = s.readFile(s.pidPath);
  const existing = Number(String(raw ?? "").trim());
  if (Number.isFinite(existing) && existing > 0 && existing !== s.pid && s.isAlive(existing)) {
    return { status: "busy", holderPid: existing };
  }
  s.writeFile(s.pidPath, String(s.pid));
  return { status: "occupy" };
}

export function hopListenBusyExitCode(err: { code?: string } | null | undefined): number | null {
  if (err && err.code === "EADDRINUSE") return 2;
  return null;
}
