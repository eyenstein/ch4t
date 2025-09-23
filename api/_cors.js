

const ALLOW = (process.env.CORS_ALLOW_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const ADMIN_DELETE_TOKEN = (process.env.ADMIN_DELETE_TOKEN || "").trim();
const DEFAULT_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";

function originAllowed(origin) {
  if (!ALLOW.length) return false;
  if (ALLOW.includes("*")) return true;
  if (!origin || origin === "null") return ALLOW.includes("null");
  return ALLOW.includes(origin);
}

// Route’larda kullanmak için:
// if (!isAdmin(req)) return res.status(401).json({ ok:false, error:"invalid_or_missing_delete_token" });
export function isAdmin(req) {
  const provided = String(req.headers["x-delete-token"] || req.query?.token || "").trim();
  return !!ADMIN_DELETE_TOKEN && !!provided && provided === ADMIN_DELETE_TOKEN;
}

export default function applyCORS(req, res) {
  const origin = req.headers.origin || "null";
  const allowed = originAllowed(origin);

  // Proxy/cache doğruluğu için
  const vary = res.getHeader?.("Vary");
  res.setHeader("Vary", vary ? String(vary) + ", Origin" : "Origin");

  // Preflight için istemcinin istediği header’ları da izin listesine ekle
  const requestedHeaders = String(req.headers["access-control-request-headers"] || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const allowHeaders = new Set([
    "Content-Type",
    "Authorization",
    "X-Delete-Token",
  ]);
  for (const h of requestedHeaders) allowHeaders.add(h);

  if (req.method === "OPTIONS") {
    if (allowed) {
      res.setHeader("Access-Control-Allow-Origin", origin === "null" ? "null" : origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", DEFAULT_METHODS);
      res.setHeader("Access-Control-Allow-Headers", Array.from(allowHeaders).join(", "));
      res.setHeader("Access-Control-Max-Age", "600"); // cachele
      res.status(204).end();
      return true;
    }
    res.status(404).end();
    return true;
  }

  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin === "null" ? "null" : origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    // Sık kullanılan bir expose örneği:
    res.setHeader("Access-Control-Expose-Headers", "X-Total-Count");
  }
  return false;
}
