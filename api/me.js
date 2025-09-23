// /api/me.js
import applyCORS from "./_cors.js";
import jwt from "jsonwebtoken";

function bad(res, code, error) {
  res.status(code).json({ ok: false, error });
}
function ok(res, payload) {
  res.status(200).json({ ok: true, ...payload });
}

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;

  if (req.method !== "GET") {
    return bad(res, 405, "method_not_allowed");
  }

  try {
    // Cookie çek
    const cookie = req.headers.cookie || "";
    const match = cookie.match(/(?:^|;\s*)ch4t_token=([^;]+)/);
    if (!match) {
      return bad(res, 401, "no_token");
    }

    const token = match[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev");

    return ok(res, { user: { nick: payload.sub } });
  } catch (e) {
    console.error("me error", e);
    return bad(res, 401, "invalid_token");
  }
}
