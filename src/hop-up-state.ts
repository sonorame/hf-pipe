export type HopRpcSnap = {
  reachable: boolean;
  rtc?: boolean;
  pid?: number;
  error?: string;
};

export type HopLaunchSnap = {
  rpc: HopRpcSnap;
  pidFilePid: number | null;
  pidAlive: boolean;
  commandLine: string | null;
};

export type HopLaunchPlan = {
  action: "doctor" | "wait-rtc" | "wait-rpc" | "start" | "clear-and-start";
};

export function hopCommandLineOurs(commandLine: string | null, side = "dirty"): boolean {
  const s = String(commandLine || "").toLowerCase();
  if (!s.includes("index.mjs")) return false;
  return s.includes(String(side).toLowerCase());
}

export function classifyHopLaunch(s: HopLaunchSnap, side = "dirty"): HopLaunchPlan {
  if (s.rpc.reachable && s.rpc.rtc) return { action: "doctor" };
  if (s.rpc.reachable) return { action: "wait-rtc" };
  if (s.pidAlive && hopCommandLineOurs(s.commandLine, side)) return { action: "wait-rpc" };
  if (s.pidAlive && s.pidFilePid) return { action: "clear-and-start" };
  return { action: "start" };
}
