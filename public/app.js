// public/app.js — monokrom terminal UI; #wtf ile açılır; opsiyonel kanal değişimi; nick input yok

// ---- Ayarlar ----
const API = "/api/messages";                // backend endpoint
const CHANNELS = ["#wtf", "global", "lobby", "notes"]; // solda gösterilecek; tek kanal istersen ["#wtf"]
let CURRENT = "#wtf";                        // her zaman #wtf ile başla

// Önceden seçilmiş kanal varsa ve listede bulunuyorsa, onu kullanmak istersen:
try {
  const saved = localStorage.getItem("ch4t_current_channel");
  if (saved && CHANNELS.includes(saved)) CURRENT = saved;
} catch {}

// Nick input yok — varsa localStorage.burak_user.nick kullanılır, yoksa "anon"
function detectNick() {
  try {
    const raw = localStorage.getItem("burak_user");
    if (!raw) return "";
    const obj = JSON.parse(raw);
    return (obj && obj.nick && String(obj.nick).trim()) || "";
  } catch { return ""; }
}

// ---- Cache (kanala göre) ----
function cacheKey(ch){ return `ch4t_cache_${ch}`; }
let LAST_TS = 0;
let MESSAGES = [];

function loadCache(){
  try {
    const raw = localStorage.getItem(cacheKey(CURRENT));
    if (raw) {
      const data = JSON.parse(raw);
      MESSAGES = data.messages || [];
      LAST_TS  = data.lastTs || 0;
      renderAll(MESSAGES);
    } else {
      MESSAGES = []; LAST_TS = 0; renderAll([]);
    }
  } catch {
    MESSAGES = []; LAST_TS = 0; renderAll([]);
  }
}
function saveCache(){
  try {
    localStorage.setItem(cacheKey(CURRENT), JSON.stringify({ messages: MESSAGES, lastTs: LAST_TS }));
  } catch {}
}

// ---- DOM refs ----
const $chans = document.getElementById("channels");
const $titleChan = document.getElementById("titleChan");
const $log  = document.getElementById("log");
const $text = document.getElementById("text");
const $send = document.getElementById("send");
const $stats = document.getElementById("stats");

// ---- Sol panel (kanal listesi) ----
function renderChannels(){
  if (!$chans) return;
  $chans.innerHTML = "";
  CHANNELS.forEach(ch => {
    const btn = document.createElement("div");
    btn.className = "chan" + (ch === CURRENT ? " active" : "");
    btn.textContent = ch;
    btn.onclick = () => switchChannel(ch);
    $chans.appendChild(btn);
  });
}
async function switchChannel(ch){
  if (!CHANNELS.includes(ch)) return;
  CURRENT = ch;
  try { localStorage.setItem("ch4t_current_channel", CURRENT); } catch {}
  if ($titleChan) $titleChan.textContent = CURRENT;
  renderChannels();
  loadCache();
  await loadHistory();  // yeni kanal geçmişini 0'dan getir
}

// ---- Render helpers ----
function pad(n){ return String(n).padStart(2,"0"); }
function fmt(ts){
  // Saat + tarih birlikte göster (fix)
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, c => (
    { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]
  ));
}
function lineEl(m){
  const div = document.createElement("div");
  div.className = "line";
  div.innerHTML = `<span class="ts">[${fmt(m.ts)}]</span> <span class="au">&lt;${escapeHtml(m.author || "anon")}&gt;</span> <span class="tx">${escapeHtml(m.text || "")}</span>`;
  return div;
}
function renderAll(list){
  if ($log) {
    $log.innerHTML = "";
    list.forEach(m => $log.appendChild(lineEl(m)));
    $log.scrollTop = $log.scrollHeight;
  }
  renderStats();
}
function renderAppend(list){
  if ($log) {
    list.forEach(m => $log.appendChild(lineEl(m)));
    $log.scrollTop = $log.scrollHeight;
  }
  renderStats();
}
function renderStats(){
  if (!$stats) return;
  const uniq = new Set();
  let nick = 0, anon = 0;
  for (const m of MESSAGES) {
    const who = (m.author || "").trim() || "anon";
    if (!uniq.has(who)) {
      uniq.add(who);
      if (who.toLowerCase() === "anon") anon++; else nick++;
    }
  }
  $stats.textContent = `messages: ${MESSAGES.length} · nick: ${nick} · anon: ${anon}`;
}

// ---- API ----
async function loadHistory(){
  LAST_TS = 0;
  MESSAGES = [];
  renderAll([]);

  const url = `${API}?channel=${encodeURIComponent(CURRENT)}&since=0&limit=2000`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.ok) {
      MESSAGES = json.list || [];
      LAST_TS  = json.lastTs || 0;
      renderAll(MESSAGES);
      saveCache();
    }
  } catch (e) {}
}
async function pollNew(){
  const url = `${API}?channel=${encodeURIComponent(CURRENT)}&since=${LAST_TS}&limit=1000`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.ok && json.list && json.list.length) {
      MESSAGES = MESSAGES.concat(json.list);
      LAST_TS  = Math.max(LAST_TS, json.lastTs || LAST_TS);
      renderAppend(json.list);
      saveCache();
    }
  } catch (e) {}
}
async function sendMessage(){
  const text = ($text?.value || "").trim();
  if (!text) return;

  const nick = detectNick();
  const author = nick || "anon";

  try {
    const res = await fetch(API, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ channel: CURRENT, author, text })
    });
    const json = await res.json();
    if (json.ok && json.message) {
      MESSAGES.push(json.message);
      LAST_TS = Math.max(LAST_TS, json.message.ts);
      renderAppend([json.message]);
      saveCache();
      if ($text) $text.value = "";
    }
  } catch (e) {}
}

// ---- Events ----
if ($send) $send.onclick = sendMessage;
if ($text) {
  // Enter ya da Cmd/Ctrl+Enter ile gönder
  $text.addEventListener("keydown", (e)=>{
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    if ((e.key === "Enter") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendMessage(); }
  });
}

// ---- Boot ----
renderChannels();
document.getElementById("titleChan").textContent = CURRENT;
loadCache();
loadHistory();
setInterval(pollNew, 1200);
