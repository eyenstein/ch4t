// public/app.js — terminal UI, #wtf kanalı, nick input yok; geçmiş + sayım + polling

// ---- Sabitler ----
const CHANNEL = "#wtf";
const API = "/api/messages"; // API path mevcut dosyana göre

// İsteğe bağlı otomatik nick: localStorage.burak_user.nick varsa kullan, yoksa "anon"
function detectNick() {
  try {
    const raw = localStorage.getItem('burak_user');
    if (!raw) return '';
    const obj = JSON.parse(raw);
    return (obj && obj.nick && String(obj.nick).trim()) || '';
  } catch { return ''; }
}

// ---- Cache (localStorage) ----
function cacheKey(){ return `ch4t_cache_${CHANNEL}`; }
let LAST_TS = 0;
let MESSAGES = [];

function loadCache(){
  try {
    const raw = localStorage.getItem(cacheKey());
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
    localStorage.setItem(cacheKey(), JSON.stringify({ messages: MESSAGES, lastTs: LAST_TS }));
  } catch {}
}

// ---- DOM ----
const $log  = document.getElementById('log');
const $text = document.getElementById('text');
const $send = document.getElementById('send');
const $stats = document.getElementById('stats');

// ---- Render helpers ----
function pad(n){ return String(n).padStart(2,'0'); }
function fmt(ts){
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
}
function lineEl(m){
  const div = document.createElement('div');
  div.className = 'line';
  div.innerHTML = `<span class="ts">[${fmt(m.ts)}]</span> <span class="au">&lt;${escapeHtml(m.author)}&gt;</span> <span class="tx">${escapeHtml(m.text)}</span>`;
  return div;
}
function renderAll(list){
  if ($log) {
    $log.innerHTML = '';
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
    if (!uniq.has(m.author)) {
      uniq.add(m.author);
      if ((m.author || '').toLowerCase() === 'anon') anon++; else nick++;
    }
  }
  $stats.textContent = `messages: ${MESSAGES.length} · nick: ${nick} · anon: ${anon}`;
}

// ---- API ----
async function loadHistory(){
  LAST_TS = 0;
  MESSAGES = [];
  renderAll([]);

  const url = `${API}?channel=${encodeURIComponent(CHANNEL)}&since=0&limit=2000`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.ok) {
      MESSAGES = json.list || [];
      LAST_TS  = json.lastTs || 0;
      renderAll(MESSAGES);
      saveCache();
    }
  } catch (e) {
    // sessiz geç
  }
}

async function pollNew(){
  const url = `${API}?channel=${encodeURIComponent(CHANNEL)}&since=${LAST_TS}&limit=1000`;
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
  const text = ($text?.value || '').trim();
  if (!text) return;

  const nick = detectNick();
  const author = nick || 'anon';

  try {
    const res = await fetch(API, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ channel: CHANNEL, author, text })
    });
    const json = await res.json();
    if (json.ok && json.message) {
      MESSAGES.push(json.message);
      LAST_TS = Math.max(LAST_TS, json.message.ts);
      renderAppend([json.message]);
      saveCache();
      if ($text) $text.value = '';
    }
  } catch (e) {}
}

// ---- Events ----
if ($send) $send.onclick = sendMessage;
if ($text) {
  $text.addEventListener('keydown', (e)=>{
    // Enter veya Cmd/Ctrl+Enter ile gönder
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    if ((e.key === 'Enter') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendMessage();
    }
  });
}

// ---- Boot ----
loadCache();      // refresh sonrası geçmişi göster
loadHistory();    // sunucudan tam geçmiş
setInterval(pollNew, 1200); // yeni mesajları getir
