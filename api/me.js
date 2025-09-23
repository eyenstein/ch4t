// /api/me.js  (SERVER)
import applyCORS from "./_cors.js";
import jwt from "jsonwebtoken";

function bad(res, code, error) {
  res.status(code).json({ ok: false, error });
}
function ok(res, payload) {
  res.status(200).json({ ok: true, ...payload });
}

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;        // preflight vs burada çözüldü
  if (req.method !== "GET") return bad(res, 405, "method_not_allowed");

  try {
    // 1) Authorization: Bearer <token>
    let token = null;
    const auth = req.headers.authorization || "";
    if (auth.startsWith("Bearer ")) token = auth.slice(7);

    // 2) Cookie fallback: ch4t_token
    if (!token) {
      const cookie = req.headers.cookie || "";
      const m = cookie.match(/(?:^|;\s*)ch4t_token=([^;]+)/);
      if (m) token = m[1];
    }

    if (!token) return bad(res, 401, "no_token");

    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev");
      return res.status(200).json({ ok:true, nick: payload.sub });
  } catch (e) {
    console.error("me error", e);
    return bad(res, 401, "invalid_token");
  }
}
