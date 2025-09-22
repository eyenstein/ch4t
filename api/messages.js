

import { Client } from "pg";
import jwt from "jsonwebtoken";
import cors from "./_cors.js";

const hasDB = !!process.env.base_url;
const mem = { byCh: new Map() }; // channel -> { list:[], lastTs }

function now() { return Date.now(); }
function id()  { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function ensureMem(ch) {
  if (!mem.byCh.has(ch)) mem.byCh.set(ch, { list: [], lastTs: 0 });
  return mem.byCh.get(ch);
}

function pg() {
  const client = new Client({ connectionString: process.env.base_url });
  return client;
}

function bad(res, code, error) {
  res.status(code).json({ ok:false, error });
}
function ok(res, payload) {
  res.status(200).json(payload);
}

function isDM(ch) {
  return String(ch || "").startsWith("dm:");
}

function sameNick(a, b) {
  return String(a||"").trim().toLowerCase() === String(b||"").trim().toLowerCase();
}

function parseBearer(req) {
  const auth = String(req.headers.authorization || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : "";
}

function verifyJWT(token) {
  const secret = process.env.JWT_SECRET || "";
  if (!secret) return null;
  try { return jwt.verify(token, secret); } catch { return null; }
}

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const channel = String(url.searchParams.get("channel") || "#wtf");
  const since   = Number(url.searchParams.get("since") || 0);

  // ===== GET: list messages (kanal bazlı) =====
  if (req.method === "GET") {
    try {
      if (hasDB) {
        const client = pg();
        await client.connect();
        const rows = since
          ? (await client.query(
              "SELECT id, author, text, ts FROM messages WHERE channel = $1 AND ts > $2 ORDER BY ts ASC",
              [ channel, since ]
            )).rows
          : (await client.query(
              "SELECT id, author, text, ts FROM messages WHERE channel = $1 ORDER BY ts ASC LIMIT 200",
              [ channel ]
            )).rows;
        await client.end();
        return ok(res, rows.map(r => ({ id:r.id, author:r.author, text:r.text, ts:Number(r.ts) })));
      } else {
        const st = ensureMem(channel);
        const list = since ? st.list.filter(m => Number(m.ts) > since) : st.list.slice(-200);
        return ok(res, list);
      }
    } catch {
      return bad(res, 500, "db_error");
    }
  }

  // ===== POST: create message =====
  if (req.method === "POST") {
    let body = "";
    try {
      await new Promise((resolve, reject)=>{
        req.on("data", c => { body += c; });
        req.on("end", resolve);
        req.on("error", reject);
      });
    } catch {
      return bad(res, 400, "invalid_body");
    }

    let data = {};
    try { data = JSON.parse(body||"{}"); } catch { return bad(res, 400, "invalid_json"); }

    const text = String(data.text || "").trim();
    const authorReq = String(data.author || "").trim() || "anon";
    const ch = String(data.channel || channel || "#wtf");

    if (!text) return bad(res, 400, "text_required");

    const allowAnonPublic = (process.env.ALLOW_ANON_PUBLIC || "true").toLowerCase() !== "false";

    // auth
    const token = parseBearer(req);
    const decoded = token ? verifyJWT(token) : null;
    const tokenNick = decoded?.nick ? String(decoded.nick).trim() : "";

    // Kurallar:
    // - DM'de: token şart ve token.nick == authorReq
    // - Public'te:
    //    - author=anon ise token zorunlu değil (konfig ile kapatılabilir)
    //    - author!=anon ise token şart ve token.nick == authorReq
    if (isDM(ch)) {
      if (!tokenNick || !sameNick(tokenNick, authorReq)) {
        return bad(res, 401, "unauthorized");
      }
    } else {
      if (authorReq.toLowerCase() !== "anon") {
        if (!tokenNick || !sameNick(tokenNick, authorReq)) {
          return bad(res, 401, "unauthorized");
        }
      } else if (!allowAnonPublic) {
        return bad(res, 401, "anon_disabled");
      }
    }

    const row = { id: id(), channel: ch, author: authorReq, text, ts: now() };

    try {
      if (hasDB) {
        const client = pg();
        await client.connect();
        await client.query(
          "INSERT INTO messages (id, channel, author, text, ts) VALUES ($1,$2,$3,$4,$5)",
          [ row.id, row.channel, row.author, row.text, row.ts ]
        );
        await client.end();
      } else {
        const st = ensureMem(ch);
        st.list.push({ id: row.id, author: row.author, text: row.text, ts: row.ts });
        st.lastTs = Math.max(st.lastTs, row.ts);
      }
      return ok(res, { id: row.id, ts: row.ts });
    } catch {
      return bad(res, 500, "db_error");
    }
  }

  // ===== DELETE: admin delete =====
  if (req.method === "DELETE") {
    const admin = process.env.ADMIN_TOKEN || process.env.EDIT_TOKEN || "";
    const token = parseBearer(req);
    if (!admin || token !== admin) return bad(res, 401, "unauthorized");

    const idQ = String(new URL(req.url, `http://${req.headers.host}`).searchParams.get("id") || "");
    if (!idQ) return bad(res, 400, "id_required");

    try {
      if (hasDB) {
        const client = pg();
        await client.connect();
        await client.query("DELETE FROM messages WHERE id=$1", [ idQ ]);
        await client.end();
      } else {
        for (const st of mem.byCh.values()) {
          const i = st.list.findIndex(m => m.id === idQ);
          if (i !== -1) st.list.splice(i,1);
        }
      }
      return ok(res, { ok:true, id: idQ });
    } catch {
      return bad(res, 500, "db_error");
    }
  }

  return bad(res, 405, "method_not_allowed");
}
