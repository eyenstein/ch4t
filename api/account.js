// apps/ch4t/api/account.js
import { Redis } from "@upstash/redis";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import cors from "./_cors.js"; 

// ---- env guard
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || "";
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const JWT_SECRET  = process.env.JWT_SECRET || "";

function bad(res, code = 400, error = "bad_request") {
  res.status(code).json({ ok:false, error });
}

function ok(res, payload) {
  res.status(200).json({ ok:true, ...payload });
}

function normalizeNick(n) {
  // İstersen sadece küçük harfe zorla:
  // return String(n||"").trim().toLowerCase().slice(0, 24);
  // Veya görünümde büyük-küçük kalsın, anahtar için lowercase kullan:
  return String(n||"").trim().slice(0, 24);
}

function redis() {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  return new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
}

async function getUser(r, nick) {
  const key = `user:${nick.toLowerCase()}`;   // anahtar normalize
  const data = await r.hgetall(key);
  if (!data || Object.keys(data).length === 0) return null;
  return { nick: data.nick, passHash: data.passHash };
}

async function createUser(r, nick, pass) {
  const key = `user:${nick.toLowerCase()}`;
  const passHash = await bcrypt.hash(pass, 10);
  await r.hset(key, { nick, passHash });
}

function makeToken(nick) {
  if (!JWT_SECRET) return ""; // frontend bunu boş olabilir diye tolere ediyor ama tavsiye edilmez
  return jwt.sign({ nick }, JWT_SECRET, { expiresIn: "30d" });
}

export default async function handler(req, res) {
  // CORS
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  // DB hazır mı?
  const r = redis();
  if (!r) return bad(res, 500, "db_not_configured");

  // Sadece POST (reserve/login birleştirilmiş akış)
  if (req.method !== "POST") return bad(res, 405, "method_not_allowed");

  try {
    const { nick, pass } = (await (async()=>{
      try { return await new Promise((resolve, reject)=>{
        let body = "";
        req.on("data", c => { body += c; });
        req.on("end", ()=> { try { resolve(JSON.parse(body||"{}")); } catch(e){ resolve({}); } });
        req.on("error", reject);
      }); } catch { return {}; }
    })());

    const n = normalizeNick(nick);
    const p = String(pass || "");

    if (!n || !p) return bad(res, 400, "nick_and_pass_required");

    const user = await getUser(r, n);
    if (!user) {
      // Kayıt (reserve)
      await createUser(r, n, p);
      const token = makeToken(n);
      return ok(res, { nick: n, token });
    } else {
      // Login (re-reserve gibi çalışır)
      const okPw = await bcrypt.compare(p, user.passHash || "");
      if (!okPw) return bad(res, 401, "wrong_password");
      const token = makeToken(n);
      return ok(res, { nick: n, token });
    }
  } catch (e) {
    // Hata durumunda frontend map'i düzgün gösterir
    return bad(res, 500, "server_error");
  }
}
