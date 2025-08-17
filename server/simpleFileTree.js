// Minimal robust snapshot file tree.
// Contract: fs:treeSimple { version, tree, changed, reason }
// Directory => {}
// File => null
//
// Features:
// - Warmup multi-scan (captures early files)
// - Two-phase scan (dirs then files) so empty dirs are never mis-labeled
// - Null-delimited output; sanitizes control chars
// - Emits first non-empty snapshot even if hash same
//
// Environment (optional):
//   SIMPLE_TREE_SCAN_MS (default 2000)
//   SIMPLE_TREE_WARMUP_SCANS (default 3)
//   SIMPLE_TREE_WARMUP_INTERVAL_MS (default 250)
//   DEBUG_SANDBOX=1 for logging

const WORKSPACE_ROOT = "/workspace";
const SCAN_MS = intEnv("SIMPLE_TREE_SCAN_MS", 2000);
const WARMUP_SCANS = intEnv("SIMPLE_TREE_WARMUP_SCANS", 3);
const WARMUP_INTERVAL = intEnv("SIMPLE_TREE_WARMUP_INTERVAL_MS", 250);
const DEBUG = process.env.DEBUG_SANDBOX === "1";

export async function initSimpleTree(session, socket) {
  if (session.simpleTree) {
    emitSnapshot(session, socket, false, "reconnect");
    return;
  }
  session.simpleTree = {
    version: 0,
    tree: {},
    lastHash: "",
    emittedNonEmpty: false,
    disposed: false,
    loopTimer: null
  };
  await warmup(session, socket);
  if (!session.simpleTree?.disposed) startLoop(session, socket);
}

export function destroySimpleTree(session) {
  if (!session.simpleTree) return;
  if (session.simpleTree.loopTimer) clearTimeout(session.simpleTree.loopTimer);
  session.simpleTree.disposed = true;
  session.simpleTree = null;
}

export async function resyncSimpleTree(session, socket) {
  if (!session.simpleTree) {
    await initSimpleTree(session, socket);
    return;
  }
  await rebuild(session, socket, "manual-resync", { forceEmit: true });
}

// ---- Warmup ----
async function warmup(session, socket) {
  if (!session.simpleTree) return;
  for (let i = 0; i < WARMUP_SCANS; i++) {
    await rebuild(session, socket, `warmup#${i + 1}`, { forceEmit: true });
    if (session.simpleTree?.disposed) return;
    await delay(WARMUP_INTERVAL);
  }
  if (!session.simpleTree.emittedNonEmpty) {
    await rebuild(session, socket, "post-warmup-force", { forceEmit: true });
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- Rebuild ----
async function rebuild(session, socket, reason, opts = {}) {
  if (!session.simpleTree || session.simpleTree.disposed) return;
  const { forceEmit = false } = opts;

  let tree;
  try {
    tree = await buildTree(session.container);
  } catch (e) {
    console.warn("[simpleFS] scan error:", e.message);
    return;
  }

  const isEmpty = Object.keys(tree).length === 0;
  const hash = hashTree(tree);
  const changed = hash !== session.simpleTree.lastHash;
  const shouldEmit =
    forceEmit ||
    changed ||
    (!session.simpleTree.emittedNonEmpty && !isEmpty);

  if (shouldEmit) {
    session.simpleTree.tree = tree;
    session.simpleTree.version += 1;
    session.simpleTree.lastHash = hash;
    if (!isEmpty) session.simpleTree.emittedNonEmpty = true;
    emitSnapshot(session, socket, changed, reason);
    DEBUG && console.log(`[simpleFS] emit v${session.simpleTree.version} reason=${reason} changed=${changed} empty=${isEmpty} entries=${Object.keys(tree).length}`);
  } else {
    DEBUG && console.log(`[simpleFS] skip reason=${reason} changed=${changed} empty=${isEmpty}`);
  }
}

function emitSnapshot(session, socket, changed, reason) {
  if (!session.simpleTree) return;
  socket.emit("fs:treeSimple", {
    version: session.simpleTree.version,
    tree: session.simpleTree.tree,
    changed,
    reason
  });
}

// ---- Periodic loop ----
function startLoop(session, socket) {
  const loop = async () => {
    if (!session.simpleTree || session.simpleTree.disposed) return;
    await rebuild(session, socket, "periodic");
    if (session.simpleTree && !session.simpleTree.disposed) {
      session.simpleTree.loopTimer = setTimeout(loop, SCAN_MS);
    }
  };
  session.simpleTree.loopTimer = setTimeout(loop, SCAN_MS);
}

// ---- Build Tree (two-phase, sanitized) ----
async function buildTree(container) {
  const cmd = `
set -e
# Directories first (null-delimited)
find ${WORKSPACE_ROOT} -type d -mindepth 1 -printf '%P\\0'
printf '\\n'
# Files
find ${WORKSPACE_ROOT} -type f -mindepth 1 -printf '%P\\0'
`;
  const out = await exec(container, cmd);

  const splitAt = out.indexOf("\n");
  let dirSegment = out;
  let fileSegment = "";
  if (splitAt !== -1) {
    dirSegment = out.slice(0, splitAt);
    fileSegment = out.slice(splitAt + 1);
  }

  const sanitize = s =>
    s.replace(/[\x00-\x1F\x7F]/g, "").replace(/\/{2,}/g, "/").trim();

  const dirs = dirSegment.split("\0").filter(Boolean).map(sanitize).filter(Boolean);
  const files = fileSegment.split("\0").filter(Boolean).map(sanitize).filter(Boolean);

  dirs.sort();
  files.sort();

  const tree = {};

  function ensureDir(parts) {
    let cur = tree;
    for (const part of parts) {
      if (!part) continue;
      if (!(part in cur) || cur[part] === null) cur[part] = {};
      cur = cur[part];
    }
    return cur;
  }

  // Phase 1: dirs
  for (const d of dirs) {
    const parts = d.split("/").filter(Boolean);
    if (parts.length) ensureDir(parts);
  }

  // Phase 2: files
  for (const f of files) {
    const parts = f.split("/").filter(Boolean);
    if (!parts.length) continue;
    const dirParts = parts.slice(0, -1);
    const leaf = parts[parts.length - 1];
    const parent = ensureDir(dirParts);
    if (!(leaf in parent)) parent[leaf] = null;
    // if already a dir with same name, keep dir
  }

  return tree;
}

// ---- Hash (stable FNV-1a) ----
function hashTree(tree) {
  let h = 2166136261 >>> 0;
  (function walk(node, base) {
    const keys = Object.keys(node).sort();
    for (const k of keys) {
      const path = base ? `${base}/${k}` : k;
      const marker = node[k] === null ? ":F" : ":D";
      const line = path + marker;
      for (let i = 0; i < line.length; i++) {
        h ^= line.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      if (node[k] && typeof node[k] === "object") walk(node[k], path);
    }
  })(tree, "");
  return h.toString(36);
}

// ---- Exec helper ----
function exec(container, cmd) {
  return new Promise((resolve, reject) => {
    container.exec(
      {
        Cmd: ["bash", "-lc", cmd],
        AttachStdout: true,
        AttachStderr: true,
        Tty: false
      },
      (err, execObj) => {
        if (err) return reject(err);
        execObj.start((err2, stream) => {
          if (err2) return reject(err2);
          let out = "";
          stream.on("data", d => (out += d.toString("utf8")));
          stream.on("error", reject);
          stream.on("end", () => resolve(out));
        });
      }
    );
  });
}

function intEnv(key, def) {
  const raw = process.env[key];
  if (!raw) return def;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
}