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
