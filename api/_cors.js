// api/_cors.js  — CORS (credentials ON, wildcard OFF)
function norm(u){ return (u || '').trim().replace(/\/+$/, ''); }

export default function applyCors(req, res) {
  // Env: "https://burak.wtf,https://www.burak.wtf,https://ch4t.burak.wtf"
  const allowList = String(
    process.env.CORS_ALLOW_ORIGINS ||
    process.env.CORS_ALLOW_ORIGIN ||
    ''
  ).split(',').map(s => norm(s)).filter(Boolean);

  const origin = norm(req?.headers?.origin || '');
  const listed = origin && allowList.includes(origin); // sadece tam eşleşme

  // Vary: Origin (cache doğruluğu)
  const prevVary = res.getHeader && res.getHeader('Vary');
  const vary = new Set(String(prevVary || '').split(',').map(s => s.trim()).filter(Boolean));
  vary.add('Origin');
  res.setHeader('Vary', Array.from(vary).join(', '));

  // Credentials açıkken wildcard YASAK — sadece listed origin'e izin ver
  if (listed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // <— credentials ON
  }
  // Her halükârda izin verilen method/header listesi:
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}
