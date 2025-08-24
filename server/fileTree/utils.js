export function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function intEnv(key, def) {
  const raw = process.env[key];
  if (!raw) return def;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
}


