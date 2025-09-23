// public/app.js

// ----- config -----
const API_BASE = "/api";                  // aynı origin
const DEFAULT_CHANNEL = "#wtf";

// ----- state -----
let CURRENT_CH = DEFAULT_CHANNEL;
let SINCE = 0;                            // long-poll için
let LIST = [];                            // ekranda gösterilen mesajlar

// ----- dom -----
const $titleChan = document.getElementById("titleChan");
const $stats     = document.getElementById("stats");
const $log       = document.getElementById("log");
const $text      = document.getElementById("text");
const $send      = document.getElementById("send");
const $channels  = document.getElementById("channels");

// ----- helpers -----
function fmtTs(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return "";
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(); // sadece saat istersen: d.toLocaleTimeString()
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderOne(msg) {
  const row = el("div", "line");
  const ts  = el("span", "ts", `[${fmtTs(msg.ts)}] `);
  const au  = el("span", "au", `<${msg.author}> `);
  const tx  = el("span", "tx", msg.text);
  row.append(ts, au, tx);
  return row;
}

function renderList() {
  $log.innerHTML = "";
  LIST.forEach(m => $log.appendChild(renderOne(m)));
  // auto-scroll alta
  $log.scrollTop = $log.scrollHeight;
}

function updateStats() {
  const total = LIST.length;
  let nickCnt = 0, anonCnt = 0;
  for (const m of LIST) {
    if (!m.author || m.author === "anon") anonCnt++;
    else nickCnt++;
  }
  $stats.textContent = `messages: ${total} · nick: ${nickCnt} · anon: ${anonCnt}`;
}

function setChannel(ch) {
  CURRENT_CH = ch;
  $titleChan.textContent = ch;
  SINCE = 0;         // kanalı değiştirince baştan çek
  LIST = [];
  renderList();
  updateStats();
}

// ----- api -----
async function fetchMessages() {
  const url = new URL(`${API_BASE}/messages`, location.origin);
  url.searchParams.set("channel", CURRENT_CH);
  if (SINCE) url.searchParams.set("since", String(SINCE));
  url.searchParams.set("limit", "1000");

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const data = await res.json();

  // BE: { ok:true, list:[...], lastTs:number }
  const list = Array.isArray(data.list) ? data.list : [];
  if (list.length) {
    LIST = LIST.concat(list);
    SINCE = Number(data.lastTs || list[list.length - 1]?.ts || SINCE) || SINCE;
    renderList();
    updateStats();
  }
}

async function postMessage(text, author = "anon", token = null) {
  const res = await fetch(`${API_BASE}/messages?channel=${encodeURIComponent(CURRENT_CH)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { "authorization": `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ channel: CURRENT_CH, author, text })
  });
  if (!res.ok) {
    const t = await res.text().catch(()=> "");
    throw new Error(`send failed: ${res.status} ${t}`);
  }
  return res.json();
}

// ----- ui events -----
$send.addEventListener("click", async () => {
  const text = ($text.value || "").trim();
  if (!text) return;

  // varsa localStorage’da tutulan nick/token’ı kullan
  let author = "anon", token = null;
  try {
    const raw = localStorage.getItem("burak_user");
    if (raw) {
      const u = JSON.parse(raw);
      if (u?.nick) author = String(u.nick);
      if (u?.token) token = String(u.token);
    }
  } catch {}

  try {
    await postMessage(text, author, token);
    $text.value = "";
    // Kendimizi beklemeden optimistic append yapmak istersen:
    // LIST.push({ id: `local-${Date.now()}`, channel: CURRENT_CH, author, text, ts: Date.now() });
    // renderList(); updateStats();
  } catch (e) {
    console.error(e);
    alert("send failed");
  }
});

$text.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $send.click();
  }
});

// Channels (tek kanal istiyorsun; yine de tıklanabilir liste bırakıyorum)
function renderChannels() {
  $channels.innerHTML = "";
  const items = [DEFAULT_CHANNEL]; // istersen DM’leri burada ekleyebilirsin
  for (const ch of items) {
    const btn = el("div", "chan" + (ch === CURRENT_CH ? " active" : ""), ch);
    btn.addEventListener("click", () => {
      if (ch !== CURRENT_CH) {
        document.querySelectorAll(".chan").forEach(x => x.classList.remove("active"));
        btn.classList.add("active");
        setChannel(ch);
      }
    });
    $channels.appendChild(btn);
  }
}

// ----- poll loop -----
async function loop() {
  for (;;) {
    try {
      await fetchMessages();
    } catch (e) {
      console.warn(e.message);
      // kısa bir bekleme
      await new Promise(r => setTimeout(r, 1500));
    }
    // hafif bekleme; BE push yok, basit poll
    await new Promise(r => setTimeout(r, 800));
  }
}

// ----- boot -----
renderChannels();
setChannel(DEFAULT_CHANNEL);
loop().catch(console.error);

// placeholder’ı nick’e göre güncelle (opsiyonel)
window.addEventListener("storage", (e) => {
  if (e.key === "burak_user") {
    try {
      const u = JSON.parse(localStorage.getItem("burak_user") || "{}");
      $text.placeholder = u?.nick ? `message as ${u.nick}…` : `type a message in ${CURRENT_CH}…`;
    } catch {}
  }
});
(() => {
  try {
    const u = JSON.parse(localStorage.getItem("burak_user") || "{}");
    $text.placeholder = u?.nick ? `message as ${u.nick}…` : `type a message in ${CURRENT_CH}…`;
  } catch {
    $text.placeholder = `type a message in ${CURRENT_CH}…`;
  }
})();
