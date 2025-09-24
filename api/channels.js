export const config = { runtime: "nodejs" };
import { Redis } from "@upstash/redis";
import applyCors from './_cors.js';
import { Client } from "pg";
const redis = Redis.fromEnv();
const hasDB = !!process.env.DATABASE_URL;
function pg(){ return new Client({ connectionString: process.env.DATABASE_URL }); }
function ok(res, payload={}){ res.status(200).json({ ok:true, ...payload }); }
function bad(res, code, error){ res.status(code).json({ ok:false, error }); }
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

export default async function handler(req,res){
  if (applyCORS(req,res)) return;

  if (req.method !== "GET") {
    res.setHeader("Allow","GET,OPTIONS");
    return bad(res,405,"method_not_allowed");
  }

  if (!hasDB) {
    // DB yoksa bellekte kanal listesini üretmek zor; şimdilik desteklemiyoruz.
    return ok(res, { channels: [] });
  }

  const client = pg();
  try{
    await client.connect();
    const { rows } = await client.query(`
      SELECT channel,
             COUNT(*)                 AS count,
             MIN(ts)                  AS first_ts,
             MAX(ts)                  AS last_ts
        FROM messages
       GROUP BY channel
       ORDER BY MIN(ts) ASC
    `);
    // sayıları number'a çevir
    const channels = rows.map(r => ({
      channel: r.channel,
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
