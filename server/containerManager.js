/**
 * Minimal Container Manager with optional host workspace binding.
 * If USE_HOST_WORKSPACE=false, no host bind is mounted; workspace is ephemeral inside container FS.
 * Added: startStatsStream / stopStatsStream exports (fix for missing export error).
 */

import Docker from "dockerode";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import crypto from "crypto";

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || "/var/run/docker.sock" });

const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT || path.join(process.cwd(), "workspaces");
const FORCED_BASE_IMAGE = (process.env.FORCED_BASE_IMAGE || "ubuntu:22.04").trim();
const ALLOWLIST_IMAGES = (process.env.ALLOWLIST_IMAGES || FORCED_BASE_IMAGE)
  .split(",").map(s => s.trim()).filter(Boolean);

const DIGEST_REQUIRED = (process.env.DIGEST_REQUIRED || "false") === "true";
const NETWORK_MODE = process.env.FORCED_NETWORK_MODE || "bridge";

const READONLY_ROOT = (process.env.READONLY_ROOT || "false") === "true";
const SANDBOX_MEMORY = process.env.SANDBOX_MEMORY || "1g";
const SANDBOX_CPUS = process.env.SANDBOX_CPUS || "1.0";
const SANDBOX_AUTOREMOVE = process.env.SANDBOX_AUTOREMOVE !== "false";
const SANDBOX_RUNTIME = process.env.SANDBOX_RUNTIME || "";

const RETAIN_CAP_DROP_ALL = (process.env.RETAIN_CAP_DROP_ALL || "1") === "1";
const ALLOWED_EXTRA_CAPS = (process.env.ALLOWED_EXTRA_CAPS || "").split(/\s+/).filter(Boolean);

const UID = process.env.SANDBOX_USER_UID || "";
const GID = process.env.SANDBOX_USER_GID || "";
const DEBUG_SANDBOX = process.env.DEBUG_SANDBOX === "1";

const USE_HOST_WORKSPACE = (process.env.USE_HOST_WORKSPACE || "false") === "true";
const WORKSPACE_PATH = process.env.WORKSPACE_PATH || "/workspace";

export function getAllowlist() { return ALLOWLIST_IMAGES; }
export function getAllowedNetworkModes() { return [NETWORK_MODE]; }
export function getDefaultNetworkMode() { return NETWORK_MODE; }

function logDebug(...a) { if (DEBUG_SANDBOX) console.log("[containerManager]", ...a); }

function imageAllowed(img) {
  if (!ALLOWLIST_IMAGES.includes(img)) return false;
  if (DIGEST_REQUIRED && !/@sha256:[0-9a-f]{64}$/.test(img)) return false;
  return true;
}

export async function ensureWorkspaceRoot() {
  if (USE_HOST_WORKSPACE && !fsSync.existsSync(WORKSPACES_ROOT)) {
    fsSync.mkdirSync(WORKSPACES_ROOT, { recursive: true, mode: 0o750 });
  }
}

function sessionWorkspaceDir(sessionId) {
  return path.join(WORKSPACES_ROOT, sessionId);
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

export async function createSessionExecShell({ sessionId, username }) {
  const baseImage = FORCED_BASE_IMAGE;
  if (!imageAllowed(baseImage)) throw new Error("Forced base image not allowed");
  await pullImageIfNeeded(baseImage);

  let hostDir = null;
  const binds = [];
  if (USE_HOST_WORKSPACE) {
    hostDir = sessionWorkspaceDir(sessionId);
    if (!fsSync.existsSync(hostDir)) fsSync.mkdirSync(hostDir, { recursive: true, mode: 0o750 });
    binds.push(`${hostDir}:${WORKSPACE_PATH}:rw`);
  }

  const HostConfig = {
    AutoRemove: SANDBOX_AUTOREMOVE,
    NetworkMode: NETWORK_MODE,
    ReadonlyRootfs: READONLY_ROOT,
    SecurityOpt: ["no-new-privileges:true"]
  };
  if (binds.length) HostConfig.Binds = binds;
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
    `WORKSPACE_DIR=${WORKSPACE_PATH}`,
    `DEVSPACE_SESSION_ID=${sessionId}`,
    `DEVSPACE_USER=${username}`,
  ];

  const createOpts = {
    Image: baseImage,
    Tty: false,
    OpenStdin: false,
    Cmd: ["sleep", "infinity"],
    WorkingDir: WORKSPACE_PATH,
    HostConfig,
    Env: baseEnv,
    Labels: {
      "devspace.session": sessionId,
      "devspace.user": username,
      "devspace.image": baseImage,
      "devspace.use_host_workspace": String(USE_HOST_WORKSPACE)
    }
  };
  if (UID) createOpts.User = GID ? `${UID}:${GID}` : UID;

  logDebug("Creating container", { sessionId, baseImage, USE_HOST_WORKSPACE });

  const container = await docker.createContainer(createOpts);
  await container.start();

  // Ensure workspace dir exists (ephemeral case)
  if (!USE_HOST_WORKSPACE) {
    try {
      await execCapture(container, `bash -lc 'mkdir -p "${escapeBash(WORKSPACE_PATH)}"'`);
    } catch {}
  }

  const exec = await container.exec({
    Cmd: ["/bin/bash", "--login"],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    WorkingDir: WORKSPACE_PATH,
    Env: baseEnv
  });
  const stream = await exec.start({ hijack: true, stdin: true });

  return {
    container,
    exec,
    stream,
    workspaceDir: hostDir || null,
    baseImage,
    networkMode: NETWORK_MODE
  };
}

async function execCapture(container, cmd) {
  const exec = await container.exec({
    Cmd: ["bash", "-lc", cmd],
    AttachStdout: true,
    AttachStderr: true,
    Tty: false
  });
  return new Promise((resolve, reject) => {
    exec.start((err, stream) => {
      if (err) return reject(err);
      let data = "";
      stream.on("data", d => { data += d.toString("utf8"); });
      stream.on("error", reject);
      stream.on("end", () => resolve(data));
    });
  });
}

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

export async function removeWorkspaceDir(sessionId) {
  if (!USE_HOST_WORKSPACE) return;
  try {
    await fs.rm(sessionWorkspaceDir(sessionId), { recursive: true, force: true });
  } catch {}
}

/* ---------------- Stats Streaming (re-added) ---------------- */
export function startStatsStream(session, onStat, onEnd) {
  const { container } = session;
  let closed = false;
  container.stats({ stream: true }, (err, s) => {
    if (err || !s) { onEnd?.(err); return; }
    session._statsStream = s;
    s.on("data", (chunk) => {
      try {
        const obj = JSON.parse(chunk.toString("utf8"));
        const cpuDelta = obj.cpu_stats?.cpu_usage?.total_usage - obj.precpu_stats?.cpu_usage?.total_usage;
        const sysDelta = obj.cpu_stats?.system_cpu_usage - obj.precpu_stats?.system_cpu_usage;
        let cpuPercent = 0;
        if (cpuDelta > 0 && sysDelta > 0) {
          const cores = obj.cpu_stats?.online_cpus || obj.cpu_stats?.cpu_usage?.percpu_usage?.length || 1;
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

/* ---------------- Utility ---------------- */
export function randomId(bytes = 8) {
  return crypto.randomBytes(bytes).toString("hex");
}

function escapeBash(p) {
  return p.replace(/(["`$\\])/g, "\\$1");
}