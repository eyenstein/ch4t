// /api/_cors.js
export default function applyCORS(req, res) {
  const origin = req.headers.origin || "";
  const list = (process.env.CORS_ALLOW_ORIGINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const allowed =
    list.includes("*") ||
    (origin && list.includes(origin)) ||
    (!origin && list.includes("null"));

  if (allowed && origin) {
    // credentials kullanılacağı için wildcard YOK; gelen origin'i aynen yansıt.
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  // Bunlar env’den değil, koddandır:
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] || "Content-Type,Authorization"
  );

  if (process.env.CORS_ALLOW_CREDENTIALS === "true") {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  // Preflight ise burada bitir
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}
