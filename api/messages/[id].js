// api/messages/[id].js
import applyCORS, { isAdmin } from "../_cors.js";

// not: global mem varsa kullanılır, yoksa DB fallback
export default async function handler(req, res) {
  if (applyCORS(req, res)) return; // OPTIONS isteği burada biter

  const { id } = req.query;

  if (req.method !== "DELETE") {
    res.setHeader("Allow", "DELETE,OPTIONS");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  // admin token kontrolü
  if (!isAdmin(req)) {
    return res.status(401).json({ ok: false, error: "invalid_or_missing_token" });
  }

  try {
    // ---- A) memstore (in-memory) ----
    if (typeof mem !== "undefined" && mem?.byCh) {
      for (const [chName, chObj] of mem.byCh.entries()) {
        const i = chObj.list.findIndex(m => m.id === id);
        if (i !== -1) {
          chObj.list[i].is_deleted = true;
          chObj.list[i].deleted_at = Date.now();
          return res.status(200).json({
            ok: true,
            id,
            deleted_by: "admin_token",
            channel: chName,
          });
        }
      }
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    // ---- B) Postgres / DB ----
    /*
    const { Client } = require("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const q = await client.query("SELECT id FROM messages WHERE id=$1", [id]);
    if (q.rows.length === 0) {
      await client.end();
      return res.status(404).json({ ok:false, error:"not_found" });
    }
    await client.query("UPDATE messages SET is_deleted=true, deleted_at=NOW() WHERE id=$1", [id]);
    await client.end();
    return res.status(200).json({ ok:true, id, deleted_by:"admin_token" });
    */
  } catch (e) {
    console.error("admin-delete-error", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
