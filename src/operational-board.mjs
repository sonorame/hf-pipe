export function operationalView(status) {
  const local = status?.report?.local || status || {};
  const peer = status?.report?.peer || status?.peer || null;
  const stale = Number(status?.reportAgeMs || 0) > 15000;
  const up = local.rtc === true && !stale;
  const error = local.lastError?.text || peer?.lastError?.text || status?.lastExit?.watchdogReason || null;
  const tls = /CERT|certificate/i.test(error || "");
  const recoveryClock = status?.recovery || local.recovery;
  const elapsed = Math.max(0, Math.floor(Number(recoveryClock?.elapsedMs || 0) / 1000));
  const budget = Math.max(1, Math.floor(Number(recoveryClock?.budgetMs || 60000) / 1000));
  const recoveryStep = stale ? "Перезапуск зависшего процесса" : tls ? "Перезапуск после ошибки сертификата" : "Обмен данными для нового соединения";
  const verification = local.kiloVerification || peer?.kiloVerification;
  const verificationAge = Date.now() - Date.parse(verification?.checkedAt || "");
  const checked = verification?.ok === true && verification.buildId === local.buildId &&
    Number(verification.protocolVersion) === Number(local.protocolVersion) && verificationAge >= -300000 && verificationAge <= 900000;
  return {
    up, color: up ? "green" : "yellow", headline: up ? "Труба работает" : "Восстанавливаем связь",
    caption: stale ? "Процесс перестал обновлять состояние. Watchdog проверяет его." : up ?
      "Файлы и команды доступны через чистую машину." : tls ?
      "Проверка сертификата не прошла. Восстановление сохраняет проверку TLS." :
      "Ожидаем соединение двух машин. Состояние обновляется автоматически.",
    side: local.side || status?.bootstrap?.side || "dirty",
    clean: up ? "На связи" : "Связь не подтверждена",
    kilo: checked ? "Ответ ChatGPT проверен" : up ? "Канал доступен, ответ модели еще не проверен" : "Ожидает восстановления трубы",
    kiloCheckedAt: checked ? verification.checkedAt : null,
    error,
    recovery: up ? "Восстановление не требуется" : recoveryStep + (recoveryClock ?
      elapsed >= budget ? ` · ${elapsed} с, целевой срок ${budget} с превышен` : ` · ${elapsed} из ${budget} с` : ""),
    recent: (local.traffic?.recent || []).slice(-10).reverse(),
    txBytes: local.egress?.txBytes ?? null, rxBytes: local.egress?.rxBytes ?? null,
    streams: local.egress?.streams ?? null, queuedBytes: local.egress?.queuedBytes ?? null,
    memoryBytes: local.memoryBytes ?? null, pending: local.pendingCalls ?? null,
    buildId: local.buildId || status?.bootstrap?.current || "-", protocol: local.protocolVersion ?? "-",
    workerPid: local.pid || null,
  };
}

export function renderOperationalBoardHtml() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>hf-pipe: состояние</title>
<style>
:root{color-scheme:dark;--bg:#111512;--panel:#1b211d;--muted:#9cab9f;--line:#303b33;--green:#9ce5ad;--yellow:#f2d58a}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#e8eee9;font:16px/1.5 Segoe UI,Arial;padding:28px}main{max-width:1100px;margin:auto}header{display:flex;justify-content:space-between;gap:18px;color:var(--muted);margin-bottom:28px}h1{font-size:clamp(28px,4vw,44px);line-height:1.2;margin:0 0 12px}h2{font-size:18px;margin:0 0 14px}p{margin:0;color:var(--muted)}section{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:24px;margin-bottom:18px}.green{color:var(--green)}.yellow{color:var(--yellow)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:16px}.cards{margin-top:24px}.label{color:var(--muted);font-size:13px;margin-bottom:6px}.value{font-size:18px}.error{margin-top:18px;padding-top:18px;border-top:1px solid var(--line);overflow-wrap:anywhere}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:18px}.metric{font-size:24px}.history{width:100%;border-collapse:collapse;font-size:14px}.history th,.history td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line)}.history th{color:var(--muted);font-weight:400}.history td:last-child{white-space:nowrap}.chart{width:100%;height:100px;background:#141a16;border-radius:8px}.legend{display:flex;gap:22px;font-size:13px;color:var(--muted);margin-top:8px}small{color:var(--muted)}details{font-size:13px;color:var(--muted)}.note{margin-top:8px;font-size:13px}@media(max-width:650px){body{padding:16px}.metrics{grid-template-columns:repeat(2,1fr)}section{padding:18px}.history .path{display:none}}
</style></head><body><main>
<header><span>hf-pipe · <span id="side">соединение двух машин</span></span><span id="updated">Проверяем состояние…</span></header>
<section><h1 id="hero" class="yellow">Проверяем трубу</h1><p id="caption">Получаем свежие данные.</p><div class="grid cards"><div><div class="label">Чистая машина</div><div id="clean" class="value">—</div></div><div><div class="label">Kilo + ChatGPT</div><div id="kilo" class="value">—</div><small id="checked"></small></div><div><div class="label">Восстановление</div><div id="recovery" class="value">—</div></div></div><div class="error"><div class="label">Последний зафиксированный сбой</div><div id="error">Не получен</div></div></section>
<div class="grid"><section><h2>Обмен через трубу</h2><div class="metrics"><div><div class="label">Отправка</div><div class="metric" id="tx">—</div></div><div><div class="label">Приём</div><div class="metric" id="rx">—</div></div><div><div class="label">Потоки</div><div class="metric" id="streams">—</div></div><div><div class="label">В очереди</div><div class="metric" id="queued">—</div></div></div><svg class="chart" id="chart" viewBox="0 0 600 100" preserveAspectRatio="none" role="img" aria-label="Скорость обмена за последние две минуты"><polyline id="txline" fill="none" stroke="#9ce5ad" stroke-width="2"/><polyline id="rxline" fill="none" stroke="#9fc9ff" stroke-width="2"/></svg><div class="legend"><span>Зелёный: отправка</span><span>Голубой: приём</span></div><p class="note">График собирается, пока открыта страница.</p></section><section><h2>Нагрузка</h2><div class="label">Память процесса</div><div id="memory" class="metric">—</div><div class="label cards">Ожидающие запросы</div><div id="pending" class="metric">—</div><svg class="chart cards" viewBox="0 0 600 100" preserveAspectRatio="none" role="img" aria-label="Память процесса за последние две минуты"><polyline id="memoryline" fill="none" stroke="#f2d58a" stroke-width="2"/></svg><p class="note">Показания обновляются каждые 2 секунды.</p></section></div>
<section><h2>Последние операции</h2><table class="history"><thead><tr><th>Время</th><th>Действие</th><th class="path">Ресурс</th><th>Длительность</th><th>Результат</th></tr></thead><tbody id="recent"></tbody></table><p id="empty" class="note">Операций пока нет.</p></section><details><summary>Версия и диагностика</summary><p id="version"></p></details>
<script>const view=${operationalView.toString()};
const text=(id,value)=>{document.getElementById(id).textContent=value};const bytes=n=>n==null?'—':n>=1048576?(n/1048576).toFixed(1)+' МБ':n>=1024?(n/1024).toFixed(1)+' КБ':Math.round(n)+' Б';
const names={ping:'Проверка связи',context:'Доступ к clean',shell:'Команда',lab:'Стенд',read:'Чтение',write:'Запись',list:'Список файлов',tree:'Дерево',grep:'Поиск',glob:'Поиск файлов',pull:'Загрузка',screenshot:'Снимок экрана'};
let previous=null;const history=[];const memoryHistory=[];let stopped=false;
async function tick(){try{const r=await fetch('/status',{signal:AbortSignal.timeout(4000),cache:'no-store'});if(!r.ok)throw Error('status');const s=await r.json();const v=view(s);const now=Date.now();text('hero',v.headline);document.getElementById('hero').className=v.color;text('caption',v.caption);text('clean',v.clean);text('kilo',v.kilo);text('checked',v.kiloCheckedAt?'Проверено: '+new Date(v.kiloCheckedAt).toLocaleString('ru-RU'):'');text('recovery',v.recovery);text('error',v.error||'Сбоев не зафиксировано');text('side',v.side==='clean'?'чистая машина':'грязная машина');text('updated','Обновлено '+new Date().toLocaleTimeString('ru-RU',{hour12:false}));text('memory',bytes(v.memoryBytes));if(v.memoryBytes!=null){memoryHistory.push(v.memoryBytes);if(memoryHistory.length>60)memoryHistory.shift();const high=Math.max(1048576,...memoryHistory);document.getElementById('memoryline').setAttribute('points',memoryHistory.map((m,i)=>(i/59*600)+','+(95-m/high*90)).join(' '))}text('pending',v.pending??'—');text('streams',v.streams??'—');text('queued',bytes(v.queuedBytes));text('version','Сборка '+v.buildId+' · протокол '+v.protocol);
const measured=v.txBytes!=null&&v.rxBytes!=null;let tx=null,rx=null;if(measured){tx=0;rx=0;if(previous&&previous.pid===v.workerPid){const seconds=(now-previous.at)/1000;tx=Math.max(0,v.txBytes-previous.tx)/seconds;rx=Math.max(0,v.rxBytes-previous.rx)/seconds}previous={at:now,tx:v.txBytes,rx:v.rxBytes,pid:v.workerPid};history.push({tx,rx});if(history.length>60)history.shift()}else{previous=null;history.length=0}text('tx',bytes(tx)+(measured?'/с':''));text('rx',bytes(rx)+(measured?'/с':''));const max=Math.max(1024,...history.flatMap(p=>[p.tx,p.rx]));for(const key of ['tx','rx'])document.getElementById(key+'line').setAttribute('points',history.map((p,i)=>(i/59*600)+','+(95-p[key]/max*90)).join(' '));
const body=document.getElementById('recent');body.replaceChildren();for(const op of v.recent){const row=document.createElement('tr');const values=[new Date(op.at).toLocaleTimeString('ru-RU',{hour12:false}),names[op.type]||op.type,op.path||'—',Math.round(op.durationMs||0)+' мс',op.ok?'Выполнено':'Ошибка'];values.forEach((value,i)=>{const cell=document.createElement('td');cell.textContent=value;if(i===2)cell.className='path';row.append(cell)});body.append(row)}document.getElementById('empty').hidden=v.recent.length>0;
}catch(e){text('hero','Нет свежего состояния');document.getElementById('hero').className='yellow';text('caption','Страница повторит проверку. Старые показания не подтверждают доступность.');text('clean','Не подтверждена');text('kilo','Не подтверждено');text('updated','Данные устарели');}finally{if(!stopped)setTimeout(tick,2000)}}window.addEventListener('pagehide',()=>stopped=true);tick();</script></main></body></html>`;
}
