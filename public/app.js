// ---- minimal state helpers ----
function getCurrentUser(){
  try{
    const raw = localStorage.getItem("burak_user");
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          nick: String(parsed.nick || "").slice(0,24),
          token: String(parsed.token || "")
        };
      }
  }catch{}
    return { nick: "", token: "" };
}
let CURRENT = getCurrentUser();
window.addEventListener('storage', (e)=>{
  if (e.key === 'burak_user') {
    CURRENT = getCurrentUser();
    setPlaceholder();
  }
});

// ---- channel utils ----
function canonicalDM(a,b){ return `dm:${[a,b].sort((x,y)=>x.localeCompare(y)).join("|")}`; }
function isDM(ch){ return ch.startsWith("dm:"); }
function otherOfDM(ch, me){
  const [A,B] = ch.slice(3).split("|");
  return A===me ? B : (B===me ? A : "");
}
function escapeHtml(s){ return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// ---- DOM refs ----
const $msg = document.getElementById("messages");
const $list = document.getElementById("chan-list");
const $text = document.getElementById("text");
const $send = document.getElementById("send");

// ---- state ----
let ACTIVE = { channel: "wtf", since: 0 };
let CHANNELS = new Set(["wtf"]);

// ---- UI helpers ----
function setPlaceholder(){
  if (isDM(ACTIVE.channel)) {
    const other = otherOfDM(ACTIVE.channel, CURRENT.nick||"anon");
    $text.placeholder = other ? `whisper to ${other}…` : `whisper…`;
  } else {
    $text.placeholder = CURRENT.nick ? `message as ${CURRENT.nick}…` : 'type a message…';
  }
}

function renderChannels(){
  $list.innerHTML = "";
  const arr = Array.from(CHANNELS).sort((a,b)=> a==="wtf" ? -1 : b==="wtf" ? 1 : a.localeCompare(b));
  for (const ch of arr){
    const li = document.createElement("li");
    li.textContent = isDM(ch) ? `@${otherOfDM(ch, CURRENT.nick||"anon")}` : "#wtf";
    if (ch === ACTIVE.channel) li.classList.add("active");
    li.onclick = ()=> { ACTIVE.channel = ch; ACTIVE.since = 0; setPlaceholder(); $msg.innerHTML=""; tick(); };
    $list.appendChild(li);
  }
}

async function fetchChannels(){
  try{
    const r = await fetch(`/api/channels?me=${encodeURIComponent(CURRENT.nick||"anon")}`, {
      headers: { "X-Nick": CURRENT.nick || "anon" }
    });
    const j = await r.json();
    (j.channels||["wtf"]).forEach(ch => CHANNELS.add(ch));
    renderChannels();
  } catch(e){
    renderChannels();
  }
}

function addMessageToDOM(m){
  const div = document.createElement("div");
  div.className = "msg";
  const badge = isDM(m.channel) ? `<span class="badge">whisper</span>` : "";
  div.innerHTML = `<span class="nick" data-nick="${m.from}">${m.from}</span> ${badge}: ${escapeHtml(m.text)}`;
  div.querySelector(".nick").onclick = (ev)=>{
    const other = ev.target.dataset.nick;
    if (!other) return;
    const ch = canonicalDM(CURRENT.nick||"anon", other);
    CHANNELS.add(ch);
    ACTIVE.channel = ch; ACTIVE.since = 0;
    setPlaceholder(); renderChannels(); $msg.innerHTML = "";
    tick();
  };
  $msg.appendChild(div);
  $msg.scrollTop = $msg.scrollHeight;
}

// ---- networking ----
async function loadNew(){
    const headers = { "X-Nick": CURRENT.nick || "anon" };
     if (CURRENT.token) headers.Authorization = `Bearer ${CURRENT.token}`;
     const r = await fetch(`/api/messages?channel=${encodeURIComponent(ACTIVE.channel)}&since=${ACTIVE.since}`, { headers });
  const j = await r.json();
  const list = j.list || [];
  for (const m of list) {
    addMessageToDOM(m);
    if (m.ts > ACTIVE.since) ACTIVE.since = m.ts;
    if (isDM(m.channel)) CHANNELS.add(m.channel);
  }
}

async function sendMessage(){
  const txt = $text.value.trim();
  if (!txt) return;
  const payload = {
    text: txt,
    from: CURRENT.nick || "anon"
  };
  if (isDM(ACTIVE.channel)) {
    const other = otherOfDM(ACTIVE.channel, CURRENT.nick||"anon");
    payload.to = other;
    payload.force_dm = true;
  }
    const headers = { "Content-Type":"application/json", "X-Nick": CURRENT.nick || "anon" };
     if (CURRENT.token) headers.Authorization = `Bearer ${CURRENT.token}`;
  await fetch(`/api/messages?channel=${encodeURIComponent(ACTIVE.channel)}`, {
    method:"POST",
      headers,
    body: JSON.stringify(payload)
  });
  $text.value = "";
}

// ---- wire up ----
$send.onclick = sendMessage;
$text.addEventListener("keydown", (e)=>{ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); sendMessage(); }});

// ---- loop ----
async function tick(){ await loadNew(); }
setPlaceholder();
fetchChannels();
setInterval(tick, 1200);
