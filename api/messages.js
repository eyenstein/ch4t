// api/messages.js — Neon varsa DB'den, yoksa RAM'den; kanal ZORUNLU; DELETE prod'da kapalı
import { Client } from "pg";
import cors from "./_cors.js";
import crypto from "crypto";

// --- Config ---
const hasDB = !!process.env.base_url;             // Neon connection string (postgres)
const allowDelete = process.env.ALLOW_DELETE === "true"; // Prod'da false bırak

// RAM fallback (kanal -> { list:[], lastTs })
const mem = { byCh: new Map() };

function now() { return Date.now(); }
function uid() { return crypto?.randomUUID ? crypto.randomUUID() :
  (Math.random().toString(36).slice(2) + Date.now().toString(36)); }

function ensureMem(ch) {
  if (!mem.byCh.has(ch)) mem.byCh.set(ch, { list: [], lastTs: 0 });
  return mem.byCh.get(ch);
}

function pg() {
  return new Client({ connectionString: process.env.base_url });
}

function bad(res, code, error)    { res.status(code).json({ ok:false, error }); }
function ok(res, payload = {})    { res.status(200).json({ ok:true, ...payload }); }

export default async function handler(req, res) {
  // CORS
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  // URL & query
  const url = new URL(req.url, `http://${req.headers.host}`);

  // --- Kanalı ZORUNLU yap: boşsa 400
  const channelRaw = url.searchParams.get("channel");
  let channel = (channelRaw || "").trim();

  // POST body okumadan önce, POST'ta body->channel öncelikli
  let body = "";
  if (req.method === "POST") {
    await new Promise((resolve) => {
      req.on("data", (c) => (body += c));
      req.on("end", resolve);
    });
  }

  // --- GET /api/messages?channel=&since=&limit=
  if (req.method === "GET") {
    if (!channel) return bad(res, 400, "channel_required");

    const since = Number(url.searchParams.get("since") || 0);
    const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit") || 200)));

    if (hasDB) {
      const client = pg();
      try {
        await client.connect();
        const { rows } = await client.query(
          `
          SELECT id, channel, author, text, ts
          FROM messages
          WHERE channel = $1 AND ($2::bigint IS NULL OR ts > $2)
          ORDER BY ts ASC
          LIMIT $3
          `,
          [channel, since || null, limit]
        );
        const list = rows;
        const lastTs = list.length ? list[list.length - 1].ts : since;
        return ok(res, { list, lastTs });
      } catch (e) {
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

  // --- POST /api/messages  (JSON: {channel, author, text})
  if (req.method === "POST") {
    let data = {};
    try { data = JSON.parse(body || "{}"); } catch { return bad(res, 400, "invalid_json"); }

    const ch = String((data.channel || channel || "")).trim();
    if (!ch) return bad(res, 400, "channel_required");

    const author = String(data.author || "").trim();
    const text   = String(data.text   || "").trim();

    if (!author) return bad(res, 400, "author_required");
    if (!text)   return bad(res, 400, "text_required");

    const doc = { id: uid(), channel: ch, author, text, ts: now() };

    if (hasDB) {
      const client = pg();
      try {
        await client.connect();
        await client.query(
          `INSERT INTO messages (id, channel, author, text, ts)
           VALUES ($1, $2, $3, $4, $5)`,
          [doc.id, doc.channel, doc.author, doc.text, doc.ts]
        );
        return ok(res, { message: doc });
      } catch (e) {
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

  // --- DELETE /api/messages?channel=...  (prod'da kapalı)
  if (req.method === "DELETE") {
    if (!allowDelete) return bad(res, 403, "delete_disabled");

    if (!channel) return bad(res, 400, "channel_required");

    if (hasDB) {
      const client = pg();
      try {
        await client.connect();
        await client.query(`DELETE FROM messages WHERE channel = $1`, [channel]);
        return ok(res, { cleared: true });
      } catch (e) {
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
