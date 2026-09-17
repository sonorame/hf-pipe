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
    case "pulse": {
      const host = detail.host ? String(detail.host) : "";
      const ms = detail.ms == null || detail.ms === "" ? "" : String(detail.ms);
      if (host && ms) return `Пульс ок, ${ms} мс. Ответила ${host}.`;
      if (host) return `Пульс ок. Ответила ${host}.`;
      return "Пульс ок.";
    }
    case "pulse-fail":
      return "Пульс не дошел.";
    case "wait":
      return "Жду вторую сторону.";
    case "restart":
      return "Демон перезапускается сам.";
    case "offer":
      return gen ? `Оффер ушел. Попытка ${gen}.` : "Оффер ушел.";
    case "no-answer": {
      const sec = detail.sec == null || detail.sec === "" ? "" : String(detail.sec);
      return sec ? `Ответа нет ${sec} с.` : "Ответа нет.";
    }
    case "answer":
      return gen ? `Пришел ответ. Попытка ${gen}.` : "Пришел ответ.";
    case "drop-gen": {
      const remote = detail.remote == null ? "" : String(detail.remote);
      const have = detail.have == null ? "" : String(detail.have);
      if (remote && have) return `Ответ на чужую попытку ${remote}. У меня ${have}.`;
      return "Ответ на чужую попытку.";
    }
    case "peer": {
      const peer = detail.peer ? String(detail.peer) : "";
      return peer ? `Пир ${peer}.` : "Пир неизвестен.";
    }
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
