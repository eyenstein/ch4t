// ===== Config =====
const API_BASE = "";                 // aynı origin: /api/...
const DEFAULT_CHAN = "wtf";

// ===== State =====
let CURRENT = getCurrentUser();      // { nick?, pass? }
let CH = DEFAULT_CHAN;
let LIST = [];
let LAST_TS = 0;

// ===== DOM =====
const $log   = document.getElementById("log");
const $text  = document.getElementById("text");
const $send  = document.getElementById("send");
const $chans = document.getElementById("channels");
const $title = document.getElementById("titleChan");
const $stats = document.getElementById("stats");

// ===== Utils =====
function el(tag, cls, text){ const n=document.createElement(tag); if(cls) n.className=cls; if(text!=null) n.textContent=text; return n; }
function fmt2(n){ return String(n).padStart(2,"0"); }
function fmtTs(ms){
  if (!ms || isNaN(ms)) return "??";
  const d = new Date(ms);
  return `${d.getFullYear()}-${fmt2(d.getMonth()+1)}-${fmt2(d.getDate())} ${fmt2(d.getHours())}:${fmt2(d.getMinutes())}:${fmt2(d.getSeconds())}`;
}
function getCurrentUser(){
  try { return JSON.parse(localStorage.getItem("burak_user")||"{}"); } catch { return {}; }
}

// ===== Admin token (10 dk TTL) =====
const ADMIN_TOKEN_KEY = "bll_admin_token";
const ADMIN_TOKEN_TTL = 10*60*1000;

function setAdminToken(tok){ localStorage.setItem(ADMIN_TOKEN_KEY, JSON.stringify({token:String(tok||""), ts:Date.now()})); }
function clearAdminToken(){ localStorage.removeItem(ADMIN_TOKEN_KEY); }
function getValidAdminToken(){
  try{
    const rec = JSON.parse(localStorage.getItem(ADMIN_TOKEN_KEY) || "null");
    if (!rec || !rec.token) return null;
    if (Date.now() - rec.ts > ADMIN_TOKEN_TTL){ clearAdminToken(); return null; }
    return rec.token;
  }catch{ return null; }
}
function isAdminMode(){ return !!getValidAdminToken(); }

// ===== Admin UI sync =====
function syncAdminUI(){
  const on = isAdminMode();
  if (on) document.documentElement.setAttribute("data-admin","1");
  else document.documentElement.removeAttribute("data-admin");

  const b = document.getElementById("btn-bll");
  if (b) b.textContent = on ? "bll • ON" : "bll";
}

// ===== UI: channels =====
function renderChannels(){
  $chans.innerHTML = "";
  const one = el("div","chan active","#wtf");
  one.addEventListener("click", ()=> switchChannel("wtf"));
  $chans.appendChild(one);
}
function switchChannel(name){
  if (CH === name) return;
  CH = name;
  $title.textContent = `#${CH}`;
  LIST = []; LAST_TS = 0; $log.innerHTML = "";
  pull(true);
}

// ===== Render =====
function renderOne(msg){
  const row = el("div","line");
  const ts  = el("span","ts", `[${fmtTs(msg.ts)}]`);
  const au  = el("span","au", ` <${msg.author || "anon"}>`);
  const tx  = el("span","tx", ` ${msg.text}`);
  row.append(ts, au, tx);

  // her zaman ekliyoruz; görünürlük CSS'ten
  const del = el("span","msg-del"," –");
  del.title = "delete message";
  del.addEventListener("click",(e)=>{ e.stopPropagation(); deleteMessage(msg.id); });
  row.appendChild(del);

  return row;
}

function renderList(){
  $log.innerHTML = "";
  let nNick=0, nAnon=0;
  const seen = new Set();
  for (const m of LIST){
    $log.appendChild(renderOne(m));
    if (m.author) { seen.add(m.author); nNick = seen.size; }
    else nAnon++;
  }
  $log.scrollTop = $log.scrollHeight;
  $stats.textContent = `messages: ${LIST.length} · nick: ${nNick} · anon: ${nAnon}`;
}

// ===== Networking =====
async function pull(reset=false){
  try{
    const url = new URL(`${API_BASE}/api/messages`, location.origin);
    url.searchParams.set("ch", CH);
    if (!reset && LAST_TS) url.searchParams.set("since", String(LAST_TS));
    const res = await fetch(url.toString(), { method:"GET", credentials:"include" });
    if (!res.ok) return;
    const j = await res.json();
    if (!j || !j.ok) return;
    if (reset) LIST = j.list || [];
    else LIST = LIST.concat(j.list || []);
    LAST_TS = Math.max(LAST_TS, j.lastTs || 0);
    renderList();
  }catch(e){ /* sessiz */ }
}

async function sendMessage(text){
  try{
    const res = await fetch(`${API_BASE}/api/messages?ch=${encodeURIComponent(CH)}`,{
      method:"POST",
      headers:{ "Content-Type":"application/json", ...(authHeader()) },
      body: JSON.stringify({ text })
    });
    const j = await res.json().catch(()=>({}));
    if (!res.ok || !j.ok) throw new Error(j.error || "send_failed");
    LIST.push(j.item || { id:j.id, ts:Date.now(), author:CURRENT?.nick, text });
    renderList();
  }catch(e){ console.error(e); alert("not send"); }
}

async function deleteMessage(id){
  const tok = getValidAdminToken();
  if (!tok){ alert("Admin token expired."); syncAdminUI(); renderList(); return; }
  try{
    const res = await fetch(`${API_BASE}/api/messages/${encodeURIComponent(id)}`,{
      method:"DELETE",
      headers:{ "X-Delete-Token": tok }
    });
    const j = await res.json().catch(()=>({}));
    if (!res.ok || !j.ok){
      if (res.status===401 || res.status===403){ clearAdminToken(); syncAdminUI(); renderList(); return; }
      throw new Error(j.error || "delete_failed");
    }
    const i = LIST.findIndex(m=>m.id===id);
    if (i!==-1) LIST.splice(i,1);
    renderList();
  }catch(e){ console.error(e); alert("delete failed"); }
}

function authHeader(){ return {}; }

// ===== Events =====
document.getElementById("btn-bll")?.addEventListener("click", ()=>{
  const existing = getValidAdminToken();
  if (existing){
    if (confirm("Admin token aktif. Kaldırılsın mı?")){ clearAdminToken(); syncAdminUI(); renderList(); }
    return;
  }
  const t = prompt("Admin delete token:");
  if (t && t.trim()){ setAdminToken(t.trim()); syncAdminUI(); renderList(); }
});

$send.addEventListener("click", ()=>{
  const v = ($text.value || "").trim();
  if (!v) return;
  sendMessage(v);
  $text.value = "";
});

$text.addEventListener("keydown",(e)=>{
  if (e.key==="Enter" && !e.shiftKey){ e.preventDefault(); $send.click(); }
});

window.addEventListener("storage",(e)=>{
  if (e.key==="burak_user"){ CURRENT = getCurrentUser(); }
});

// ===== Init =====
renderChannels();
$title.textContent = `#${CH}`;
$text.placeholder = CURRENT?.nick ? `message as ${CURRENT.nick}…` : `type a message in #${CH}…`;
pull(true);
setInterval(()=>pull(false), 2000);
setInterval(syncAdminUI, 5000);
syncAdminUI();
