export const HOP_BOARD_ACTIONS = ["ping", "recycle", "restart", "doctor"] as const;

export type HopBoardAction = (typeof HOP_BOARD_ACTIONS)[number];

export type HopStatusView = {
  rtc: boolean;
  pid: number;
  side: string;
  dc: string;
  connection: string;
  ice: string;
  signaling: string;
  gen: number;
  epoch: string | null;
  pongAgeMs: number | null;
  peerHost: string | null;
  caption: string;
  dcText: string;
  connectionText: string;
  iceText: string;
  signalingText: string;
};

export type DoctorParse = {
  verdict: "GREEN" | "RED";
  failing: string[];
  culprit: string | null;
  next: string;
};

export function hopRestartDelayMs(): number {
  return 250;
}

export function icePathIsLive(s: {
  ice?: string;
  signaling?: string;
  connection?: string;
}): boolean {
  const ice = String(s.ice || "").toLowerCase();
  if (ice !== "connected" && ice !== "completed") return false;
  const sig = String(s.signaling || "").toLowerCase();
  const conn = String(s.connection || "").toLowerCase();
  if (sig === "have-local-offer" || sig === "new" || sig === "none" || sig === "") return false;
  if (conn === "new" || conn === "none" || conn === "") return false;
  return true;
}

export function formatHopField(kind: "dc" | "connection" | "ice" | "signaling", value: string): string {
  const v = String(value || "").toLowerCase();
  if (kind === "dc") {
    if (v === "open") return "открыта";
    if (v === "connecting") return "собирается";
    if (v === "closing" || v === "closed" || v === "none") return "нет";
  }
  if (kind === "connection") {
    if (v === "connected") return "есть";
    if (v === "connecting") return "сходится";
    if (v === "new") return "старт";
    if (v === "failed") return "обрыв";
    if (v === "disconnected" || v === "closed" || v === "none") return "нет";
  }
  if (kind === "ice") {
    if (v === "connected") return "найден";
    if (v === "completed") return "сбор ок";
    if (v === "checking") return "ищет";
    if (v === "new") return "старт";
    if (v === "failed") return "не найден";
    if (v === "disconnected" || v === "closed" || v === "none") return "нет";
  }
  if (kind === "signaling") {
    if (v === "stable") return "есть";
    if (v === "have-local-offer") return "жду ответ";
    if (v === "have-remote-offer") return "отвечаю";
    if (v === "new") return "старт";
  }
  return v || "-";
}

export function formatHopCaption(s: {
  rtc?: boolean;
  pongAgeMs?: number | null;
  peerHost?: string | null;
}): string {
  if (!s.rtc) return "Трубы нет. Демон сам собирает.";
  const host = s.peerHost ? ` Отвечает ${s.peerHost}.` : "";
  if (s.pongAgeMs == null || Number(s.pongAgeMs) < 0) {
    return host ? `Канал жив.${host}` : "Канал жив. Жду первый пульс.";
  }
  const sec = Math.max(0, Math.round(Number(s.pongAgeMs) / 1000));
  return `Канал жив. Пульс ${sec} с назад.${host}`;
}

export function parseHopControl(input: unknown): HopBoardAction | null {
  if (!input || typeof input !== "object") return null;
  const action = String((input as { action?: unknown }).action || "")
    .trim()
    .toLowerCase();
  return (HOP_BOARD_ACTIONS as readonly string[]).includes(action) ? (action as HopBoardAction) : null;
}

export function shapeHopStatus(
  s: Partial<{
    rtc: boolean;
    pid: number;
    side: string;
    dc: string;
    connection: string;
    ice: string;
    signaling: string;
    gen: number;
    epoch: string | null;
    pongAgeMs: number | null;
    peerHost: string | null;
  }> = {},
): HopStatusView {
  const dc = String(s.dc || "none");
  const connection = String(s.connection || "none");
  const ice = String(s.ice || "none");
  const peerHost = s.peerHost == null || s.peerHost === "" ? null : String(s.peerHost);
  const ageNum = s.pongAgeMs == null ? NaN : Number(s.pongAgeMs);
  const pongAgeMs = Number.isFinite(ageNum) ? ageNum : null;
  const rtc = Boolean(s.rtc);
  return {
    rtc,
    pid: Number(s.pid) || 0,
    side: String(s.side || "dirty"),
    dc,
    connection,
    ice,
    signaling: String(s.signaling || "none"),
    gen: Number(s.gen) || 0,
    epoch: s.epoch == null || s.epoch === "" ? null : String(s.epoch),
    pongAgeMs,
    peerHost,
    caption: formatHopCaption({ rtc, pongAgeMs, peerHost }),
    dcText: formatHopField("dc", dc),
    connectionText: formatHopField("connection", connection),
    iceText: icePathIsLive({ ice, signaling: String(s.signaling || "none"), connection })
      ? "найден"
      : formatHopField("ice", ice === "connected" ? "completed" : ice),
    signalingText: formatHopField("signaling", String(s.signaling || "none")),
  };
}

export function parseDoctorStdout(text: string): DoctorParse {
  const lines = String(text || "").split(/\r?\n/);
  let verdict: "GREEN" | "RED" = "RED";
  let failing: string[] = [];
  let culprit: string | null = null;
  let next = "";
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("{") && t.endsWith("}")) {
      try {
        const j = JSON.parse(t) as {
          verdict?: string;
          failing?: unknown;
          culprit?: unknown;
        };
        if (j.verdict === "GREEN" || j.verdict === "RED") {
          verdict = j.verdict;
          failing = Array.isArray(j.failing) ? j.failing.map((x) => String(x)) : [];
          culprit = j.culprit == null ? null : String(j.culprit);
        }
      } catch {
        // not a summary line
      }
    }
    if (t.startsWith("NEXT ")) next = t.slice(5);
  }
  return { verdict, failing, culprit, next };
}

export function renderHopBoardHtml(): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hop</title>
<style>
  :root {
    --bg: #12110f;
    --panel: #1c1a17;
    --line: #2e2a24;
    --ink: #efe7d8;
    --mute: #9a917f;
    --live: #8fd99a;
    --down: #e07a5f;
    --btn: #2a2620;
    --btn-ink: #efe7d8;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--ink); font: 15px/1.45 "Segoe UI", sans-serif; }
  body { padding: 28px 22px 40px; }
  .wrap { max-width: 860px; margin: 0 auto; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 22px; }
  h1 { font-size: 22px; font-weight: 650; letter-spacing: 0.08em; text-transform: uppercase; margin: 0; }
  .pulse { font-size: 13px; color: var(--mute); }
  .pulse b { color: var(--ink); font-weight: 600; }
  .hero {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 28px 26px 24px;
    margin-bottom: 16px;
  }
  .hero .label { color: var(--mute); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; }
  .hero h2 { margin: 8px 0 0; font-size: 42px; letter-spacing: -0.03em; }
  .hero .caption { margin: 10px 0 0; color: var(--mute); font-size: 16px; }
  .hero.up h2 { color: var(--live); }
  .hero.down h2 { color: var(--down); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 18px 0 0; }
  .cell { background: #161410; border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
  .cell .k { color: var(--mute); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; }
  .cell .v { margin-top: 4px; font-variant-numeric: tabular-nums; word-break: break-all; }
  .log {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 16px 18px;
    margin-top: 16px;
    min-height: 220px;
    max-height: 420px;
    overflow: auto;
    white-space: pre-wrap;
    font-family: Consolas, "Courier New", monospace;
    font-size: 13px;
    color: #d7ccb8;
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Hop</h1>
    <div class="pulse">обновление <b id="tick">-</b></div>
  </header>
  <section class="hero down" id="hero">
    <div class="label">Канал</div>
    <h2 id="heroText">Нет канала</h2>
    <p class="caption" id="caption">Демон еще не ответил.</p>
    <div class="grid">
      <div class="cell"><div class="k">Демон</div><div class="v" id="fSide">-</div></div>
      <div class="cell"><div class="k">pid</div><div class="v" id="fPid">-</div></div>
      <div class="cell"><div class="k">Труба</div><div class="v" id="fDc">-</div></div>
      <div class="cell"><div class="k">Сессия</div><div class="v" id="fConn">-</div></div>
      <div class="cell"><div class="k">Сигнал</div><div class="v" id="fSig">-</div></div>
      <div class="cell"><div class="k">Путь</div><div class="v" id="fIce">-</div></div>
      <div class="cell"><div class="k">Попытка</div><div class="v" id="fGen">-</div></div>
      <div class="cell"><div class="k">epoch</div><div class="v" id="fEpoch">-</div></div>
    </div>
  </section>
  <div class="log" id="log">Жду события канала.</div>
</div>
<script>
const logEl = document.getElementById("log");
const hero = document.getElementById("hero");
let after = 0;
let boot = true;
function stamp(t) {
  try { return new Date(t).toLocaleTimeString("ru-RU"); } catch { return ""; }
}
function paint(s) {
  const up = Boolean(s && s.rtc);
  hero.className = "hero " + (up ? "up" : "down");
  document.getElementById("heroText").textContent = up ? "Жив" : "Нет канала";
  document.getElementById("caption").textContent = (s && s.caption) || (up ? "Канал жив." : "Трубы нет. Демон сам собирает.");
  document.getElementById("fSide").textContent = s.side || "-";
  document.getElementById("fPid").textContent = s.pid || "-";
  document.getElementById("fDc").textContent = s.dcText || s.dc || "-";
  document.getElementById("fConn").textContent = s.connectionText || s.connection || "-";
  document.getElementById("fSig").textContent = s.signalingText || "-";
  document.getElementById("fIce").textContent = s.iceText || s.ice || "-";
  document.getElementById("fGen").textContent = s.gen == null ? "-" : String(s.gen);
  document.getElementById("fEpoch").textContent = s.epoch || "-";
  document.getElementById("tick").textContent = new Date().toLocaleTimeString("ru-RU");
}
function appendLines(rows) {
  if (!rows || !rows.length) return;
  if (boot) {
    logEl.textContent = "";
    boot = false;
  }
  for (const row of rows) {
    const p = document.createElement("div");
    p.textContent = stamp(row.t) + "  " + row.text;
    logEl.appendChild(p);
    after = Math.max(after, Number(row.id) || 0);
  }
  logEl.scrollTop = logEl.scrollHeight;
}
async function refresh() {
  try {
    const s = await fetch("/status").then((r) => r.json());
    paint(s);
    const q = await fetch("/log?after=" + after).then((r) => r.json());
    appendLines(q.lines || []);
  } catch (e) {
    paint({ rtc: false });
    if (boot) logEl.textContent = "Демон не отвечает: " + (e.message || e);
  }
}
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>
`;
}
