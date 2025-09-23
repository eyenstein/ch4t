// api/_cors.js — credentials ON, wildcard OFF
function norm(u){ return (u || '').trim().replace(/\/+$/, ''); }

export default function applyCors(req, res) {
  const allowList = String(
    process.env.CORS_ALLOW_ORIGINS ||
    process.env.CORS_ALLOW_ORIGIN ||
    ''
  ).split(',').map((s) => norm(s)).filter(Boolean);

  const origin = norm(req?.headers?.origin || '');
  const listed = origin && allowList.includes(origin);

  try { res.setHeader('Vary', 'Origin'); } catch {}

  if (listed) {
    try {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } catch {}
  }
  try {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  } catch {}
}
