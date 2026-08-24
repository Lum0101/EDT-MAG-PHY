const DAY_START = 8, DAY_END = 18, SLOT_PX = 56;
const DOW_LABELS = ["Lun","Mar","Mer","Jeu","Ven"];
const MOBILE_BREAKPOINT = 680;

let eventsA = [], eventsB = [], mergedEvents = [];
let courseColors = {};
let currentWeekStart = startOfWeek(new Date());
let activeGroup = "all"; // "all" | "A" | "B"
let selectedDayIndex = initialDayIndex();

function initialDayIndex(){
  const wd = new Date().getDay(); // 0=dim ... 6=sam
  if(wd >= 1 && wd <= 5) return wd - 1;
  return wd === 0 ? 0 : 4; // week-end -> lundi ou vendredi le plus proche
}
function isMobile(){
  return window.matchMedia(`(max-width:${MOBILE_BREAKPOINT}px)`).matches;
}

/* ---------- dates ---------- */
function startOfWeek(d){
  const day = (d.getDay()+6)%7;
  const r = new Date(d); r.setHours(0,0,0,0); r.setDate(r.getDate()-day);
  return r;
}
function sameDay(a,b){
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}
function fmtDayMonth(d){ return d.toLocaleDateString('fr-FR', {day:'numeric', month:'long'}); }

/* ---------- parseur ICS ---------- */
function unescapeICS(s){
  return s.replace(/\\n/g,"\n").replace(/\\,/g,",").replace(/\\;/g,";").replace(/\\\\/g,"\\");
}
function parseICSDate(value){
  const isUTC = value.endsWith("Z");
  const y = +value.slice(0,4), mo = +value.slice(4,6)-1, d = +value.slice(6,8);
  const h = +value.slice(9,11), mi = +value.slice(11,13), se = +(value.slice(13,15)||0);
  if(isUTC){
    const utcDate = new Date(Date.UTC(y,mo,d,h,mi,se));
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone:'Europe/Paris', hour12:false,
      year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'
    }).formatToParts(utcDate);
    const g = t => +parts.find(p=>p.type===t).value;
    return new Date(g('year'), g('month')-1, g('day'), g('hour')%24, g('minute'), g('second'));
  }
  return new Date(y,mo,d,h,mi,se);
}
function parseICS(text){
  text = text.replace(/\r\n/g,"\n");
  const rawLines = text.split("\n");
  const lines = [];
  for(const line of rawLines){
    if((line.startsWith(" ") || line.startsWith("\t")) && lines.length){
      lines[lines.length-1] += line.slice(1);
    } else lines.push(line);
  }
  const out = [];
  let cur = null;
  for(const line of lines){
    if(line === "BEGIN:VEVENT"){ cur = {}; continue; }
    if(line === "END:VEVENT"){ if(cur) out.push(cur); cur = null; continue; }
    if(!cur) continue;
    const idx = line.indexOf(":");
    if(idx === -1) continue;
    const key = line.slice(0,idx), val = line.slice(idx+1);
    const keyBase = key.split(";")[0];
    if(keyBase === "DTSTART") cur.start = parseICSDate(val);
    else if(keyBase === "DTEND") cur.end = parseICSDate(val);
    else if(keyBase === "SUMMARY") cur.summary = unescapeICS(val).trim();
    else if(keyBase === "LOCATION") cur.location = unescapeICS(val).trim();
  }
  return out
    .filter(e=>e.start && e.end && e.summary)
    .filter(e=>e.summary.trim().toUpperCase() !== "ETALON");
}

/* ---------- couleurs / matière ---------- */
const PAST_COLOR = {bg:"#e6e6e1", ink:"#8b8b83"};
const GOLDEN_ANGLE = 137.508; // écart angulaire maximisant la distinction entre teintes successives

function parseCourse(summary){
  const m = summary.match(/^(.*?)[\s]*(CMTD|CM|TD|TP)(\d+)?(-\d+)?\s*$/i);
  if(m) return { base: m[1].trim(), type: m[2].toUpperCase() };
  return { base: summary.trim(), type: "" };
}
function colorFor(base){
  if(!(base in courseColors)){
    const idx = Object.keys(courseColors).length;
    // décale le point de départ pour éviter de commencer pile sur le rouge/accent
    const hue = (idx * GOLDEN_ANGLE + 30) % 360;
    courseColors[base] = {
      bg: `hsl(${hue.toFixed(1)}, 46%, 90%)`,
      ink: `hsl(${hue.toFixed(1)}, 55%, 30%)`,
    };
  }
  return courseColors[base];
}

/* ---------- fusion intelligente A + B ---------- */
function eventKey(e){
  return e.start.getTime()+"|"+e.end.getTime()+"|"+e.summary.toLowerCase();
}
function mergeGroups(listA, listB){
  const mapB = new Map();
  listB.forEach(e=>mapB.set(eventKey(e), e));
  const used = new Set();
  const merged = [];
  listA.forEach(e=>{
    const k = eventKey(e);
    if(mapB.has(k)){ merged.push({...e, group:"commun"}); used.add(k); }
    else merged.push({...e, group:"A"});
  });
  listB.forEach(e=>{
    const k = eventKey(e);
    if(!used.has(k)) merged.push({...e, group:"B"});
  });
  return merged;
}

function rebuildMerged(){
  if(eventsA.length && eventsB.length) mergedEvents = mergeGroups(eventsA, eventsB);
  else if(eventsA.length) mergedEvents = eventsA.map(e=>({...e, group:"A"}));
  else if(eventsB.length) mergedEvents = eventsB.map(e=>({...e, group:"B"}));
  else mergedEvents = [];

  courseColors = {};
  mergedEvents = mergedEvents.map(e=>{
    const {base,type} = parseCourse(e.summary);
    return {...e, base, type, color: colorFor(base)};
  }).sort((a,b)=>a.start-b.start);
  mergedEvents.forEach(e=>colorFor(e.base));

  if(mergedEvents.length){
    const firstStart = startOfWeek(mergedEvents[0].start);
    const lastStart = startOfWeek(mergedEvents[mergedEvents.length-1].start);
    const now = startOfWeek(new Date());
    currentWeekStart = (now < firstStart || now > lastStart) ? firstStart : now;
  }
  updateRangeInfo();
  render();
}

function updateRangeInfo(){
  const visible = visibleEvents();
  const el = document.getElementById('rangeInfo');
  if(!mergedEvents.length){
    el.textContent = "Aucune séance chargée — vérifie grpa.ics / grpb.ics dans le dossier.";
    return;
  }
  if(!visible.length){
    el.textContent = "Aucune séance pour ce groupe.";
    return;
  }
  const first = visible[0].start, last = visible[visible.length-1].end;
  const nCommun = mergedEvents.filter(e=>e.group==="commun").length;
  const extra = (eventsA.length && eventsB.length) ? ` · ${nCommun} séances communes aux deux groupes` : "";
  el.textContent = `${visible.length} séances affichées · du ${fmtDayMonth(first)} au ${fmtDayMonth(last)} ${last.getFullYear()}${extra}`;
}

function visibleEvents(){
  if(activeGroup === "all") return mergedEvents;
  return mergedEvents.filter(e=>e.group===activeGroup || e.group==="commun");
}

/* ---------- répartition en colonnes des créneaux simultanés ---------- */
function layoutDay(dayEvents){
  const sorted = [...dayEvents].sort((a,b)=>a.start-b.start || a.end-b.end);
  const cols = [];
  const placed = [];
  let cluster = [];
  let clusterMaxCol = 0;

  function flushCluster(){
    if(!cluster.length) return;
    const nCols = clusterMaxCol + 1;
    cluster.forEach(p=>{ p.totalCols = nCols; });
    cluster = [];
    clusterMaxCol = 0;
  }

  sorted.forEach(e=>{
    for(let i=0;i<cols.length;i++){
      if(cols[i] !== null && cols[i] <= e.start.getTime()) cols[i] = null;
    }
    if(cols.every(c=>c===null) && cluster.length) flushCluster();
    let colIdx = cols.findIndex(c=>c===null);
    if(colIdx === -1){ colIdx = cols.length; cols.push(null); }
    cols[colIdx] = e.end.getTime();
    const p = {...e, col: colIdx};
    cluster.push(p);
    clusterMaxCol = Math.max(clusterMaxCol, colIdx);
    placed.push(p);
  });
  flushCluster();
  return placed;
}

/* ---------- onglets jour (mobile) ---------- */
function updateDayTabs(){
  const el = document.getElementById('dayTabs');
  if(!el) return;
  el.innerHTML = '';
  const todayReal = new Date();
  for(let i=0;i<5;i++){
    const d = new Date(currentWeekStart); d.setDate(d.getDate()+i);
    const btn = document.createElement('button');
    if(i === selectedDayIndex) btn.classList.add('active');
    if(sameDay(d, todayReal)) btn.classList.add('today');
    btn.innerHTML = `${DOW_LABELS[i]}<span class="tnum">${d.getDate()}</span>`;
    btn.addEventListener('click', ()=>{ selectedDayIndex = i; render(); });
    el.appendChild(btn);
  }
}

function updateNavLabels(mobile){
  document.getElementById('prevBtn').textContent = mobile ? '← Jour préc.' : '← Semaine préc.';
  document.getElementById('nextBtn').textContent = mobile ? 'Jour suiv. →' : 'Semaine suiv. →';
}

/* ---------- rendu grille ---------- */
const gridEl = document.getElementById('grid');
const weekLabelEl = document.getElementById('weekLabel');

function render(){
  gridEl.innerHTML = "";
  const todayReal = new Date();
  const nowTime = Date.now();
  const mobile = isMobile();

  updateDayTabs();
  updateNavLabels(mobile);

  const corner = document.createElement('div');
  corner.className = 'corner';
  gridEl.appendChild(corner);

  const allWeekDays = [];
  for(let i=0;i<5;i++){
    const d = new Date(currentWeekStart); d.setDate(d.getDate()+i);
    allWeekDays.push(d);
  }
  const shownIndices = mobile ? [selectedDayIndex] : [0,1,2,3,4];

  gridEl.style.gridTemplateColumns = mobile ? "48px 1fr" : "56px repeat(5, minmax(150px,1fr))";

  shownIndices.forEach(i=>{
    const d = allWeekDays[i];
    const head = document.createElement('div');
    head.className = 'head' + (sameDay(d, todayReal) ? ' today' : '');
    head.innerHTML = mobile
      ? `<span class="dow">${DOW_LABELS[i]} ${fmtDayMonth(d)}</span>`
      : `<span class="dow">${DOW_LABELS[i]}</span><span class="dnum">${d.getDate()}</span>`;
    gridEl.appendChild(head);
  });

  const nHours = DAY_END - DAY_START;
  gridEl.style.gridTemplateRows = `auto repeat(${nHours}, ${SLOT_PX}px)`;

  const hourCol = document.createElement('div');
  hourCol.className = 'hourcol';
  hourCol.style.gridRow = `2 / span ${nHours}`;
  hourCol.style.gridColumn = '1';
  for(let h=0; h<nHours; h++){
    const slot = document.createElement('div');
    slot.className = 'hourslot'; slot.style.position='relative';
    const lbl = document.createElement('span');
    lbl.className='hourlabel'; lbl.textContent = (DAY_START+h) + 'h';
    slot.appendChild(lbl);
    hourCol.appendChild(slot);
  }
  gridEl.appendChild(hourCol);

  const query = document.getElementById('searchBox').value.trim().toLowerCase();
  const visible = visibleEvents();
  let anyEvent = false;

  shownIndices.forEach((i, colPos)=>{
    const d = allWeekDays[i];
    const dayCol = document.createElement('div');
    dayCol.className = 'daycol' + (sameDay(d, todayReal) ? ' today' : '');
    dayCol.style.gridRow = `2 / span ${nHours}`;
    dayCol.style.gridColumn = String(colPos+2);
    for(let h=0; h<nHours; h++){
      const slot = document.createElement('div'); slot.className = 'slot';
      dayCol.appendChild(slot);
    }
    let dayEvents = visible.filter(e=>sameDay(e.start, d) &&
      (!query || e.summary.toLowerCase().includes(query) || (e.location||'').toLowerCase().includes(query)));

    dayEvents = layoutDay(dayEvents);

    dayEvents.forEach(e=>{
      anyEvent = true;
      const isPast = e.end.getTime() < nowTime;
      const startH = e.start.getHours() + e.start.getMinutes()/60;
      const endH = e.end.getHours() + e.end.getMinutes()/60;
      const top = Math.max(0,(startH - DAY_START)) * SLOT_PX;
      const height = Math.max(24,(endH - startH) * SLOT_PX - 3);
      const widthPct = 100 / e.totalCols;
      const leftPct = e.col * widthPct;
      const box = document.createElement('div');
      box.className = 'event' + (isPast ? ' past' : '');
      box.style.top = top + 'px'; box.style.height = height + 'px';
      box.style.left = `calc(${leftPct}% + 2px)`;
      box.style.width = `calc(${widthPct}% - 4px)`;
      const c = isPast ? PAST_COLOR : e.color;
      box.style.background = c.bg; box.style.color = c.ink;
      box.style.borderLeftColor = c.ink;
      const timeStr = e.start.toTimeString().slice(0,5) + '–' + e.end.toTimeString().slice(0,5);
      let badge = "";
      if(e.group === "A") badge = '<span class="badge a">A</span>';
      else if(e.group === "B") badge = '<span class="badge b">B</span>';
      box.innerHTML = `<span class="t">${timeStr}${e.type ? ' · '+e.type : ''}${badge}</span><span class="s">${e.base}</span>${e.location ? `<span class="l">${e.location.split(',')[0]}</span>` : ''}`;
      box.title = `${e.summary}\n${timeStr}\n${e.location||''}`;
      box.addEventListener('click', ()=>openEventModal(e, isPast, timeStr));
      dayCol.appendChild(box);
    });
    gridEl.appendChild(dayCol);
  });

  weekLabelEl.textContent = `Semaine du ${fmtDayMonth(allWeekDays[0])} au ${fmtDayMonth(allWeekDays[4])}`;

  if(!anyEvent){
    const empty = document.createElement('div');
    empty.style.gridColumn = '1 / -1';
    empty.style.gridRow = `2 / span ${nHours}`;
    empty.className = 'empty-week';
    empty.textContent = mergedEvents.length
      ? (query ? "Aucun cours ne correspond à ce filtre." : "Pas de cours ce jour-là.")
      : "En attente du chargement de grpa.ics / grpb.ics...";
    gridEl.appendChild(empty);
  }
}

/* ---------- modal détail d'un cours ---------- */
function groupLabel(g){
  if(g === "A") return "Groupe A uniquement";
  if(g === "B") return "Groupe B uniquement";
  return "Groupes A et B";
}
function openEventModal(e, isPast, timeStr){
  const body = document.getElementById('eventModalBody');
  const c = isPast ? PAST_COLOR : e.color;
  body.className = 'm-body' + (isPast ? ' past' : '');
  let badge = "";
  if(e.group === "A") badge = '<span class="badge a">A</span>';
  else if(e.group === "B") badge = '<span class="badge b">B</span>';
  body.innerHTML = `
    <div style="font-size:13px;color:#5a6b73;display:flex;align-items:center;flex-wrap:wrap;"><span style="background:${c.ink};display:inline-block;width:13px;height:13px;border-radius:3px;flex:none;
  vertical-align:middle;margin-right:6px;"></span>${fmtDayMonth(e.start)} · ${timeStr}${e.type ? ' · '+e.type : ''}${badge}${isPast ? ' · déjà passé' : ''}</div>
    <div style="color:#c1440e;font-weight:700;font-size:19px;margin:8px 0 12px;line-height:1.3;">${e.summary}</div>
    ${e.location ? `<div style=" display:flex;gap:8px;align-items:baseline;
  font-size:13.5px;color:var(--ink);margin-top:8px;"><span class="m-label">Salle:</span><span>${e.location}</span></div>` : ''}
    <div style=" display:flex;gap:8px;align-items:baseline;
  font-size:13.5px;color:var(--ink);margin-top:8px;"><span class="m-label">Groupe:</span><span>${groupLabel(e.group)}</span></div>
  `;
  document.getElementById('eventModal').classList.add('show');
}
function closeEventModal(){
  document.getElementById('eventModal').classList.remove('show');
}
document.getElementById('eventModalClose').addEventListener('click', closeEventModal);
document.getElementById('eventModal').addEventListener('click', e=>{
  if(e.target.id === 'eventModal') closeEventModal();
});
document.addEventListener('keydown', e=>{
  if(e.key === 'Escape') closeEventModal();
});

/* ---------- navigation ---------- */
function shiftDay(delta){
  let idx = selectedDayIndex + delta;
  if(idx < 0){ currentWeekStart.setDate(currentWeekStart.getDate()-7); idx = 4; }
  else if(idx > 4){ currentWeekStart.setDate(currentWeekStart.getDate()+7); idx = 0; }
  selectedDayIndex = idx;
  render();
}

document.getElementById('prevBtn').addEventListener('click', ()=>{
  if(isMobile()) shiftDay(-1);
  else { currentWeekStart.setDate(currentWeekStart.getDate()-7); render(); }
});
document.getElementById('nextBtn').addEventListener('click', ()=>{
  if(isMobile()) shiftDay(1);
  else { currentWeekStart.setDate(currentWeekStart.getDate()+7); render(); }
});
document.getElementById('todayBtn').addEventListener('click', ()=>{
  const now = new Date();
  currentWeekStart = startOfWeek(now);
  selectedDayIndex = initialDayIndex();
  render();
});
document.getElementById('searchBox').addEventListener('input', render);
document.getElementById('groupFilter').addEventListener('click', e=>{
  const btn = e.target.closest('button[data-g]');
  if(!btn) return;
  activeGroup = btn.dataset.g;
  [...document.querySelectorAll('#groupFilter button')].forEach(b=>b.classList.toggle('active', b===btn));
  updateRangeInfo();
  render();
});

let resizeTimer = null;
window.addEventListener('resize', ()=>{
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 120);
});

/* ---------- chargement des fichiers .ics du dossier ---------- */
const FILE_A = "data/grpa.ics";
const FILE_B = "data/grpb.ics";

async function fetchICS(filename){
  const res = await fetch("./" + filename, {cache:"no-store"});
  if(!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  if(!text.includes("BEGIN:VCALENDAR")) throw new Error("fichier invalide");
  return text;
}

(async function init(){
  const statusEl = document.getElementById('loadStatus');
  const errors = [];

  try{ eventsA = parseICS(await fetchICS(FILE_A)); }
  catch(err){ errors.push(FILE_A); }

  try{ eventsB = parseICS(await fetchICS(FILE_B)); }
  catch(err){ errors.push(FILE_B); }

  rebuildMerged();

  if(errors.length){
    statusEl.classList.add('show','err');
    statusEl.innerHTML = `Impossible de charger : <strong>${errors.join(', ')}</strong>. ` +
      `Vérifie que ${errors.length>1?'ces fichiers':'ce fichier'} se trouve${errors.length>1?'nt':''} bien dans le même dossier que cette page. ` +
      `Si tu as ouvert ce fichier en double-cliquant dessus (adresse commençant par <code>file://</code>), certains navigateurs bloquent la lecture de fichiers voisins par sécurité : lance un petit serveur local dans ce dossier (par ex. <code>python3 -m http.server</code> puis ouvre <code>http://localhost:8000/</code>) et recharge la page.`;
  }
})();
