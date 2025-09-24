// apps/ch4t/api/messages.js
import { Client } from "pg";
import applyCORS from "./_cors.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";

// ====== Tunable anti-bot knobs ======
const DEFAULT_CHANNEL   = "wtf";
const MAX_MSG_LEN       = 2000;

const GLOBAL_HOUR_MS    = 60 * 60 * 1000;
const GLOBAL_THRESHOLD  = 1000;       // 60 dakikada 1000+ → global lock

// Per-user token bucket: 1 msg/sec, burst 5
const PER_USER_REFILL_PER_SEC = 1;
const PER_USER_BURST          = 5;

// Flood rules
const SEQ_THRESHOLD   = 10;           // aynı kullanıcı ardışık 10+
const SEQ_WINDOW_MS   = 30 * 1000;    // 30 sn penceresi
const DUP_THRESHOLD   = 3;            // aynı içerik 3+
const DUP_WINDOW_MS   = 10 * 1000;    // 10 sn penceresi

// Admin header (unlock/lock)
const ADMIN_TOKEN_HEADER = "x-delete-token";

// ====== Env & feature flags ======
const hasDB       = !!process.env.DATABASE_URL;
const allowDelete = process.env.ALLOW_DELETE === "true";
const ADMIN_TOKEN = process.env.ADMIN_DELETE_TOKEN || ""; // set etmen önerilir
const JWT_SECRET  = process.env.JWT_SECRET || "dev";

// ====== Helpers ======
function normChan(s){
  return String(s || "").trim().replace(/^#+/, "").toLowerCase();
}
function now(){ return Date.now(); }
function hourSlot(ts=now()){ return Math.floor(ts/ GLOBAL_HOUR_MS); }
function uid(){
  return crypto?.randomUUID ? crypto.randomUUID()
    : (Math.random().toString(36).slice(2)+Date.now().toString(36));
}
function normalizeText(x){
  if (typeof x === "string") return x;
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  if (x == null) return "";
  try { return JSON.stringify(x); } catch { return String(x); }
}
function pg(){ return new Client({ connectionString: process.env.DATABASE_URL }); }
function bad(res, code, error){ res.status(code).json({ ok:false, error }); }
function ok(res, payload={}){ res.status(200).json({ ok:true, ...payload }); }

function getToken(req){
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)ch4t_token=([^;]+)/);
  return m ? m[1] : null;
}
function sha1(s){
  // hızlı, yeterli (kripto amaçlı değil)
  const str = String(s);
  return crypto.createHash("sha1").update(str).digest("hex");
}

// ====== In-memory fallback state ======
const mem = { byCh: new Map() };
function ensureMem(ch){
  if (!mem.byCh.has(ch)) mem.byCh.set(ch, { list: [], lastTs: 0 });
  return mem.byCh.get(ch);
}
const memDeleted = new Set();   // soft-deleted id'ler (mem modu)
const perUserBuckets = new Map(); // user -> {tokens,last}
let MEM_GLOBAL = { hourSlot: hourSlot(), hourCount: 0, locked: false };

// ====== Per-user token bucket ======
function allowUser(author){
  const k = author || "anon";
  const rec = perUserBuckets.get(k) || { tokens: PER_USER_BURST, last: now() };
  const t = now();
  const delta = (t - rec.last)/1000;
  rec.last = t;
  rec.tokens = Math.min(PER_USER_BURST, rec.tokens + delta*PER_USER_REFILL_PER_SEC);
  if (rec.tokens >= 1){
    rec.tokens -= 1;
    perUserBuckets.set(k, rec);
    return true;
  }
  perUserBuckets.set(k, rec);
  return false;
}

// ====== DB bootstrap (soft-delete & flags) ======
async function ensureSchema(client){
  // messages.is_deleted kolonu yoksa ekle
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='messages' AND column_name='is_deleted'
      ) THEN
        ALTER TABLE messages ADD COLUMN is_deleted boolean DEFAULT false;
      END IF;
    END$$;
  `);
  // flags tablosu (key/value) yoksa oluştur
  await client.query(`
    CREATE TABLE IF NOT EXISTS flags (
      key text PRIMARY KEY,
      val text
    );
  `);
}
async function getGlobalLock(client){
  const { rows } = await client.query(`SELECT val FROM flags WHERE key='global_lock'`);
  return rows.length ? rows[0].val === "1" : false;
}
async function setGlobalLock(client, on){
  await client.query(`
    INSERT INTO flags(key,val)
    VALUES ('global_lock', $1)
    ON CONFLICT (key) DO UPDATE SET val=EXCLUDED.val
  `,[on ? "1":"0"]);
}

// ====== Recent fetchers for flood checks (DB) ======
async function fetchRecentByAuthor(client, ch, author, limit, windowMs){
  const since = Date.now() - windowMs;
  const { rows } = await client.query(
    `SELECT id, author, text, ts
       FROM messages
      WHERE channel=$1 AND author=$2 AND is_deleted=false AND ts >= $3
      ORDER BY ts DESC
      LIMIT $4`,
    [ch, author, since, limit]
  );
  return rows;
}
async function fetchRecentByAuthorSameHash(client, ch, author, hash, limit, windowMs){
  const since = Date.now() - windowMs;
  const { rows } = await client.query(
    `SELECT id, author, text, ts
       FROM messages
      WHERE channel=$1 AND author=$2 AND is_deleted=false AND ts >= $3
      ORDER BY ts DESC
      LIMIT $4`,
    [ch, author, since, limit]
  );
  // filtre hash eşleşmesine göre
  return rows.filter(r => sha1(String(r.text).trim().toLowerCase()) === hash);
}

// ====== Soft delete helpers (DB & mem) ======
async function softDeleteIdsDB(client, ids=[]){
  if (!ids.length) return;
  await client.query(
    `UPDATE messages SET is_deleted=true WHERE id = ANY($1)`,
    [ids]
  );
}
function softDeleteIdsMem(ids=[]){
  for (const id of ids) memDeleted.add(id);
}

// ====== Main handler ======
export default async function handler(req,res){
  if (applyCORS(req,res)) return;

  const url = new URL(req.url, `http://${req.headers.host}`);
  const since = Number(url.searchParams.get("since") || 0);
  const action = String(url.searchParams.get("action") || "");

  // channel (query)
  const chRaw  = url.searchParams.get("ch") || DEFAULT_CHANNEL;
  const chNorm = normChan(chRaw);
  const variants = Array.from(new Set([ chNorm, "#"+chNorm ]));

  // author from JWT
  let authorFromToken = "anon";
  const token = getToken(req);
  if (token){
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      authorFromToken = payload.sub || "anon";
    } catch {}
  }

  // ===== GET: list messages (skip soft-deleted) =====
  if (req.method === "GET") {
    const limit = Math.max(1, Math.min(2000, Number(url.searchParams.get("limit") || 1000)));
    if (hasDB){
      const client = pg();
      try {
        await client.connect();
        await ensureSchema(client);
        const { rows } = await client.query(
          `SELECT id, channel, author, text, ts
             FROM messages
            WHERE channel = ANY($1)
              AND ($2::bigint = 0 OR ts > $2)
              AND is_deleted=false
            ORDER BY ts ASC
            LIMIT $3`,
          [variants, since, limit]
        );
        const list = rows.map(r => ({ ...r, ts: Number(r.ts) }));
        const lastTs2 = list.length ? list[list.length - 1].ts : since;
        return ok(res, { list, lastTs: lastTs2 });
      } catch(e){
        console.error("GET /messages DB error:", e);
        return bad(res, 500, "db_read_failed");
      } finally {
        try { await client.end(); } catch {}
      }
    } else {
      // mem fallback: varyant birleştir + soft-deleted filtrele
      let acc = [];
      for (const v of variants){
        const box = ensureMem(v);
        const part = since ? box.list.filter(m => m.ts > since) : box.list;
        acc = acc.concat(part);
      }
      acc = acc.filter(m => !memDeleted.has(m.id));
      acc.sort((a,b)=>a.ts-b.ts);
      const list = acc.slice(0, limit);
      const lastTs2 = list.length ? list[list.length - 1].ts : since;
      return ok(res, { list, lastTs: lastTs2 });
    }
  }

  // ===== Admin lock/unlock shortcuts via POST?action=... =====
  if (req.method === "POST" && action) {
    const provided = (req.headers[ADMIN_TOKEN_HEADER] || "").trim();
    if (!ADMIN_TOKEN || provided !== ADMIN_TOKEN) {
      return bad(res, 401, "bad_admin_token");
    }
    if (!hasDB){
      // mem mode global lock
      if (action === "unlock_all"){ MEM_GLOBAL.locked = false; return ok(res, { unlocked:"all" }); }
      if (action === "lock_all"){ MEM_GLOBAL.locked = true;  return ok(res, { locked:"all"   }); }
      return bad(res, 400, "unknown_action");
    } else {
      const client = pg();
      try {
        await client.connect();
        await ensureSchema(client);
        if (action === "unlock_all"){ await setGlobalLock(client,false); return ok(res, { unlocked:"all" }); }
        if (action === "lock_all"){   await setGlobalLock(client,true);  return ok(res, { locked:"all"   }); }
        return bad(res, 400, "unknown_action");
      } catch(e){
        console.error("POST?action DB error:", e);
        return bad(res, 500, "db_flag_failed");
      } finally { try { await client.end(); } catch{} }
    }
  }

  // ===== POST: create message (with protections) =====
  if (req.method === "POST") {
    // body parse
    let body = "";
    await new Promise((resolve)=>{ req.on("data",c=>body+=c); req.on("end",resolve); });
    let data = {};
    try { data = JSON.parse(body || "{}"); }
    catch { return bad(res, 400, "invalid_json"); }

    const ch = normChan(data.channel || chRaw || DEFAULT_CHANNEL);
    let text = normalizeText(data.text).trim();
    if (!text) return bad(res, 400, "text_required");
    if (text.length > MAX_MSG_LEN) text = text.slice(0, MAX_MSG_LEN);

    const doc = { id: uid(), channel: ch, author: authorFromToken, text, ts: now() };
    const contentHash = sha1(text.trim().toLowerCase());

    // Per-user rate limit
    if (!allowUser(authorFromToken)) {
      return bad(res, 429, "rate_limited");
    }

    if (!hasDB){
      // ---- MEM MODE ----

      // Global lock?
      if (MEM_GLOBAL.locked) return bad(res, 403, "global_locked");

      // Global hourly count & auto-lock
      const hs = hourSlot(doc.ts);
      if (hs !== MEM_GLOBAL.hourSlot){ MEM_GLOBAL.hourSlot = hs; MEM_GLOBAL.hourCount = 0; }
      MEM_GLOBAL.hourCount += 1;
      if (MEM_GLOBAL.hourCount > GLOBAL_THRESHOLD){
        MEM_GLOBAL.locked = true;
        return bad(res, 429, "auto_locked_all");
      }

      // Push & flood checks (mem)
      const box = ensureMem(ch);
      box.list.push(doc);
      box.lastTs = doc.ts;

      // ardışık aynı kullanıcı
      {
        let consec = 0;
        for (let i = box.list.length - 1; i >= 0; i--){
          const m = box.list[i];
          if (doc.ts - m.ts > SEQ_WINDOW_MS) break;
          if (m.author === authorFromToken) consec++;
          else break;
        }
        if (consec >= SEQ_THRESHOLD){
          // son SEQ_THRESHOLD adetini sil (soft)
          const toDelete = [];
          for (let i = box.list.length - 1; i >= 0 && toDelete.length < SEQ_THRESHOLD; i--){
            const m = box.list[i];
            if ((doc.ts - m.ts) <= SEQ_WINDOW_MS && m.author === authorFromToken) {
              toDelete.push(m.id);
            } else break;
          }
          toDelete.forEach(id => memDeleted.add(id));
          return ok(res, { action:"deleted_sequence", deleted: toDelete.length });
        }
      }
      // duplicate
      {
        let dup = 0;
        for (let i = box.list.length - 1; i >= 0; i--){
          const m = box.list[i];
          if (doc.ts - m.ts > DUP_WINDOW_MS) break;
          if (m.author === authorFromToken && sha1(String(m.text).trim().toLowerCase()) === contentHash) dup++;
          else break;
        }
        if (dup >= (DUP_THRESHOLD - 1)){
          // son dupları soft-delete
          let left = DUP_THRESHOLD;
          for (let i = box.list.length - 1; i >= 0 && left > 0; i--){
            const m = box.list[i];
            if ((doc.ts - m.ts) <= DUP_WINDOW_MS && m.author === authorFromToken && sha1(String(m.text).trim().toLowerCase()) === contentHash){
              memDeleted.add(m.id); left--;
            }
          }
          return ok(res, { action:"deleted_duplicates" });
        }
      }

      return ok(res, { message: doc });
    }

    // ---- DB MODE ----
    const client = pg();
    try {
      await client.connect();
      await ensureSchema(client);

      // global lock?
      const locked = await getGlobalLock(client);
      if (locked) return bad(res, 403, "global_locked");

      // global hourly count & auto-lock
      const since = Date.now() - GLOBAL_HOUR_MS;
      const { rows: cntRows } = await client.query(
        `SELECT COUNT(*)::int AS c FROM messages WHERE ts >= $1 AND is_deleted=false`,
        [since]
      );
      const hourCount = Number(cntRows[0]?.c || 0) + 1; // bu mesaj dahil
      if (hourCount > GLOBAL_THRESHOLD){
        await setGlobalLock(client, true);
        return bad(res, 429, "auto_locked_all");
      }

      // Flood checks (ardışık / duplicate) — önce INSERT edip sonra soft-delete etmek daha kolay
      await client.query(
        `INSERT INTO messages (id, channel, author, text, ts, is_deleted)
         VALUES ($1, $2, $3, $4, $5, false)`,
        [doc.id, doc.channel, doc.author, doc.text, doc.ts]
      );

      // Ardışık aynı kullanıcı (SEQ_THRESHOLD içinde & window)
      {
        const recents = await fetchRecentByAuthor(client, ch, authorFromToken, SEQ_THRESHOLD-1, SEQ_WINDOW_MS);
        // recents DESC geliyor, sadece window içindekileri sayıyoruz
        let consec = 1; // current dahil
        for (const r of recents){
          if (doc.ts - Number(r.ts) > SEQ_WINDOW_MS) break;
          consec++;
        }
        if (consec >= SEQ_THRESHOLD){
          // current + önceki SEQ_THRESHOLD-1 mesajı soft-delete
          const ids = [doc.id, ...recents.slice(0, SEQ_THRESHOLD-1).map(r=>r.id)];
          await softDeleteIdsDB(client, ids);
          return ok(res, { action:"deleted_sequence", deleted: ids.length });
        }
      }

      // Duplicate (aynı içerik)
      {
        const sameHashList = await fetchRecentByAuthorSameHash(client, ch, authorFromToken, contentHash, DUP_THRESHOLD-1, DUP_WINDOW_MS);
        if (sameHashList.length >= (DUP_THRESHOLD - 1)){
          const ids = [doc.id, ...sameHashList.slice(0, DUP_THRESHOLD-1).map(r=>r.id)];
          await softDeleteIdsDB(client, ids);
          return ok(res, { action:"deleted_duplicates", deleted: ids.length });
        }
      }

      // Normal akış
      return ok(res, { message: doc });
    } catch(e){
      console.error("POST /messages DB error:", e);
      return bad(res, 500, "db_write_failed");
    } finally { try { await client.end(); } catch{} }
  }

  // ===== DELETE: clear channel (respect is_deleted & allowDelete) =====
  if (req.method === "DELETE") {
    if (!allowDelete) return bad(res, 403, "delete_disabled");
    const clearVariants = Array.from(new Set([ chNorm, "#"+chNorm ]));

    if (hasDB){
      const client = pg();
      try {
        await client.connect();
        await ensureSchema(client);
        // Tamamen silmek yerine soft-delete tümünü:
        await client.query(
          `UPDATE messages SET is_deleted=true WHERE channel = ANY($1)`,
          [clearVariants]
        );
        return ok(res, { cleared:true, channels: clearVariants, mode:"soft" });
      } catch(e){
        console.error("DELETE /messages DB error:", e);
        return bad(res, 500, "db_delete_failed");
      } finally { try { await client.end(); } catch{} }
    } else {
      for (const v of clearVariants){
        const box = ensureMem(v);
        // mem'de de soft-delete: listedeki hepsini işaretle
        for (const m of box.list) memDeleted.add(m.id);
      }
      return ok(res, { cleared:true, channels: clearVariants, mode:"soft" });
    }
  }

  return bad(res, 405, "method_not_allowed");
}
