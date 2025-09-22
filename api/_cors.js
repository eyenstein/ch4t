
export default function cors(res, req) {
  const hdrs = res.getHeader ? (k)=>res.getHeader(k) : ()=>undefined;

  const allowListRaw =
    process.env.CORS_ALLOW_ORIGINS ||
    process.env.CORS_ALLOW_ORIGIN ||
    ""; 

  const allowList = String(allowListRaw)
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const origin = req?.headers?.origin || "";

  // eşleşirse origin'i döndür; '*' varsa hepsine izin
  const isStar = allowList.includes("*");
  const isNullOk = allowList.includes("null") && origin === "null";
  const isListed = allowList.includes(origin);

  if (isStar || isNullOk || isListed) {
    res.setHeader("Access-Control-Allow-Origin", isStar ? "*" : origin);
  }
  // vary
  res.setHeader("Vary", ["Origin"].concat(hdrs("Vary") || []).join(", "));

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  // gerekirse credential
  res.setHeader("Access-Control-Allow-Credentials", "true");
}
