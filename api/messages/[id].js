// apps/ch4t/api/messages/[id].js
import { Client } from "pg";
import applyCORS, { isAdmin } from "../_cors.js";

const hasDB = !!process.env.DATABASE_URL;

function pg() {
  return new Client({ connectionString: process.env.DATABASE_URL });
}
function ok(res, payload = {}) {
  res.status(200).json({ ok: true, ...payload });
}
function bad(res, code, error) {
  res.status(code).json({ ok: false, error });
}

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;

  // Yalnızca DELETE
  if (req.method !== "DELETE") {
    res.setHeader("Allow", "DELETE, OPTIONS");
    return bad(res, 405, "method_not_allowed");
  }

  // Admin token kontrolü
  if (!isAdmin(req)) return bad(res, 401, "invalid_or_missing_delete_token");

  // Param: /api/messages/:id
  // Vercel node runtime'da req.query.id mevcut
  const id = (req.query?.id || "").trim();
  if (!id) return bad(res, 400, "id_required");

  if (!hasDB) {
    // İstersen burada in-memory temizleme de yapabilirdik ama paylaşılan mem yok.
    // DB yoksa şimdilik desteklemiyoruz:
    return bad(res, 501, "delete_requires_database");
  }

  const client = pg();
  try {
    await client.connect();
    const q = await client.query(`DELETE FROM messages WHERE id = $1`, [id]);
    if (q.rowCount === 0) return bad(res, 404, "not_found");
    return ok(res, { deleted: true, id });
  } catch (e) {
    console.error("DELETE /messages/:id DB error:", e);
    return bad(res, 500, "db_delete_failed");
  } finally {
    try { await client.end(); } catch {}
  }
}
