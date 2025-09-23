// /api/account.js
import applyCORS from "./_cors.js";
import jwt from "jsonwebtoken";
import { Client } from "pg";

const hasDB = !!process.env.base_url;

function pg() { return new Client({ connectionString: process.env.base_url }); }
function bad(res, code, error){ res.status(code).json({ ok:false, error }); }
function ok(res, payload){ res.status(200).json({ ok:true, ...payload }); }

function issueToken(nick){
  return jwt.sign({ sub:nick }, process.env.JWT_SECRET || "dev", { expiresIn: "30d" });
}
function setAuthCookie(res, token){
  const maxAge = 60*60*24*30; // 30 gün
  res.setHeader("Set-Cookie",
    `ch4t_token=${token}; Path=/; Domain=.burak.wtf; Max-Age=${maxAge}; SameSite=None; Secure; HttpOnly`
  );
}

async function ensureTables(client){
  await client.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      nick TEXT PRIMARY KEY,
      pass TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export default async function handler(req, res){
  if (applyCORS(req, res)) return;
  if (req.method !== "POST") return bad(res, 405, "method_not_allowed");

  let body = {};
  try {
    body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
  } catch { return bad(res, 400, "invalid_json"); }

  const nick = String(body.nick || "").trim();
  const pass = String(body.pass || "").trim();
  if (!nick || !pass) return bad(res, 400, "nick_and_pass_required");

  if (!hasDB){
    const token = issueToken(nick);
    setAuthCookie(res, token);
    return ok(res, { token, nick, created:true });
  }

  const client = pg();
  await client.connect();
  try {
    await ensureTables(client);
    const sel = await client.query("SELECT pass FROM accounts WHERE nick=$1", [nick]);

    if (sel.rowCount === 0){
      await client.query("INSERT INTO accounts(nick, pass) VALUES($1,$2)", [nick, pass]);
      const token = issueToken(nick);
      setAuthCookie(res, token);
      return ok(res, { token, nick, created:true });
    } else {
      const dbPass = sel.rows[0].pass;
      if (dbPass !== pass) return bad(res, 401, "wrong_password");
      const token = issueToken(nick);
      setAuthCookie(res, token);
      return ok(res, { token, nick });
    }
  } catch(e){
    console.error("account error", e);
    return bad(res, 500, "server_error");
  } finally {
    try { await client.end(); } catch {}
  }
}
