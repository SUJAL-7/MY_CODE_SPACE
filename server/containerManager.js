/**
 * Minimal DevSpace Container Manager
 * - No init tasks or pre-installation
 * - Silent startup (no banner)
 * - Writable rootfs so user can install what they want
 * - Capability drop (ALL) by default for safety
 */

import Docker from "dockerode";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import crypto from "crypto";

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || "/var/run/docker.sock" });

/* ---------------- Configuration ---------------- */
const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT || path.join(process.cwd(), "workspaces");

const FORCED_BASE_IMAGE = (process.env.FORCED_BASE_IMAGE || "ubuntu:22.04").trim();
const ALLOWLIST_IMAGES = (process.env.ALLOWLIST_IMAGES || FORCED_BASE_IMAGE)
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
const DIGEST_REQUIRED = (process.env.DIGEST_REQUIRED || "false") === "true";

const NETWORK_MODE = process.env.FORCED_NETWORK_MODE || "bridge";
const READONLY_ROOT = (process.env.READONLY_ROOT || "false") === "true"; // we default to writable for user installs
const SANDBOX_MEMORY = process.env.SANDBOX_MEMORY || "1g";
const SANDBOX_CPUS = process.env.SANDBOX_CPUS || "1.0";
const SANDBOX_AUTOREMOVE = process.env.SANDBOX_AUTOREMOVE !== "false";
const SANDBOX_RUNTIME = process.env.SANDBOX_RUNTIME || "";

const RETAIN_CAP_DROP_ALL = (process.env.RETAIN_CAP_DROP_ALL || "1") === "1";
const ALLOWED_EXTRA_CAPS = (process.env.ALLOWED_EXTRA_CAPS || "").split(/\s+/).filter(Boolean);

const DEBUG_SANDBOX = process.env.DEBUG_SANDBOX === "1";
const SANDBOX_NPM_PROGRESS = (process.env.SANDBOX_NPM_PROGRESS || "0") === "1";

const UID = process.env.SANDBOX_USER_UID || "";
const GID = process.env.SANDBOX_USER_GID || "";
const PERSIST_WORKSPACE_PER_USER = (process.env.PERSIST_WORKSPACE_PER_USER || "0") === "1";

/* --------------- Exports for config endpoint --------------- */
export function getAllowlist() { return ALLOWLIST_IMAGES; }
export function getAllowedNetworkModes() { return [NETWORK_MODE]; }
export function getDefaultNetworkMode() { return NETWORK_MODE; }

/* ---------------- Utilities ---------------- */
function logDebug(...a) { if (DEBUG_SANDBOX) console.log("[containerManager]", ...a); }

function imageAllowed(img) {
  if (!ALLOWLIST_IMAGES.includes(img)) return false;
  if (DIGEST_REQUIRED && !/@sha256:[0-9a-f]{64}$/.test(img)) return false;
  return true;
}

export async function ensureWorkspaceRoot() {
  if (!fsSync.existsSync(WORKSPACES_ROOT)) {
    fsSync.mkdirSync(WORKSPACES_ROOT, { recursive: true, mode: 0o750 });
  }
}

function sessionWorkspaceDir(sessionId, username) {
  if (!PERSIST_WORKSPACE_PER_USER) return path.join(WORKSPACES_ROOT, sessionId);
  const userRoot = path.join(WORKSPACES_ROOT, username);
  if (!fsSync.existsSync(userRoot)) fsSync.mkdirSync(userRoot, { recursive: true, mode: 0o750 });
  return path.join(userRoot, sessionId);
}

function parseMemory(mem) {
  if (!mem) return;
  const m = /^(\d+(?:\.\d+)?)([kKmMgG])?$/.exec(mem);
  if (!m) return;
  const num = parseFloat(m[1]);
  const unit = (m[2] || "").toLowerCase();
  const mult = unit === "k" ? 1024 : unit === "m" ? 1024 * 1024 : unit === "g" ? 1024 * 1024 * 1024 : 1;
  return Math.round(num * mult);
}

function parseCPUs(cpus) {
  if (!cpus) return;
  const n = parseFloat(cpus);
  if (isNaN(n) || n <= 0) return;
  return Math.round(n * 1e9);
}

async function pullImageIfNeeded(image) {
  try {
    await docker.getImage(image).inspect();
  } catch {
    if (!imageAllowed(image)) throw new Error("Image not allowed");
    await new Promise((resolve, reject) => {
      docker.pull(image, (err, stream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (err2) => err2 ? reject(err2) : resolve(), () => {});
      });
    });
  }
}

/* ---------------- Main: createSessionExecShell ---------------- */
export async function createSessionExecShell({ sessionId, username }) {
  const baseImage = FORCED_BASE_IMAGE;
  if (!imageAllowed(baseImage)) throw new Error("Forced base image not allowed");
  await pullImageIfNeeded(baseImage);

  const workspaceDir = sessionWorkspaceDir(sessionId, username);
  if (!fsSync.existsSync(workspaceDir)) fsSync.mkdirSync(workspaceDir, { recursive: true, mode: 0o750 });

  // Basic npm caches only (optional)
  const npmCacheDir = path.join(workspaceDir, ".npm");
  const npmPrefixDir = path.join(workspaceDir, ".npm-global");
  for (const d of [npmCacheDir, npmPrefixDir]) {
    if (!fsSync.existsSync(d)) fsSync.mkdirSync(d, { recursive: true, mode: 0o750 });
  }

  const npmrcPath = path.join(workspaceDir, ".npmrc");
  if (!fsSync.existsSync(npmrcPath)) {
    await fs.writeFile(
      npmrcPath,
      `cache=${npmCacheDir}
prefix=${npmPrefixDir}
fund=false
update-notifier=false
progress=${SANDBOX_NPM_PROGRESS ? "true" : "false"}
audit=false
`
    );
  }

  // HostConfig
  const HostConfig = {
    AutoRemove: SANDBOX_AUTOREMOVE,
    Binds: [`${workspaceDir}:/workspace:rw`],
    NetworkMode: NETWORK_MODE,
    ReadonlyRootfs: READONLY_ROOT,
    SecurityOpt: ["no-new-privileges:true"]
  };
  if (RETAIN_CAP_DROP_ALL) {
    HostConfig.CapDrop = ["ALL"];
  } else if (ALLOWED_EXTRA_CAPS.length) {
    HostConfig.CapAdd = ALLOWED_EXTRA_CAPS;
  }
  const memBytes = parseMemory(SANDBOX_MEMORY);
  if (memBytes) HostConfig.Memory = memBytes;
  const nanoCpus = parseCPUs(SANDBOX_CPUS);
  if (nanoCpus) HostConfig.NanoCpus = nanoCpus;
  if (SANDBOX_RUNTIME) HostConfig.Runtime = SANDBOX_RUNTIME;

  const baseEnv = [
    "LANG=C.UTF-8",
    "LC_ALL=C.UTF-8",
    "TERM=xterm-256color",
    "WORKSPACE_DIR=/workspace",
    "HOME=/root",
    `DEVSPACE_USER=${username}`,
    `NPM_CONFIG_CACHE=${npmCacheDir}`,
    `NPM_CONFIG_PREFIX=${npmPrefixDir}`,
    "NPM_CONFIG_FUND=false",
    "NPM_CONFIG_UPDATE_NOTIFIER=false",
    `NPM_CONFIG_PROGRESS=${SANDBOX_NPM_PROGRESS ? "true" : "false"}`,
    "NPM_CONFIG_AUDIT=false"
  ];

  const createOpts = {
    Image: baseImage,
    Tty: false,
    OpenStdin: false,
    Cmd: ["sleep", "infinity"],
    WorkingDir: "/workspace",
    HostConfig,
    Env: baseEnv,
    Labels: {
      "devspace.session": sessionId,
      "devspace.user": username,
      "devspace.image": baseImage
    }
  };
  if (UID) createOpts.User = GID ? `${UID}:${GID}` : UID;

  logDebug("Creating container", { sessionId, baseImage, READONLY_ROOT });

  const container = await docker.createContainer(createOpts);
  await container.start();

  // Interactive exec (no banner, no extra output)
  const exec = await container.exec({
    Cmd: ["/bin/bash", "--login"],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    WorkingDir: "/workspace",
    Env: baseEnv
  });
  const stream = await exec.start({ hijack: true, stdin: true });

  return { container, exec, stream, workspaceDir, baseImage, networkMode: NETWORK_MODE };
}

/* ---------------- Resize / Cleanup / Stats ---------------- */
export async function resizeExecTTY(container, exec, { cols, rows }) {
  try {
    await docker.modem.post(
      { path: `/exec/${exec.id}/resize`, method: "POST", options: { h: rows, w: cols } },
      () => {}
    );
  } catch {}
}

export async function stopAndRemoveContainer(container) {
  try {
    await container.stop({ t: 1 }).catch(() => {});
    const info = await container.inspect().catch(() => null);
    if (info && !info.HostConfig.AutoRemove) {
      await container.remove({ force: true }).catch(() => {});
    }
  } catch {}
}

export async function removeWorkspaceDir(sessionId, username) {
  try {
    if (PERSIST_WORKSPACE_PER_USER) {
      // If in future you persist per user, adjust removal here
      await fs.rm(path.join(WORKSPACES_ROOT, sessionId), { recursive: true, force: true });
    } else {
      await fs.rm(path.join(WORKSPACES_ROOT, sessionId), { recursive: true, force: true });
    }
  } catch {}
}

export function startStatsStream(session, onStat, onEnd) {
  const { container } = session;
  let closed = false;
  container.stats({ stream: true }, (err, s) => {
    if (err || !s) { onEnd?.(err); return; }
    session._statsStream = s;
    s.on("data", (chunk) => {
      try {
        const obj = JSON.parse(chunk.toString("utf8"));
        const cpuDelta = obj.cpu_stats.cpu_usage.total_usage - obj.precpu_stats.cpu_usage.total_usage;
        const sysDelta = obj.cpu_stats.system_cpu_usage - obj.precpu_stats.system_cpu_usage;
        let cpuPercent = 0;
        if (cpuDelta > 0 && sysDelta > 0) {
          const cores = obj.cpu_stats.online_cpus || obj.cpu_stats.cpu_usage.percpu_usage?.length || 1;
          cpuPercent = (cpuDelta / sysDelta) * cores * 100;
        }
        const memUsed = obj.memory_stats?.usage || 0;
        const memLimit = obj.memory_stats?.limit || 1;
        const memPercent = (memUsed / memLimit) * 100;
        onStat?.({
          cpuPercent: Number(cpuPercent.toFixed(1)),
          memUsed,
          memLimit,
          memPercent: Number(memPercent.toFixed(1))
        });
      } catch {}
    });
    s.on("close", () => { if (!closed) onEnd?.(); });
    s.on("end", () => { if (!closed) onEnd?.(); });
  });
  return () => {
    closed = true;
    try { session._statsStream?.destroy(); } catch {}
    delete session._statsStream;
  };
}

export function stopStatsStream(session) {
  try {
    session._statsStream?.destroy();
    delete session._statsStream;
  } catch {}
}

export function randomId(bytes = 8) {
  return crypto.randomBytes(bytes).toString("hex");
}