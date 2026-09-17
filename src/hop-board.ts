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
  }> = {},
): HopStatusView {
  return {
    rtc: Boolean(s.rtc),
    pid: Number(s.pid) || 0,
    side: String(s.side || "dirty"),
    dc: String(s.dc || "none"),
    connection: String(s.connection || "none"),
    ice: String(s.ice || "none"),
    signaling: String(s.signaling || "none"),
    gen: Number(s.gen) || 0,
    epoch: s.epoch == null || s.epoch === "" ? null : String(s.epoch),
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
  .hero.up h2 { color: var(--live); }
  .hero.down h2 { color: var(--down); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 18px 0 0; }
  .cell { background: #161410; border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
  .cell .k { color: var(--mute); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; }
  .cell .v { margin-top: 4px; font-variant-numeric: tabular-nums; word-break: break-all; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0; }
  button {
    background: var(--btn);
    color: var(--btn-ink);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 10px 16px;
    font: inherit;
    cursor: pointer;
  }
  button:hover { border-color: #5a5348; }
  button:disabled { opacity: 0.45; cursor: default; }
  button.primary { background: #243326; border-color: #3d5a40; color: var(--live); }
  button.danger { background: #2a1c18; border-color: #6a3b2f; color: var(--down); }
  .log {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 16px 18px;
    min-height: 120px;
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
    <div class="grid">
      <div class="cell"><div class="k">Демон</div><div class="v" id="fSide">-</div></div>
      <div class="cell"><div class="k">pid</div><div class="v" id="fPid">-</div></div>
      <div class="cell"><div class="k">DC</div><div class="v" id="fDc">-</div></div>
      <div class="cell"><div class="k">Связь</div><div class="v" id="fConn">-</div></div>
      <div class="cell"><div class="k">ICE</div><div class="v" id="fIce">-</div></div>
      <div class="cell"><div class="k">gen</div><div class="v" id="fGen">-</div></div>
      <div class="cell"><div class="k">epoch</div><div class="v" id="fEpoch">-</div></div>
    </div>
  </section>
  <div class="actions">
    <button class="primary" data-act="ping">Пинг</button>
    <button data-act="doctor">Доктор</button>
    <button data-act="recycle">Новый канал</button>
    <button class="danger" data-act="restart">Перезапуск</button>
  </div>
  <div class="log" id="log">Жду статус демона.</div>
</div>
<script>
const logEl = document.getElementById("log");
const hero = document.getElementById("hero");
const btns = [...document.querySelectorAll("button[data-act]")];
function setLog(t) { logEl.textContent = t; }
function paint(s) {
  const up = Boolean(s && s.rtc);
  hero.className = "hero " + (up ? "up" : "down");
  document.getElementById("heroText").textContent = up ? "Жив" : "Нет канала";
  document.getElementById("fSide").textContent = s.side || "-";
  document.getElementById("fPid").textContent = s.pid || "-";
  document.getElementById("fDc").textContent = s.dc || "-";
  document.getElementById("fConn").textContent = s.connection || "-";
  document.getElementById("fIce").textContent = s.ice || "-";
  document.getElementById("fGen").textContent = s.gen == null ? "-" : String(s.gen);
  document.getElementById("fEpoch").textContent = s.epoch || "-";
  document.getElementById("tick").textContent = new Date().toLocaleTimeString("ru-RU");
}
async function refresh() {
  try {
    const s = await fetch("/status").then((r) => r.json());
    paint(s);
  } catch (e) {
    paint({ rtc: false });
    setLog("Демон не отвечает: " + (e.message || e));
  }
}
async function act(action) {
  btns.forEach((b) => { b.disabled = true; });
  setLog(action === "doctor" ? "Доктор идет по швам..." : "Команда " + action + "...");
  try {
    const r = await fetch("/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const j = await r.json();
    if (action === "doctor") {
      const lines = [];
      lines.push((j.verdict || "?") + (j.culprit ? "  шов " + j.culprit : ""));
      if (j.next) lines.push(j.next);
      if (j.raw) lines.push("", j.raw.trim());
      setLog(lines.join("\\n"));
    } else if (action === "ping") {
      const host = j.body && j.body.host ? j.body.host : "";
      setLog(j.ok ? ("Пинг ок" + (host ? "  " + host : "")) : ("Пинг не прошел: " + (j.error || "rtc down")));
    } else if (action === "recycle") {
      setLog(j.ok ? ("Новый канал epoch " + (j.epoch || "") + " gen " + (j.gen || "")) : ("Не вышло: " + (j.error || r.status)));
    } else if (action === "restart") {
      setLog("Демон уходит на перезапуск. Страница сама дождется.");
    } else {
      setLog(JSON.stringify(j, null, 2));
    }
  } catch (e) {
    setLog(String(e.message || e));
  }
  btns.forEach((b) => { b.disabled = false; });
  await refresh();
}
btns.forEach((b) => b.addEventListener("click", () => act(b.getAttribute("data-act"))));
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>
`;
}
