import applyCors from './_cors.js';
export const config = { runtime: "nodejs" };
export default function handler(req, res) {
  res.status(200).json({ pong: true, path: "/api/ping" });
}
