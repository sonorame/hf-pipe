export type DoctorCheck = {
  name: string;
  ok: boolean;
  skipped?: boolean;
  detail?: string;
};

export type DoctorSummary = {
  verdict: "GREEN" | "RED";
  failing: string[];
  culprit: string | null;
};

/** A skipped check is not applicable on this side and never fails the verdict. */
function counts(check: DoctorCheck): boolean {
  return !check.skipped;
}

export function summarizeDoctor(checks: DoctorCheck[]): DoctorSummary {
  if (!checks.length) {
    return { verdict: "RED", failing: [], culprit: null };
  }
  const failing = checks.filter((c) => counts(c) && !c.ok).map((c) => c.name);
  return {
    verdict: failing.length ? "RED" : "GREEN",
    failing,
    culprit: failing[0] ?? null,
  };
}

export function formatDoctorLines(checks: DoctorCheck[]): string[] {
  return checks.map((c) => {
    const tag = c.skipped ? "SKIP " : c.ok ? "GREEN" : "RED  ";
    const detail = c.detail ? ` ${c.detail}` : "";
    return `${tag} ${c.name}${detail}`;
  });
}

export function nextDoctorHint(culprit: string | null, detail = ""): string {
  if (!culprit) return "";
  const d = String(detail || "");
  if (culprit === "status" && /ECONNREFUSED/i.test(d)) {
    return "Демон грязной не слушает 127.0.0.1:18765. CursorMCP поднимет его сам.";
  }
  if (culprit === "status") {
    return "Демон грязной жив, RTC нет. Демон чистой сам соберет трубу.";
  }
  if (culprit === "e2e") {
    return "Локальный /status есть, ping до чистой не прошел. Демон чистой сам переподключится.";
  }
  if (culprit === "tcp443" || culprit === "versions" || culprit === "turn") {
    return "Путь до mtx-1:443 флапает. Демон сам повторит, когда сеть вернется.";
  }
  if (culprit === "session") {
    return "Нет matrix-session.json. На чистой start-clean.cmd сам сделает login, на грязной сессия лежит в .hf-pipe\\secrets.";
  }
  if (culprit === "dns") {
    return "DNS не отдал A mtx-1. Проверь сеть.";
  }
  if (culprit === "node") {
    return "Нужен Node 20+ (C:\\Program Files\\nodejs\\node.exe).";
  }
  if (culprit === "scheduledTask") {
    return "Нет задачи CursorMCP. Демон не поднимется сам после падения.";
  }
  if (culprit === "scheduledTaskLogon") {
    return "Нет задачи CursorMCPLogon. После входа демон сам не поднимется.";
  }
  if (culprit === "dist") {
    return "Нет собранного dist (hop-board). Демон сам допишет его перед стартом.";
  }
  return `Сломан шов ${culprit}.`;
}
