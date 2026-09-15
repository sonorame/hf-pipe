export const HOP_JOBS = [
  "ping",
  "context",
  "lab",
  "shell",
  "list",
  "tree",
  "glob",
  "grep",
  "read",
  "write",
  "pull",
  "screenshot",
];

export const DROPPED_INPUT_JOBS = [
  "mouse",
  "pointer",
  "click",
  "key",
  "keyboard",
  "type",
  "hotkey",
  "input",
];

export function isHopJob(type) {
  return HOP_JOBS.includes(String(type || "").toLowerCase());
}

export function isDroppedInputJob(type) {
  return DROPPED_INPUT_JOBS.includes(String(type || "").toLowerCase());
}

export function httpPageKind(method, pathname) {
  const m = String(method || "").toUpperCase();
  const p = String(pathname || "/");
  if (m === "GET" && p === "/status") return "status";
  if (m === "POST" && p === "/ask") return "ask";
  return "not_found";
}
