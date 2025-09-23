// /api/messages.js
import { Client } from "pg";
import cors from "./_cors.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";

const DEFAULT_CHANNEL = "#wtf";
const hasDB = !!process.env.base_url;
const allowDelete = process.env.ALLOW_DELETE === "true";

const mem = { byCh: new Map() };

function now(){ return Date.now(); }
function uid(){
  return crypto?.randomUUID
    ? crypto.randomUUID()
    : (Math.random().toString(36).slice(2) + Date.now().toString(36));
}
function ensureMem(ch){
  if (!mem.byCh.has(ch)) mem.byCh.set(ch, { list: [], lastTs: 0 });
  return mem.byCh.get(ch);
}
function pg(){ return new Client({ connectionString: process.env.base_url }); }
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

export default async function handler(req, res){
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const channel = String(url.searchParams.get("ch") || url.searchParams.get("channel") || DEFAULT_CHANNEL).trim();

  // ---- author (JWT)
  let authorFromToken = "anon";
  const token = getToken(req);
  if (token){
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET || "dev");
      authorFromToken = payload.sub || "anon";
    } catch {}
  }

  // ---------- GET ----------
  if (req.method === "GET") {
    const since = Number(url.searchParams.get("since") || 0);
    const limit = Math.max(1, Math.min(2000, Number(url.searchParams.get("limit") || 1000)));

    if (hasDB){
      const client = pg();
      try {
        await client.connect();
        const { rows } = await client.query(
          `SELECT id, channel, author, text, ts
           FROM messages
           WHERE channel = $1 AND ($2::bigint IS NULL OR ts > $2)
           ORDER BY ts ASC
           LIMIT $3`,
          [channel, since || null, limit]
        );
        const list = rows.map(r => ({ ...r, ts: Number(r.ts) }));
        const lastTs = list.length ? list[list.length - 1].ts : since;
        return ok(res, { list, lastTs });
      } catch(e){
        console.error("GET /messages DB error:", e);
        return bad(res, 500, "db_read_failed");
      } finally {
        try { await client.end(); } catch {}
      }
    } else {
      const box = ensureMem(channel);
      const list = box.list.filter(m => m.ts > since).slice(0, limit);
      const lastTs = list.length ? list[list.length - 1].ts : since;
      return ok(res, { list, lastTs });
    }
  }

  // ---------- POST ----------
  if (req.method === "POST") {
    // body oku
    let body = "";
    await new Promise((resolve) => {
      req.on("data", (c) => (body += c));
      req.on("end", resolve);
    });

    let data = {};
    try { data = JSON.parse(body || "{}"); }
    catch { return bad(res, 400, "invalid_json"); }

    const ch = String((data.channel || channel || DEFAULT_CHANNEL)).trim();

    let text = normalizeText(data.text);
    text = String(text).trim();
    if (!text) return bad(res, 400, "text_required");
    if (text.length > 2000) text = text.slice(0, 2000); // opsiyonel

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
      } finally {
        try { await client.end(); } catch {}
      }
    } else {
      const box = ensureMem(ch);
      box.list.push(doc);
      box.lastTs = doc.ts;
      return ok(res, { message: doc });
    }
  }

  // ---------- DELETE ----------
  if (req.method === "DELETE") {
    if (!allowDelete) return bad(res, 403, "delete_disabled");
    if (hasDB){
      const client = pg();
      try {
        await client.connect();
        await client.query(`DELETE FROM messages WHERE channel = $1`, [channel]);
        return ok(res, { cleared: true });
      } catch(e){
        console.error("DELETE /messages DB error:", e);
        return bad(res, 500, "db_delete_failed");
      } finally {
        try { await client.end(); } catch {}
      }
    } else {
      const box = ensureMem(channel);
      box.list = [];
      box.lastTs = 0;
      return ok(res, { cleared: true });
    }
  }

  return bad(res, 405, "method_not_allowed");
}
