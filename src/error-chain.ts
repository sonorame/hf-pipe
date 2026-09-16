export function formatErrorChain(err: unknown, max = 6): string {
  const parts: string[] = [];
  let cur: unknown = err;
  let depth = 0;
  while (cur != null && depth < max) {
    parts.push(formatOne(cur));
    cur = typeof cur === "object" && cur !== null && "cause" in cur ? (cur as { cause?: unknown }).cause : undefined;
    depth += 1;
  }
  return parts.join(" <- ");
}

function formatOne(err: unknown): string {
  if (err == null) return String(err);
  if (typeof err !== "object") return String(err);
  const rec = err as { code?: unknown; message?: unknown };
  const code = rec.code != null ? String(rec.code) : "";
  const message = rec.message != null ? String(rec.message) : "";
  if (code && message && !message.includes(code)) return `${code} ${message}`;
  return message || code || String(err);
}
