import crypto from "crypto";
import { DEBUG_SANDBOX, ALLOWLIST_IMAGES, DIGEST_REQUIRED, WORKSPACES_ROOT } from "./config.js";
import fsSync from "fs";
import path from "path";

export function getAllowlist() { return ALLOWLIST_IMAGES; }
export function getAllowedNetworkModes() { return [process.env.FORCED_NETWORK_MODE || "bridge"]; }
export function getDefaultNetworkMode() { return process.env.FORCED_NETWORK_MODE || "bridge"; }

export function logDebug(...a) {
  if (DEBUG_SANDBOX) console.log("[containerManager]", ...a);
}

export function imageAllowed(img) {
  if (!ALLOWLIST_IMAGES.includes(img)) return false;
  if (DIGEST_REQUIRED && !/@sha256:[0-9a-f]{64}$/.test(img)) return false;
  return true;
}

export async function ensureWorkspaceRoot() {
  if (process.env.USE_HOST_WORKSPACE === "true" && !fsSync.existsSync(WORKSPACES_ROOT)) {
    fsSync.mkdirSync(WORKSPACES_ROOT, { recursive: true, mode: 0o750 });
  }
}

export function sessionWorkspaceDir(sessionId) {
  return path.join(WORKSPACES_ROOT, sessionId);
}

export function parseMemory(mem) {
  if (!mem) return;
  const m = /^(\d+(?:\.\d+)?)([kKmMgG])?$/.exec(mem);
  if (!m) return;
  const num = parseFloat(m[1]);
  const unit = (m[2] || "").toLowerCase();
  const mult = unit === "k" ? 1024 : unit === "m" ? 1024*1024 : unit === "g" ? 1024*1024*1024 : 1;
  return Math.round(num * mult);
}

export function parseCPUs(cpus) {
  if (!cpus) return;
  const n = parseFloat(cpus);
  if (isNaN(n) || n <= 0) return;
  return Math.round(n * 1e9);
}

export function randomId(bytes = 8) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function escapeBash(p) {
  return p.replace(/(["`$\\])/g, "\\$1");
}
