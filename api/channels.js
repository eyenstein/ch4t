// apps/ch4t/api/channels.js
export const config = { runtime: "nodejs" };
import { Client } from "pg";
import applyCORS from "./_cors.js";

const hasDB = !!process.env.DATABASE_URL;
function pg(){ return new Client({ connectionString: process.env.DATABASE_URL }); }
function ok(res, payload={}){ res.status(200).json({ ok:true, ...payload }); }
function bad(res, code, error){ res.status(code).json({ ok:false, error }); }

export default async function handler(req,res){
  if (applyCORS(req,res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow","GET,OPTIONS");
    return bad(res,405,"method_not_allowed");
  }
  if (!hasDB) return ok(res, { channels: [] });

  const client = pg();
  try{
    await client.connect();
    const { rows } = await client.query(`
      SELECT
        lower(regexp_replace(channel, '^\\s*#+', '')) AS channel_norm,
        COUNT(*)  AS count,
        MIN(ts)   AS first_ts,
        MAX(ts)   AS last_ts
      FROM messages
      GROUP BY channel_norm
      ORDER BY MIN(ts) ASC
    `);
    const channels = rows.map(r => ({
      channel: r.channel_norm,           // <- artık 'wtf' şeklinde tekilleşmiş
      count: Number(r.count),
      first_ts: Number(r.first_ts),
      last_ts: Number(r.last_ts),
    }));
    return ok(res, { channels });
  }catch(e){
    console.error("GET /channels DB error:", e);
    return bad(res,500,"db_read_failed");
  }finally{
    try{ await client.end(); }catch{}
  }
}
