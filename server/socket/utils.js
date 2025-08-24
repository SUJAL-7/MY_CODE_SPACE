import { INPUT_MAX_TOKENS_PER_SEC, INPUT_BURST_BYTES } from "./config.js";

export function now() {
  return Date.now();
}

export function refillTokens(sess) {
  const ts = now();
  const elapsed = (ts - sess.lastRefill) / 1000;
  if (elapsed <= 0) return;
  const add = elapsed * INPUT_MAX_TOKENS_PER_SEC;
  sess.inputTokens = Math.min(INPUT_BURST_BYTES, sess.inputTokens + add);
  sess.lastRefill = ts;
}

export function randomToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
