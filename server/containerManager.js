import Docker from "dockerode";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import crypto from "crypto";

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || "/var/run/docker.sock" });

/* ---------- Base Config ---------- */
const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT || path.join(process.cwd(), "workspaces");

// Default to a lightweight dev image if not overridden by env.
const FORCED_BASE_IMAGE = (process.env.FORCED_BASE_IMAGE || "dev-base:latest").trim();

const ALLOWLIST_IMAGES = (process.env.ALLOWLIST_IMAGES || FORCED_BASE_IMAGE)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const DIGEST_REQUIRED = (process.env.DIGEST_REQUIRED || "false") === "true";
const NETWORK_MODE = process.env.FORCED_NETWORK_MODE || "bridge";

let READONLY_ROOT = (process.env.READONLY_ROOT || "false") === "true";
let SANDBOX_MEMORY = process.env.SANDBOX_MEMORY || "1g";
let SANDBOX_CPUS = process.env.SANDBOX_CPUS || "1.0";
const SANDBOX_AUTOREMOVE = process.env.SANDBOX_AUTOREMOVE !== "false";
const SANDBOX_RUNTIME = process.env.SANDBOX_RUNTIME || "";

// Security/caps
const RETAIN_CAP_DROP_ALL = (process.env.RETAIN_CAP_DROP_ALL || "1") === "1";
const ALLOWED_EXTRA_CAPS = (process.env.ALLOWED_EXTRA_CAPS || "").split(/\s+/).filter(Boolean);

// Limits
const SANDBOX_PIDS_LIMIT = parseInt(process.env.SANDBOX_PIDS_LIMIT || "0", 10);
const ULIMIT_NOFILE = parseInt(process.env.ULIMIT_NOFILE || "0", 10);
const ULIMIT_NPROC = parseInt(process.env.ULIMIT_NPROC || "0", 10);

// Optional blkio (throttling)
const BLKIO_READ_BPS = parseInt(process.env.BLKIO_READ_BPS || "0", 10); // bytes/sec
const BLKIO_WRITE_BPS = parseInt(process.env.BLKIO_WRITE_BPS || "0", 10);
const BLKIO_READ_IOPS = parseInt(process.env.BLKIO_READ_IOPS || "0", 10); // IOPS
const BLKIO_WRITE_IOPS = parseInt(process.env.BLKIO_WRITE_IOPS || "0", 10);

// Minimal resource mode override
const MINIMAL_RESOURCE_MODE = (process.env.MINIMAL_RESOURCE_MODE || "0") === "1";
if (MINIMAL_RESOURCE_MODE) {
  // Force minimal values (tweak here if you want even smaller)
  SANDBOX_MEMORY = "128m";
  SANDBOX_CPUS = "0.05"; // 5% of a CPU
  READONLY_ROOT = false; // allow basic installs if needed
}

const UID = process.env.SANDBOX_USER_UID || "";
const GID = process.env.SANDBOX_USER_GID || "";
const DEBUG_SANDBOX = process.env.DEBUG_SANDBOX === "1";

const USE_HOST_WORKSPACE = (process.env.USE_HOST_WORKSPACE || "false") === "true";
const WORKSPACE_PATH = process.env.WORKSPACE_PATH || "/workspace";

// (Optional) apt caps integration (default to enabled to allow apt installs)
const ENABLE_APT_CAPS = (process.env.ENABLE_APT_CAPS || "1") === "1";

// Optional tmpfs mount, e.g. "/tmp:rw,noexec,size=64m"
const SANDBOX_TMPFS = process.env.SANDBOX_TMPFS || "";

/* ---------- Exports (small helpers) ---------- */
export function getAllowlist() { return ALLOWLIST_IMAGES; }
export function getAllowedNetworkModes() { return [NETWORK_MODE]; }
export function getDefaultNetworkMode() { return NETWORK_MODE; }

function logDebug(...a) {
  if (DEBUG_SANDBOX) console.log("[containerManager]", ...a);
}

/* ---------- Validation ---------- */
function imageAllowed(img) {
  if (!ALLOWLIST_IMAGES.includes(img)) return false;
  if (DIGEST_REQUIRED && !/@sha256:[0-9a-f]{64}$/.test(img)) return false;
  return true;
}

/* ---------- Workspace ---------- */
export async function ensureWorkspaceRoot() {
  if (USE_HOST_WORKSPACE && !fsSync.existsSync(WORKSPACES_ROOT)) {
    fsSync.mkdirSync(WORKSPACES_ROOT, { recursive: true, mode: 0o750 });
  }
}

function sessionWorkspaceDir(sessionId) {
  return path.join(WORKSPACES_ROOT, sessionId);
}

/* ---------- Parsers ---------- */
function parseMemory(mem) {
  if (!mem) return;
  const m = /^(\d+(?:\.\d+)?)([kKmMgG])?$/.exec(mem);
  if (!m) return;
  const num = parseFloat(m[1]);
  const unit = (m[2] || "").toLowerCase();
  const mult =
    unit === "k" ? 1024 :
    unit === "m" ? 1024 * 1024 :
    unit === "g" ? 1024 * 1024 * 1024 : 1;
  return Math.round(num * mult);
}

function parseCPUs(cpus) {
  if (!cpus) return;
  const n = parseFloat(cpus);
  if (isNaN(n) || n <= 0) return;
  // Docker NanoCPUs = CPUs * 1e9
  return Math.round(n * 1e9);
}

/* ---------- Image Pull ---------- */
async function pullImageIfNeeded(image) {
  try {
    await docker.getImage(image).inspect();
  } catch {
    if (!imageAllowed(image)) throw new Error("Image not allowed");
    await new Promise((resolve, reject) => {
      docker.pull(image, (err, stream) => {
        if (err) return reject(err);
        docker.modem.followProgress(
          stream,
          (err2) => (err2 ? reject(err2) : resolve()),
          () => {} // progress handler noop
        );
      });
    });
  }
}

/* ---------- Main: Create Session + Exec Shell ---------- */
export async function createSessionExecShell({ sessionId, username }) {
  const baseImage = FORCED_BASE_IMAGE;
  if (!imageAllowed(baseImage)) throw new Error("Forced base image not allowed");
  await pullImageIfNeeded(baseImage);

  // Prepare host bind mount (if enabled)
  let hostDir = null;
  const binds = [];
  if (USE_HOST_WORKSPACE) {
    hostDir = sessionWorkspaceDir(sessionId);
    if (!fsSync.existsSync(hostDir)) fsSync.mkdirSync(hostDir, { recursive: true, mode: 0o750 });
    binds.push(`${hostDir}:${WORKSPACE_PATH}:rw`);
  }

  // HostConfig base
  const HostConfig = {
    AutoRemove: SANDBOX_AUTOREMOVE,
    NetworkMode: NETWORK_MODE,
    ReadonlyRootfs: READONLY_ROOT,
    SecurityOpt: ["no-new-privileges:true"],
    Init: true, // use docker --init (tini) for init process
  };

  if (binds.length) HostConfig.Binds = binds;

  // Optional tmpfs (e.g., "/tmp:rw,noexec,size=64m")
  if (SANDBOX_TMPFS) {
    // Support multiple comma-separated entries, e.g. "/tmp:size=64m|/run:size=16m"
    const entries = SANDBOX_TMPFS.split("|").map((s) => s.trim()).filter(Boolean);
    if (entries.length) {
      HostConfig.Tmpfs = {};
      for (const e of entries) {
        // entry format: "/path:options"
        const [mntPath, opts = ""] = e.split(":");
        if (mntPath) HostConfig.Tmpfs[mntPath] = opts;
      }
    }
  }

  // ---------- Capabilities / apt handling ----------
  if (ENABLE_APT_CAPS) {
    // Ensure apt works even if you normally drop all caps
    HostConfig.ReadonlyRootfs = false;
    HostConfig.CapDrop = ["ALL"];
    // Minimal caps to make package installs and file ops sane
    HostConfig.CapAdd = ["SETUID", "SETGID", "DAC_OVERRIDE", "CHOWN", "FOWNER", "MKNOD"];
  } else if (RETAIN_CAP_DROP_ALL) {
    HostConfig.CapDrop = ["ALL"];
    if (ALLOWED_EXTRA_CAPS.length) HostConfig.CapAdd = ALLOWED_EXTRA_CAPS;
  } else if (ALLOWED_EXTRA_CAPS.length) {
    HostConfig.CapAdd = ALLOWED_EXTRA_CAPS;
  }

  // ---------- Resource limits ----------
  const memBytes = parseMemory(SANDBOX_MEMORY);
  if (memBytes) HostConfig.Memory = memBytes;

  const nanoCpus = parseCPUs(SANDBOX_CPUS);
  if (nanoCpus) HostConfig.NanoCpus = nanoCpus;

  if (SANDBOX_PIDS_LIMIT > 0) HostConfig.PidsLimit = SANDBOX_PIDS_LIMIT;
  if (SANDBOX_RUNTIME) HostConfig.Runtime = SANDBOX_RUNTIME;

  // ---------- blkio throttling ----------
  // NOTE: These apply to specific block devices. Path "/dev/sda" is a common default; adjust for your host.
  if (BLKIO_READ_BPS || BLKIO_WRITE_BPS || BLKIO_READ_IOPS || BLKIO_WRITE_IOPS) {
    HostConfig.BlkioDeviceReadBps  = BLKIO_READ_BPS  ? [{ Path: "/dev/sda", Rate: BLKIO_READ_BPS }]   : undefined;
    HostConfig.BlkioDeviceWriteBps = BLKIO_WRITE_BPS ? [{ Path: "/dev/sda", Rate: BLKIO_WRITE_BPS }]  : undefined;
    HostConfig.BlkioDeviceReadIOps = BLKIO_READ_IOPS ? [{ Path: "/dev/sda", Rate: BLKIO_READ_IOPS }]  : undefined;
    HostConfig.BlkioDeviceWriteIOps= BLKIO_WRITE_IOPS? [{ Path: "/dev/sda", Rate: BLKIO_WRITE_IOPS }] : undefined;
  }

  // ---------- Ulimits ----------
  const ulimits = [];
  if (ULIMIT_NOFILE > 0) ulimits.push({ Name: "nofile", Soft: ULIMIT_NOFILE, Hard: ULIMIT_NOFILE });
  if (ULIMIT_NPROC > 0)  ulimits.push({ Name: "nproc",  Soft: ULIMIT_NPROC,  Hard: ULIMIT_NPROC });
  if (ulimits.length) HostConfig.Ulimits = ulimits;

  // ---------- Environment ----------
  const baseEnv = [
    "LANG=C.UTF-8",
    "LC_ALL=C.UTF-8",
    "TERM=xterm-256color",
    `WORKSPACE_DIR=${WORKSPACE_PATH}`,
    `DEVSPACE_SESSION_ID=${sessionId}`,
    `DEVSPACE_USER=${username}`,
    `MINIMAL_RESOURCE_MODE=${String(MINIMAL_RESOURCE_MODE)}`
  ];

  // ---------- Container create/start ----------
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
      "devspace.use_host_workspace": String(USE_HOST_WORKSPACE),
      "devspace.minimal_mode": String(MINIMAL_RESOURCE_MODE),
      "devspace.apt_caps": String(ENABLE_APT_CAPS)
    }
  };

  if (UID) createOpts.User = GID ? `${UID}:${GID}` : UID;

  logDebug("Creating container", {
    sessionId,
    baseImage,
    minimalMode: MINIMAL_RESOURCE_MODE,
    memBytes,
    nanoCpus,
    pidsLimit: SANDBOX_PIDS_LIMIT,
    nofile: ULIMIT_NOFILE,
    nproc: ULIMIT_NPROC,
    aptCaps: ENABLE_APT_CAPS,
    readonly: HostConfig.ReadonlyRootfs,
  });

  let container;
  try {
    container = await docker.createContainer(createOpts);
  } catch (e) {
    // Provide clearer error if image isn't permitted
    if (!imageAllowed(baseImage)) {
      throw new Error(`Refused to create container: image "${baseImage}" is not in allowlist.`);
    }
    throw e;
  }

  try {
    await container.start();
  } catch (err) {
    // Cleanup dangling container on start failure
    try { await container.remove({ force: true }); } catch {}
    throw err;
  }

  // Ensure workspace dir exists (when not host-mounting)
  if (!USE_HOST_WORKSPACE) {
    try {
      await execCapture(container, `bash -lc 'mkdir -p "${escapeBash(WORKSPACE_PATH)}"'`);
    } catch {}
  }

  // Create an interactive bash exec
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

/* ---------- Helper exec (capture stdout/stderr as string) ---------- */
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
      stream.on("data", (d) => { data += d.toString("utf8"); });
      stream.on("error", reject);
      stream.on("end", () => resolve(data));
    });
  });
}

/* ---------- Resize TTY ---------- */
export async function resizeExecTTY(container, exec, { cols, rows }) {
  try {
    await docker.modem.post(
      { path: `/exec/${exec.id}/resize`, method: "POST", options: { h: rows, w: cols } },
      () => {}
    );
  } catch {}
}

/* ---------- Stop & Remove Container ---------- */
export async function stopAndRemoveContainer(container) {
  try {
    await container.stop({ t: 1 }).catch(() => {});
    const info = await container.inspect().catch(() => null);
    if (info && !info.HostConfig.AutoRemove) {
      await container.remove({ force: true }).catch(() => {});
    }
  } catch {}
}

/* ---------- Workspace Cleanup ---------- */
export async function removeWorkspaceDir(sessionId) {
  if (!USE_HOST_WORKSPACE) return;
  try {
    await fs.rm(sessionWorkspaceDir(sessionId), { recursive: true, force: true });
  } catch {}
}

/* ---------- Stats Stream ---------- */
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

/* ---------- Utilities ---------- */
export function randomId(bytes = 8) {
  return crypto.randomBytes(bytes).toString("hex");
}

function escapeBash(p) {
  return p.replace(/(["`$\\])/g, "\\$1");
}
