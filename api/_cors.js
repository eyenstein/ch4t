// _cors.js
const ALLOW = (process.env.CORS_ALLOW_ORIGINS || "").split(",");
// ör: "https://burak.wtf,https://www.burak.wtf,null,http://localhost:8000"

export default function applyCORS(req, res) {
  const origin = req.headers.origin || "null";
  if (req.method === "OPTIONS") {
    if (ALLOW.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
      res.status(204).end();
      return true;
    }
    res.status(404).end(); return true;
  }

  if (ALLOW.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  return false;
}
