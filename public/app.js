// ===== Config =====
const API_BASE = "";                 // aynı origin
const DEFAULT_CHAN = "wtf";

// ===== State =====
let CURRENT = getCurrentUser();      // { nick?, pass? }
let currentCh = DEFAULT_CHAN;
let LIST = [];
let seenIds = new Set();             // id-bazlı dedup
let lastTs = 0;                      // en son gördüğümüz ts
let liveTimer = null;                // polling timer

// ===== DOM =====
const $log   = document.getElementById("log");
const $text  = document.getElementById("text");
const $send  = document.getElementById("send");
const $chans = document.getElementById("channels");
const $title = document.getElementById("titleChan");
const $stats = document.getElementById("stats");

// ===== Utils =====
async function loadAllChannelsHistory(since=0){
  const r = await fetch(`/api/channels`, { credentials:"include" });
  const j = await r.json().catch(()=>({}));
  if (!j || !j.ok) return;
  const chans = (j.channels || []).map(x => x.channel);
  for (const ch of chans){
    await loadHistory(ch, since, 2000); // birleştirerek ekler
  }
}
function setSendEnabled(on){
  $send.disabled = !on;
  $text.disabled = !on;
  $text.placeholder = on
    ? (CURRENT?.nick ? `message as ${CURRENT.nick}…` : `type a message in #${currentCh}…`)
    : `read-only (All)`;
}
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
function cryptoRandom(){
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
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
function syncAdminUI(){
  const on = isAdminMode();
  if (on) document.documentElement.setAttribute("data-admin","1");
  else document.documentElement.removeAttribute("data-admin");
  const b = document.getElementById("btn-bll");
  if (b) b.textContent = on ? "bll • ON" : "bll";
}

// ===== Render =====
function renderOne(msg){
  const row = el("div","line");
  const ts  = el("span","ts", `[${fmtTs(msg.ts)}]`);
  const au  = el("span","au", ` <${msg.author || "anon"}>`);
  const tx  = el("span","tx", ` ${msg.text}`);
  row.append(ts, au, tx);

  const del = el("span","msg-del"," –");
  del.title = "delete message";
  del.addEventListener("click",(e)=>{ e.stopPropagation(); deleteMessage(msg.id); });
  row.appendChild(del);

  return row;
}
function renderList(){
  $log.innerHTML = "";
  for (const m of LIST) $log.appendChild(renderOne(m));
  $log.scrollTop = $log.scrollHeight;

  // küçük stats - opsiyonel
  try{
    const nickSet = new Set(LIST.map(m=>m.author||"anon"));
    $stats.textContent = `msgs: ${LIST.length} • users: ${nickSet.size}`;
  }catch{}
}

function pushMsg(m){
  if (!m || !m.id) return;
  if (seenIds.has(m.id)) return;
  LIST.push(m);
  seenIds.add(m.id);
  if (m.ts && m.ts > lastTs) lastTs = m.ts;
}
async function fetchChannels(){
  try{
    const r = await fetch(`/api/channels`, { credentials:"include" });
    const j = await r.json();
    if (!j || !j.ok) return [];
    // Kanalları “en eski görünenden” itibaren getiriyor.
    // İstiyorsan alfabetik sırala:
    // j.channels.sort((a,b)=>a.channel.localeCompare(b.channel));
    return j.channels || [];
  }catch{ return []; }
}
// ===== Networking =====
async function loadHistory(ch, since=0, limit=1000){
  const r = await fetch(`${API_BASE}/api/messages?ch=${encodeURIComponent(ch)}&since=${since}&limit=${limit}`, {
    method:"GET", credentials:"include"
  });
  const j = await r.json().catch(()=>({}));
  if (!j || !j.ok) return;
  for (const m of (j.list || [])) pushMsg(m);
  if (j.lastTs) lastTs = Math.max(lastTs, j.lastTs);
  renderList();
}

function stopLive(){
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
}
function startLive(ch){
  if (liveTimer) return; // guard
  liveTimer = setInterval(async ()=>{
    try{
      const r = await fetch(`${API_BASE}/api/messages?ch=${encodeURIComponent(ch)}&since=${lastTs}`, {
        method:"GET", credentials:"include"
      });
      const j = await r.json().catch(()=>({}));
      if (!j || !j.ok) return;
      let added = 0;
      for (const m of (j.list || [])){ pushMsg(m); added++; }
      if (added) renderList();
    }catch{}
  }, 2000);
}

async function sendMessage(text){
  const msgText = String(text||"").trim();
  if (!msgText) return;

  const tempId = "tmp_" + cryptoRandom();
  const optimistic = {
    id: tempId,
    channel: currentCh,
    author: (CURRENT?.nick || "anon"),
    text: msgText,
    ts: Date.now()
  };
  pushMsg(optimistic);
  renderList();

  try{
    const r = await fetch(`${API_BASE}/api/messages?ch=${encodeURIComponent(currentCh)}`, {
      method: "POST",
      headers: { "content-type":"application/json" },
      credentials: "include",
      body: JSON.stringify({ text: msgText })
    });
    const j = await r.json().catch(()=>({}));
    if (j && j.ok && j.message){
      const i = LIST.findIndex(m => m.id === tempId);
      if (i >= 0) {
        LIST[i] = j.message;
        seenIds.delete(tempId);
        seenIds.add(j.message.id);
        if (j.message.ts > lastTs) lastTs = j.message.ts;
      } else {
        pushMsg(j.message);
      }
      renderList();
    }
  }catch(e){
    // istersen optimistic’i “failed” olarak işaretleyebilirsin
  }
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

// ===== Channels UI =====
async function renderChannels(){
  const list = await fetchChannels(); // [{channel, count, first_ts, last_ts}, ...]
  $chans.innerHTML = "";

  // Sadece admin token varken All göster
  if (isAdminMode()){
    const all = el("div","chan",`#All`);
    if (currentCh==="__ALL__") all.classList.add("active");
    all.addEventListener("click", ()=> switchChannel("__ALL__"));
    $chans.appendChild(all);
  }

  for (const row of list){
    const name = row.channel;  // DB’de ne yazıyorsa
    const c = el("div","chan", `#${name} (${row.count})`);
    if (currentCh===name) c.classList.add("active");
    c.addEventListener("click", ()=> switchChannel(name));
    $chans.appendChild(c);
  }
}

async function switchChannel(newCh){
  if (newCh === currentCh) return;

  // All sadece admin token varken
  if (newCh === "__ALL__" && !isAdminMode()){
    alert("All view requires admin token.");
    return;
  }

  currentCh = newCh;

  // önce canlıyı durdur ve state'i sıfırla
  stopLive();
  LIST = [];
  seenIds = new Set();
  lastTs = 0;
  renderList();

  if (currentCh === "__ALL__"){
    $title.textContent = `#All`;
    setSendEnabled(false);              // All = read-only
    await loadAllChannelsHistory(0);    // tüm kanalları DB’den çek, birleştir
    // canlı izleme istersen sonra ekleriz
  } else {
    $title.textContent = `#${currentCh}`;
    setSendEnabled(true);
    await loadHistory(currentCh, 0);    // seçili kanal geçmişi
    startLive(currentCh);               // seçili kanalda canlı akış
  }

  // placeholder güncelle
  $text.placeholder = (currentCh === "__ALL__")
    ? `read-only (All)`
    : (CURRENT?.nick ? `message as ${CURRENT.nick}…` : `type a message in #${currentCh}…`);
}


// ===== Events =====
document.getElementById("btn-bll")?.addEventListener("click", async ()=>{
  const existing = getValidAdminToken();
  if (existing){
    if (confirm("Admin token aktif. Kaldırılsın mı?")){
      clearAdminToken();
      syncAdminUI();
      // All modundaysan default kanala geri dön
      if (currentCh === "__ALL__") await switchChannel(DEFAULT_CHAN);
      await renderChannels();  // menüyü tazele (All butonu kaybolsun)
      renderList();
    }
    return;
  }
  const t = prompt("Admin delete token:");
  if (t && t.trim()){
    setAdminToken(t.trim());
    syncAdminUI();
    await renderChannels();    // menüyü tazele (All butonu gelsin)
    renderList();
  }
});

document.getElementById("chSelect")?.addEventListener("change", (e)=>{
  switchChannel(e.target.value);
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
  if (e.key==="burak_user"){
    CURRENT = getCurrentUser();
    $text.placeholder = CURRENT?.nick ? `message as ${CURRENT.nick}…` : `type a message in #${currentCh}…`;
  }
});

// ===== Init =====
renderChannels();
$title.textContent = `#${currentCh}`;
$text.placeholder = CURRENT?.nick ? `message as ${CURRENT.nick}…` : `type a message in #${currentCh}…`;
(async ()=>{
  await loadHistory(currentCh, 0);   // DB’den tam geçmiş
  startLive(currentCh);              // canlı akış
})();
setInterval(syncAdminUI, 5000);
syncAdminUI();
setInterval(async ()=>{
  if (currentCh === "__ALL__" && !isAdminMode()){
    await switchChannel(DEFAULT_CHAN);
    await renderChannels();  // menüyü token durumuna göre güncelle
  }
}, 3000);
