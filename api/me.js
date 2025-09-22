import jwt from "jsonwebtoken";
import cors from "./_cors.js";

function bad(res, code, error) {
  res.status(code).json({ ok:false, error });
}
function ok(res, payload) {
  res.status(200).json({ ok:true, ...payload });
}

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return bad(res, 405, "method_not_allowed");

  const auth = String(req.headers.authorization || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return bad(res, 401, "unauthorized");

  const token = m[1];
  const secret = process.env.JWT_SECRET || "";
  if (!secret) return bad(res, 500, "server_misconfig");

  try {
    const decoded = jwt.verify(token, secret);
    const nick = String(decoded?.nick || "").trim();
    if (!nick) return bad(res, 401, "invalid_token");
    return ok(res, { nick });
  } catch {
    return bad(res, 401, "invalid_token");
  }
}
