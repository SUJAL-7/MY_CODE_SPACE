import fs from "fs/promises";
import fsSync from "fs";
import {
  FORCED_BASE_IMAGE, SANDBOX_AUTOREMOVE, NETWORK_MODE, READONLY_ROOT,
  RETAIN_CAP_DROP_ALL, ALLOWED_EXTRA_CAPS, SANDBOX_PIDS_LIMIT,
  ULIMIT_NOFILE, ULIMIT_NPROC, SANDBOX_RUNTIME, BLKIO_READ_BPS, BLKIO_WRITE_BPS,
  BLKIO_READ_IOPS, BLKIO_WRITE_IOPS, UID, GID, USE_HOST_WORKSPACE,
  WORKSPACE_PATH, ENABLE_APT_CAPS, SANDBOX_TMPFS, MINIMAL_RESOURCE_MODE,
  SANDBOX_MEMORY, SANDBOX_CPUS
} from "./config.js";
import { docker } from "./docker.js";
import { pullImageIfNeeded } from "./pullImage.js";
import {
  logDebug, imageAllowed, sessionWorkspaceDir, parseMemory,
  parseCPUs, escapeBash
} from "./utils.js";

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

// keep execCapture inside here
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
