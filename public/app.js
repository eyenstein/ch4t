// public/app.js

// ----- config -----
const API_BASE = "/api";                  // aynı origin
const DEFAULT_CHANNEL = "#wtf";

// ----- state -----
let CURRENT_CH = DEFAULT_CHANNEL;
let SINCE = 0;                            // long-poll için
let LIST = [];                            // ekranda gösterilen mesajlar

// Kullanıcının girdiği/“bildiği” kanalları localStorage’da tut
const LS_MY_CHANNELS = "my_channels";
let KNOWN_CHANNELS = new Set(
  JSON.parse(localStorage.getItem(LS_MY_CHANNELS) || "[]")
);
if (!KNOWN_CHANNELS.has(DEFAULT_CHANNEL)) KNOWN_CHANNELS.add(DEFAULT_CHANNEL);

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

function saveKnownChannels() {
  localStorage.setItem(LS_MY_CHANNELS, JSON.stringify([...KNOWN_CHANNELS]));
}

function renderOne(msg) {
  const row = el("div", "line");
  row.dataset.id = msg.id;   // silme işlemi için lazım

  const ts  = el("span", "ts", `[${fmtTs(msg.ts)}] `);
  const au  = el("span", "au", `<${msg.author}> `);
  const tx  = el("span", "tx", msg.text);

  // ADT butonu (her mesajın yanına)
  const adtBtn = el("button", "adt-btn", "ADT");
  adtBtn.onclick = () => adtDeletePrompt(msg.id);

  row.append(ts, au, tx, adtBtn);
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

  const seenNicks = new Set();
  let hasAnon = false;

  for (const m of LIST) {
    const a = String(m.author || "anon").trim();
    if (!a || a === "anon") hasAnon = true;
    else seenNicks.add(a);
  }

  const nickUsers = seenNicks.size;
  const anonUsers = hasAnon ? 1 : 0;

  // istersen toplam kullanıcıyı da göster
  // const totalUsers = nickUsers + anonUsers;

  $stats.textContent = `messages: ${total} · nick: ${nickUsers} · anon: ${anonUsers}`;
}


function setChannel(ch) {
  // kanal ismini güvene al (#, harf/rakam ve basit ayırıcılar)
  const safe = String(ch).trim().replace(/[^#A-Za-z0-9:\-_|]/g, "");
  if (!safe) return;

  CURRENT_CH = safe;
  $titleChan.textContent = safe;
  SINCE = 0;         // kanalı değiştirince baştan çek
  LIST = [];
  renderList();
  updateStats();

  // Bu kanalı kullanıcı “öğrendi” → sidebar'a eklenmeli
  KNOWN_CHANNELS.add(safe);
  saveKnownChannels();
  renderChannels();

  // input placeholder güncelle
  if ($text) $text.placeholder = `type a message in ${safe}…`;
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
async function adtDeletePrompt(msgId) {
  const token = prompt("ADMIN_DELETE_TOKEN (ADT) gir:");
  if (!token) return;

  try {
    const res = await fetch(`/api/messages/${msgId}`, {
      method: "DELETE",
      headers: { "x-delete-token": token }
    });
    const j = await res.json();
    if (j.ok) {
      markMessageDeletedInUI(msgId);
      alert("Mesaj admin tarafından silindi.");
    } else {
      alert("Silme başarısız: " + j.error);
    }
  } catch (e) {
    console.error(e);
    alert("Network hatası.");
  }
}

function markMessageDeletedInUI(id) {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (!el) return;
  const text = el.querySelector(".text");
  if (text) text.textContent = "[message deleted by admin]";
  el.classList.add("deleted");
  const btn = el.querySelector(".adt-btn");
  if (btn) btn.remove();
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
    // İstersen optimistic append:
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

// ----- channels (sadece kullanıcının girdiği/bildiği kanallar) -----
function renderChannels() {
  $channels.innerHTML = "";
  for (const ch of KNOWN_CHANNELS) {
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

// ----- teleport bar (kanal yarat/ışınlan) -----
(function addTeleportBar(){
  const header = document.querySelector("header") || document.body;

  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.alignItems = "center";
  wrap.style.gap = "6px";
  wrap.style.margin = "6px 0 0 12px";

  const inp = document.createElement("input");
  inp.id = "teleportInput";
  inp.placeholder = "tp #channel  |  #channel";
  inp.style.padding = "6px 8px";
  inp.style.borderRadius = "6px";
  inp.style.background = "var(--card, #0b1220)";
  inp.style.color = "var(--fg, #e6e6e6)";
  inp.style.border = "1px solid var(--line, #222)";
  inp.style.minWidth = "180px";

  const btn = document.createElement("button");
  btn.id = "teleportBtn";
  btn.textContent = "tp";
  btn.style.padding = "6px 10px";
  btn.style.borderRadius = "6px";
  btn.style.cursor = "pointer";
  btn.style.background = "var(--btn, #111)";
  btn.style.color = "var(--fg, #e6e6e6)";
  btn.style.border = "1px solid var(--btn-bd, #333)";

  wrap.appendChild(inp);
  wrap.appendChild(btn);

  if (header.tagName && header.tagName.toLowerCase() === "header") {
    header.appendChild(wrap);
  } else {
    document.body.insertBefore(wrap, document.body.firstChild);
  }

  function parseTeleport(text) {
    if (!text) return null;
    const t = text.trim();
    const parts = t.split(/\s+/);

    // öncelik: doğrudan #channel geçen parça
    for (const p of parts) if (p.startsWith("#")) return p;

    // "tp foo" → #foo
    if (parts.length >= 2 && parts[0].toLowerCase() === "tp") {
      let ch = parts[1];
      if (!ch.startsWith("#")) ch = "#" + ch;
      return ch;
    }
    // "foo tp" → #foo
    if (parts.length >= 2 && parts[parts.length - 1].toLowerCase() === "tp") {
      let ch = parts[0];
      if (!ch.startsWith("#")) ch = "#" + ch;
      return ch;
    }
    // tek kelime → #ekle
    if (parts.length === 1) {
      let ch = parts[0];
      if (!ch.startsWith("#")) ch = "#" + ch;
      return ch;
    }
    return null;
  }

  function flashMsg(text, color = "#9ae6b4") {
    const f = document.createElement("div");
    f.textContent = text;
    f.style.position = "fixed";
    f.style.right = "16px";
    f.style.top = "16px";
    f.style.background = "rgba(0,0,0,0.6)";
    f.style.color = color;
    f.style.padding = "8px 10px";
    f.style.borderRadius = "6px";
    f.style.zIndex = 9999;
    document.body.appendChild(f);
    setTimeout(()=> f.remove(), 1500);
  }

  async function doTeleport(rawText) {
    const ch = parseTeleport(rawText);
    if (!ch) { flashMsg("invalid channel", "#f6a6a6"); return; }
    setChannel(ch);             // kanal yarat/ışınlan
    // ilk fetch tetiklemesi gerekirse (poll zaten çalışıyor ama hızlı görünüm için):
    try { await fetchMessages(); } catch {}
    flashMsg("teleported to " + ch);
    inp.value = "";
  }

  btn.addEventListener("click", () => doTeleport(inp.value));
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); doTeleport(inp.value); }
  });
})();

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
setChannel(CURRENT_CH);   // DEFAULT_CHANNEL zaten KNOWN_CHANNELS'ta
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
