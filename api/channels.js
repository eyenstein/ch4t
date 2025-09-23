export const config = { runtime: "nodejs" };
import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const url = new URL(req.url, `http://${req.headers.host}`);
    const nickParam = url.searchParams.get("me") ?? url.searchParams.get("nick") ?? "";
    const nick = String(nickParam).trim().toLowerCase();

  const out = new Set(["#wtf"]);
  try {
    let cursor = 0;
    do {
      const resScan = await redis.scan(cursor, {
        match: "ch4t:chan:dm:*:messages",
        count: 200
      });
      cursor = Number(resScan[0] || 0);
      const keys = resScan[1] || [];
      for (const k of keys) {
        const chan = k.slice("ch4t:chan:".length, -":messages".length); // "dm:a|b"
        if (!nick) { out.add(chan); continue; }
        const pair = chan.startsWith("dm:") ? chan.slice(3) : chan;
        const [a, b] = pair.split("|");
        if ((a && a.toLowerCase() === nick) || (b && b.toLowerCase() === nick)) {
          out.add("dm:" + [a, b].join("|").toLowerCase());
        }
      }
    } while (cursor !== 0);
  } catch (e) {
    console.error(e);
  }

    return res.status(200).json({ channels: Array.from(out) });
}
