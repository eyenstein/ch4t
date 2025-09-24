// apps/ch4t/api/messages.js
import { Client } from "pg";
import applyCORS from "./_cors.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";

const DEFAULT_CHANNEL = "wtf";
const hasDB = !!process.env.DATABASE_URL;
const allowDelete = process.env.ALLOW_DELETE === "true";

// ---- helpers ----
function normChan(s){
  return String(s || "").trim().replace(/^#+/, "").toLowerCase();
}
function now(){ return Date.now(); }
function uid(){
  return crypto?.randomUUID ? crypto.randomUUID()
    : (Math.random().toString(36).slice(2)+Date.now().toString(36));
}
function pg(){ return new Client({ connectionString: process.env.DATABASE_URL }); }
function bad(res, code, error){ res.status(code).json({ ok:false, error }); }
function ok(res, payload={}){ res.status(200).json({ ok:true, ...payload }); }

function normalizeText(x){
  if (typeof x === "string") return x;
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  if (x == null) return "";
  try { return JSON.stringify(x); } catch { return String(x); }
}

function getToken(req){
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)ch4t_token=([^;]+)/);
  return m ? m[1] : null;
}

// In-memory fallback
const mem = { byCh: new Map() };
function ensureMem(ch){
  if (!mem.byCh.has(ch)) mem.byCh.set(ch, { list: [], lastTs: 0 });
  return mem.byCh.get(ch);
}

export default async function handler(req,res){
  if (applyCORS(req,res)) return;

  const url = new URL(req.url, `http://${req.headers.host}`);
  const since = Number(url.searchParams.get("since") || 0);

  // ---- channel (query) ----
  const chRaw = url.searchParams.get("ch") || DEFAULT_CHANNEL;
  const chNorm = normChan(chRaw);

  // ---- author from JWT ----
  let authorFromToken = "anon";
  const token = getToken(req);
  if (token){
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET || "dev");
      // sub: nick
      authorFromToken = payload.sub || "anon";
    } catch {}
  }

  // ---- variants for legacy rows (e.g. '#wtf') ----
  const variants = Array.from(new Set([ chNorm, "#"+chNorm ]));

  // ---------- GET ----------
  if (req.method === "GET") {
    const limit = Math.max(1, Math.min(2000, Number(url.searchParams.get("limit") || 1000)));
    if (hasDB){
      const client = pg();
      try {
        await client.connect();
        const { rows } = await client.query(
          `SELECT id, channel, author, text, ts
             FROM messages
            WHERE channel = ANY($1)
              AND ($2::bigint = 0 OR ts > $2)
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
      // mem fallback: bütün varyant kutularını birleştir
      let acc = [];
      for (const v of variants){
        const box = ensureMem(v);
        const part = since ? box.list.filter(m => m.ts > since) : box.list;
        acc = acc.concat(part);
      }
      acc.sort((a,b)=>a.ts-b.ts);
      const list = acc.slice(0, limit);
      const lastTs2 = list.length ? list[list.length - 1].ts : since;
      return ok(res, { list, lastTs: lastTs2 });
    }
  }

  // ---------- POST ----------
  if (req.method === "POST") {
    let body = "";
    await new Promise((resolve)=>{ req.on("data",c=>body+=c); req.on("end",resolve); });
    let data = {};
    try { data = JSON.parse(body || "{}"); }
    catch { return bad(res, 400, "invalid_json"); }

    // yazarken normalize et (legacy satırlar için GET zaten varyantlı)
    const ch = normChan(data.channel || chRaw || DEFAULT_CHANNEL);
    let text = normalizeText(data.text).trim();
    if (!text) return bad(res, 400, "text_required");
    if (text.length > 2000) text = text.slice(0,2000);

    const doc = { id: uid(), channel: ch, author: authorFromToken, text, ts: now() };

    if (hasDB){
      const client = pg();
      try {
        await client.connect();
        await client.query(
          `INSERT INTO messages (id, channel, author, text, ts)
           VALUES ($1, $2, $3, $4, $5)`,
          [doc.id, doc.channel, doc.author, doc.text, doc.ts]
        );
        return ok(res, { message: doc });
      } catch(e){
        console.error("POST /messages DB error:", e);
        return bad(res, 500, "db_write_failed");
      } finally { try { await client.end(); } catch{} }
    } else {
      const box = ensureMem(ch);
      box.list.push(doc);
      box.lastTs = doc.ts;
      return ok(res, { message: doc });
    }
  }

  // ---------- DELETE (clear channel) ----------
  if (req.method === "DELETE") {
    if (!allowDelete) return bad(res, 403, "delete_disabled");

    // hangi kanalı sileceğiz? query'deki ch parametresini kullan
    const clearVariants = Array.from(new Set([ chNorm, "#"+chNorm ]));

    if (hasDB){
      const client = pg();
      try {
        await client.connect();
        await client.query(`DELETE FROM messages WHERE channel = ANY($1)`, [clearVariants]);
        return ok(res, { cleared:true, channels: clearVariants });
      } catch(e){
        console.error("DELETE /messages DB error:", e);
        return bad(res, 500, "db_delete_failed");
      } finally { try { await client.end(); } catch{} }
    } else {
      for (const v of clearVariants){
        const box = ensureMem(v);
        box.list = []; box.lastTs = 0;
      }
      return ok(res, { cleared:true, channels: clearVariants });
    }
  }

  return bad(res, 405, "method_not_allowed");
}
