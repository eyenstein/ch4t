export const config = { runtime: "nodejs" };

import { Redis } from "@upstash/redis";
import applyCors from './_cors.js';
const redis = Redis.fromEnv();

const H_NICKS = "ch4t:presence:nicks";
const Z_ANON  = "ch4t:presence:anon";
const WINDOW_MS = 60_000;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}
const now = () => Date.now();

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "POST") {
      const { nick = "" } = await readJson(req);
      const ts = now();
      if (nick && nick.trim()) {
        await redis.hset(H_NICKS, { [nick.trim()]: ts });
      } else {
        const member = `${ts}-${Math.random().toString(36).slice(2)}`;
        await redis.zadd(Z_ANON, { score: ts, member });
        await redis.zremrangebyscore(Z_ANON, 0, ts - WINDOW_MS);
      }
      return res.status(200).json({ ok: true });
    }

    if (req.method === "GET") {
      const ts = now();
      const all = await redis.hgetall(H_NICKS) || {};
      let nick_count = 0;
      for (const k in all) if (Number(all[k] || 0) >= ts - WINDOW_MS) nick_count++;
      await redis.zremrangebyscore(Z_ANON, 0, ts - WINDOW_MS);
      const anon_count = await redis.zcount(Z_ANON, ts - WINDOW_MS, "+inf");
      return res.status(200).json({ users: Array(nick_count).fill(0), anon_count });
    }

    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server_error" });
  }
}

async function readJson(req) {
  return await new Promise((resolve) => {
    let b = "";
    req.on("data", c => (b += c));
    req.on("end", () => {
      try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); }
    });
  });
}
