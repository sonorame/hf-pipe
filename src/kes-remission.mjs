const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const STAY_RUNNING = /^(AVP|avpsus|klnagent)(\.|$)/;
const TIME_PREFIX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/;

function refused() {
  return { ok: false };
}

function isReadError(text) {
  return /read error/i.test(text);
}

function namesFromLines(text) {
  const names = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (NAME.test(line)) names.push(line);
  }
  return names;
}

export function parseHelpStop(text) {
  if (typeof text !== "string" || text.trim() === "" || isReadError(text)) return refused();
  const names = namesFromLines(text);
  if (names.length === 0) return refused();
  return { ok: true, names };
}

export function parseStatus(text) {
  if (typeof text !== "string" || text.trim() === "" || isReadError(text)) return refused();
  const running = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.trim().match(/^([A-Za-z][A-Za-z0-9_.]*)\s*:?\s+running\b/i);
    if (match) running.push(match[1]);
  }
  if (running.length === 0) return refused();
  return { ok: true, running };
}

export function classifyJournalLine(line, t0) {
  const found = String(line).match(TIME_PREFIX);
  const stamp = found ? found[1] : "";
  if (!stamp || stamp <= t0) return "before-t0";
  const body = String(line);
  if (body.includes("обновление баз")) return "ignore-update";
  if (body.includes("пульс klnagent")) return "ignore-pulse";
  return "break";
}

function staysRunning(name) {
  return STAY_RUNNING.test(name);
}

export function mayStartChange({ running, helpNames }) {
  const scanning = (running || []).filter((name) => !staysRunning(name));
  const allowed = new Set(helpNames || []);
  if (scanning.some((name) => !allowed.has(name))) {
    return { halt: true, stops: [] };
  }
  return { halt: false, stops: scanning.filter((name) => allowed.has(name)) };
}

export function localStops(helpNames, stillActive) {
  const allowed = new Set(helpNames || []);
  return (stillActive || []).filter((name) => allowed.has(name) && !staysRunning(name));
}

export function rollbackActions(changed) {
  const actions = [];
  for (const step of changed || []) {
    if (!step || step.action !== "STOP" || staysRunning(step.name)) continue;
    actions.push({ action: "START", name: step.name });
  }
  return actions;
}

export function postRebootOrder() {
  return [
    "file",
    "C:\\Windows\\System32\\hostname.exe",
    "kes-ui",
    "journal",
    "status",
  ];
}
