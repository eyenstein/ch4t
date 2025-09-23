// api/messages/[id].js
// Vercel serverless handler: DELETE /api/messages/:id
// Destekler: ADMIN_DELETE_TOKEN (env) ile admin silme.
// Adapt: mem erişimini kendi proje yapına göre ayarla.

const ADMIN_DELETE_TOKEN = process.env.ADMIN_DELETE_TOKEN || null;

export default async function handler(req, res) {
  const { id } = req.query;
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return res.status(405).json({ ok:false, error:'method_not_allowed' });
  }

  const provided = (req.headers['x-delete-token'] || req.query.token || '').trim();
  if (!provided) return res.status(401).json({ ok:false, error:'no_token' });

  // ADMIN token doğrulama
  if (ADMIN_DELETE_TOKEN && provided === ADMIN_DELETE_TOKEN) {
    // ---- A) Eğer memstore (in-memory) kullanıyorsan: ----
    // Burada `mem` global veya import edilebilir olmalı. Projene göre düzenle.
    try {
      if (typeof mem !== 'undefined' && mem?.byCh) {
        // tüm kanallarda ara
        for (const [chName, chObj] of mem.byCh.entries()) {
          const i = chObj.list.findIndex(m => m.id === id);
          if (i !== -1) {
            chObj.list[i].is_deleted = true;
            chObj.list[i].deleted_at = Date.now();
            // opsiyonel: broadcast / push update
            return res.status(200).json({ ok:true, id, deleted_by: 'admin_token', channel: chName });
          }
        }
        return res.status(404).json({ ok:false, error:'not_found' });
      }

      // ---- B) Eğer Postgres/DB kullanıyorsan: (aşağıdaki kodu aktif et ve mem kısmını kaldır)
      /*
      const { Client } = require('pg');
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      const q = await client.query('SELECT id FROM messages WHERE id=$1', [id]);
      if (q.rows.length === 0) {
        await client.end();
        return res.status(404).json({ ok:false, error:'not_found' });
      }
      await client.query('UPDATE messages SET is_deleted=true, deleted_at=NOW() WHERE id=$1', [id]);
      await client.end();
      return res.status(200).json({ ok:true, id, deleted_by: 'admin_token' });
      */
    } catch (e) {
      console.error('admin-delete-error', e);
      return res.status(500).json({ ok:false, error:'server_error' });
    }
  }

  // eğer buraya geldiyse token geçersiz
  return res.status(403).json({ ok:false, error:'invalid_token' });
}
