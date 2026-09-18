function localFromStatus(status) {
  if (status == null || typeof status !== "object") return null;
  const report = status.report;
  if (report && typeof report === "object" && report.local && typeof report.local === "object") {
    return report.local;
  }
  if (status.rtc != null || status.dc != null || status.signaling != null) return status;
  if (status.bootstrap) return {};
  return null;
}

function lower(value) {
  return String(value || "").toLowerCase();
}

export function isAssembling(local) {
  if (!local || typeof local !== "object") return false;
  if (local.rtc) return false;
  return (
    lower(local.dc) === "connecting" ||
    lower(local.signaling) === "have-local-offer" ||
    lower(local.connection) === "connecting" ||
    lower(local.ice) === "checking"
  );
}

function pulseText(local) {
  const age = local?.pongAgeMs == null ? NaN : Number(local.pongAgeMs);
  if (!Number.isFinite(age) || age < 0) return "";
  const sec = Math.max(0, Math.round(age / 1000));
  return ` Пульс ${sec} с назад.`;
}

function sideOf(status, local) {
  return String(status?.bootstrap?.side || local?.side || "dirty").toLowerCase();
}

function rtcMark(up) {
  return up ? "ок" : "нет";
}

function statusMenu(status, local) {
  const side = sideOf(status, local);
  const menu = [];
  if (side === "clean") {
    menu.push({ label: `Чистая  ${rtcMark(Boolean(local?.rtc))}`, action: "none" });
  } else {
    menu.push({ label: `Грязная  ${rtcMark(Boolean(local?.rtc))}`, action: "none" });
    const peer = status?.report?.peer;
    if (peer && typeof peer === "object") {
      menu.push({ label: `Чистая  ${rtcMark(Boolean(peer.rtc))}`, action: "none" });
    }
  }
  menu.push({ label: "Подробности", action: "details" });
  return menu;
}

export function trayViewFromStatus(status) {
  const local = localFromStatus(status);
  if (status == null || (local == null && !status?.bootstrap)) {
    return {
      color: "gray",
      headline: "Нет supervisor",
      tooltip: "Supervisor недоступен.",
      menu: [{ label: "Подробности", action: "details" }],
    };
  }

  const rtc = Boolean(local?.rtc);
  const assembling = isAssembling(local) || (status?.report == null && Boolean(status?.bootstrap));
  let color = "red";
  let headline = "Нет трубы";
  let tooltip = "Трубы нет.";
  if (rtc) {
    color = "green";
    headline = "Жива";
    tooltip = `Труба жива.${pulseText(local)}`;
  } else if (assembling) {
    color = "yellow";
    headline = "Собирается";
    tooltip = "Труба собирается.";
  }

  return {
    color,
    headline,
    tooltip,
    menu: statusMenu(status, local),
  };
}

export function renderCasualBoardHtml() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Труба</title><style>
body{margin:0;background:#12110f;color:#efe7d8;font:16px/1.45 Segoe UI,Arial;padding:32px 24px}
main{max-width:560px;margin:auto}
h1{font-size:48px;margin:0 0 8px;letter-spacing:-0.03em}
.green{color:#8fd99a}.yellow{color:#e6c35c}.red{color:#e07a5f}.gray{color:#9a917f}
p{color:#9a917f;margin:0 0 24px}a{color:#8ab4f8}
</style></head><body><main>
<h1 id="hero" class="gray">Нет supervisor</h1>
<p id="caption">Демон еще не ответил.</p>
<p><a href="http://127.0.0.1:18765/">отладка</a></p>
<script>
function localOf(s){
  if(!s) return null;
  if(s.report && s.report.local) return s.report.local;
  if(s.rtc!=null || s.dc!=null) return s;
  if(s.bootstrap) return {};
  return null;
}
function assembling(l){
  if(!l || l.rtc) return false;
  const x=v=>String(v||"").toLowerCase();
  return x(l.dc)==="connecting"||x(l.signaling)==="have-local-offer"||x(l.connection)==="connecting"||x(l.ice)==="checking";
}
async function tick(){
  const hero=document.getElementById("hero");
  const cap=document.getElementById("caption");
  try{
    const s=await fetch("/status").then(r=>r.json());
    const l=localOf(s);
    if(s==null || (l==null && !s.bootstrap)){
      hero.textContent="Нет supervisor"; hero.className="gray"; cap.textContent="Supervisor недоступен.";
      return;
    }
    if(l && l.rtc){
      hero.textContent="Жива"; hero.className="green";
      const age=l.pongAgeMs==null?NaN:Number(l.pongAgeMs);
      cap.textContent=Number.isFinite(age)&&age>=0?("Труба жива. Пульс "+Math.max(0,Math.round(age/1000))+" с назад."):"Труба жива.";
      return;
    }
    if(assembling(l) || (s.bootstrap && s.report==null)){ hero.textContent="Собирается"; hero.className="yellow"; cap.textContent="Труба собирается."; return; }
    hero.textContent="Нет трубы"; hero.className="red"; cap.textContent="Трубы нет.";
  }catch(e){
    hero.textContent="Нет supervisor"; hero.className="gray"; cap.textContent="Supervisor недоступен.";
  }
}
tick(); setInterval(tick,2000);
</script></main></body></html>`;
}
