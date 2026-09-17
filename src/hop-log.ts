export type HopLogLevel = "info" | "warn" | "ok";

export type HopLogLine = {
  id: number;
  t: number;
  level: HopLogLevel;
  text: string;
};

const MAX = 80;
let seq = 0;
let lines: HopLogLine[] = [];

export function resetHopLog(): void {
  seq = 0;
  lines = [];
}

export function formatHopLogLine(kind: string, detail: Record<string, unknown> = {}): string {
  const gen = detail.gen == null || detail.gen === "" ? "" : String(detail.gen);
  switch (kind) {
    case "up":
      return "Канал жив.";
    case "down":
      return "Канал пропал.";
    case "failed":
      return "Труба оборвалась. Собираю заново.";
    case "recycle":
      return gen ? `Собираю новую трубу. Попытка ${gen}.` : "Собираю новую трубу.";
    case "pong-miss":
      return "Пульса нет. Собираю трубу заново.";
    case "wait":
      return "Жду вторую сторону.";
    case "restart":
      return "Демон перезапускается сам.";
    default:
      return String(detail.text || kind);
  }
}

export function pushHopLog(
  kind: string,
  detail: Record<string, unknown> = {},
  level: HopLogLevel = "info",
): HopLogLine {
  const line: HopLogLine = {
    id: ++seq,
    t: Date.now(),
    level,
    text: formatHopLogLine(kind, detail),
  };
  lines.push(line);
  if (lines.length > MAX) lines = lines.slice(-MAX);
  return line;
}

export function readHopLogAfter(afterId = 0): HopLogLine[] {
  const after = Number(afterId) || 0;
  return lines.filter((l) => l.id > after);
}
