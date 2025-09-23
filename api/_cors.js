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
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  // Bu ikisi buradan geliyor 👇
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] || "Content-Type,Authorization"
  );

  if (process.env.CORS_ALLOW_CREDENTIALS === "true") {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}
