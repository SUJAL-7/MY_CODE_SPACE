// Simple file tree with debounced nudges to show empty directories quickly.
//
// Additions:
// - Debounce logic inside nudgeSimpleTree (NudgeDelay).
// - Optional immediate micro-delay after a nudge is scheduled.
// - Safe guard against overlapping rebuilds.
// - Emits after FS mutations almost immediately, making empty folders appear reliably.

const WORKSPACE_ROOT = "/workspace";
const SCAN_MS = intEnv("SIMPLE_TREE_SCAN_MS", 2000);
const WARMUP_SCANS = intEnv("SIMPLE_TREE_WARMUP_SCANS", 3);
const WARMUP_INTERVAL = intEnv("SIMPLE_TREE_WARMUP_INTERVAL_MS", 250);
const DEDUP_CHARS = process.env.SIMPLE_TREE_DEDUP_LEADING_CHARS || "";
const DEBUG = process.env.DEBUG_SANDBOX === "1";

// Debounce settings for nudges
const NUDGE_MIN_DELAY_MS = intEnv("SIMPLE_TREE_NUDGE_DELAY_MS", 120);
const NUDGE_MAX_WAIT_MS = intEnv("SIMPLE_TREE_NUDGE_MAX_WAIT_MS", 600);

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
    failed: false, // <--- NEW
    loopTimer: null,
    nudgeTimer: null,
    firstNudgeAt: 0,
    rebuildInFlight: false,
  };
  await warmup(session, socket);
  if (!session.simpleTree?.disposed) startLoop(session, socket);
}

export function destroySimpleTree(session) {
  if (!session.simpleTree) return;
  if (session.simpleTree.loopTimer) clearTimeout(session.simpleTree.loopTimer);
  if (session.simpleTree.nudgeTimer) clearTimeout(session.simpleTree.nudgeTimer);
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

export async function nudgeSimpleTree(session, socket, reason = "nudge") {
  const st = session.simpleTree;
  if (!st || st.disposed || st.failed) return; 

  // If a rebuild currently running, schedule a future pass.
  if (st.rebuildInFlight) {
    if (DEBUG) console.log("[simpleFS] nudge ignored (in-flight rebuild)");
    scheduleDebouncedNudge(session, socket, reason);
    return;
  }

  scheduleDebouncedNudge(session, socket, reason);
}

function scheduleDebouncedNudge(session, socket, reason) {
  const st = session.simpleTree;
  if (!st || st.disposed) return;

  const nowTs = Date.now();
  if (!st.firstNudgeAt) st.firstNudgeAt = nowTs;

  const elapsed = nowTs - st.firstNudgeAt;
  const delay = elapsed >= NUDGE_MAX_WAIT_MS ? 0 : NUDGE_MIN_DELAY_MS;

  if (st.nudgeTimer) clearTimeout(st.nudgeTimer);
  st.nudgeTimer = setTimeout(() => {
    st.nudgeTimer = null;
    st.firstNudgeAt = 0;
    rebuild(session, socket, `debounced-${reason}`, { forceEmit: true }).catch(() => {});
  }, delay);
}

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

async function rebuild(session, socket, reason, opts = {}) {
  const st = session.simpleTree;
  if (!st || st.disposed) return;
  if (st.rebuildInFlight) return; // soft skip; nudge mechanism will handle extras
  st.rebuildInFlight = true;

  const { forceEmit = false } = opts;
  let tree;
  try {
    tree = await buildTree(session.container);
  } catch (e) {
    if (e.message.includes("No such container") || e.message.includes("not found")) {
      st.failed = true;
      clearTimeout(st.loopTimer);
      clearTimeout(st.nudgeTimer);
      st.loopTimer = null;
      st.nudgeTimer = null;
      console.error("[simpleFS] container unavailable — stopping nudges for this session");
    }
    st.rebuildInFlight = false;
    return;
  }

  const isEmpty = Object.keys(tree).length === 0;
  const hash = hashTree(tree);
  const changed = hash !== st.lastHash;
  const shouldEmit = forceEmit || changed || (!st.emittedNonEmpty && !isEmpty);

  if (shouldEmit) {
    st.tree = tree;
    st.version += 1;
    st.lastHash = hash;
    if (!isEmpty) st.emittedNonEmpty = true;
    emitSnapshot(session, socket, changed, reason);
    DEBUG && console.log(
      `[simpleFS] emit v${st.version} reason=${reason} changed=${changed} empty=${isEmpty} entries=${Object.keys(tree).length}`
    );
  } else {
    DEBUG && console.log(
      `[simpleFS] skip reason=${reason} changed=${changed} empty=${isEmpty}`
    );
  }

  st.rebuildInFlight = false;
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

function startLoop(session, socket) {
  const loop = async () => {
    if (!session.simpleTree || session.simpleTree.disposed || session.simpleTree.failed) return;
    await rebuild(session, socket, "periodic");
    if (session.simpleTree && !session.simpleTree.disposed) {
      session.simpleTree.loopTimer = setTimeout(loop, SCAN_MS);
    }
  };
  session.simpleTree.loopTimer = setTimeout(loop, SCAN_MS);
}

async function buildTree(container) {
  // Unified find for files & dirs (including hidden)
  const cmd = `
set -e
find ${WORKSPACE_ROOT} -mindepth 1 -printf '%y|%P\\0'
`.trim();

  const out = await exec(container, cmd);

  const sanitize = s =>
    s.replace(/[\x00-\x1F\x7F]/g, "")
      .replace(/\\/g, "/")
      .replace(/\/{2,}/g, "/")
      .trim();

  const records = out.split("\0").filter(Boolean).map(r => sanitize(r));
  const dirs = [];
  const files = [];

  for (const rec of records) {
    const idx = rec.indexOf("|");
    if (idx === -1) continue;
    const typeChar = rec.slice(0, idx);
    let rel = rec.slice(idx + 1);
    if (!rel || rel === ".") continue;
    if (rel.startsWith("/")) rel = rel.slice(1);
    if (!rel) continue;
    if (typeChar === "d") dirs.push(rel);
    else if (typeChar === "f") files.push(rel);
  }

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

  for (const d of dirs) {
    const parts = d.split("/").filter(Boolean);
    if (parts.length) ensureDir(parts);
  }

  for (const f of files) {
    const parts = f.split("/").filter(Boolean);
    if (!parts.length) continue;
    const dirParts = parts.slice(0, -1);
    const leaf = parts[parts.length - 1];
    const parent = ensureDir(dirParts);
    if (!(leaf in parent)) parent[leaf] = null;
    else if (parent[leaf] && typeof parent[leaf] === "object" && Object.keys(parent[leaf]).length === 0) {
      parent[leaf] = null;
    }
  }

  if (DEDUP_CHARS) {
    dedupLeadingCharSiblings(tree, DEDUP_CHARS);
  }

  return tree;
}

function dedupLeadingCharSiblings(node, chars) {
  if (!node || typeof node !== "object") return;
  const names = Object.keys(node);
  for (const name of names) {
    const val = node[name];
    if (val && typeof val === "object") dedupLeadingCharSiblings(val, chars);
  }
  for (const ch of chars) {
    for (const name of names) {
      if (!name.startsWith(ch)) continue;
      const base = name.slice(1);
      if (!base) continue;
      if (Object.prototype.hasOwnProperty.call(node, base) &&
          Object.prototype.hasOwnProperty.call(node, name)) {
        const prefixed = node[name];
        const baseNode = node[base];
        const prefEmpty = prefixed && typeof prefixed === "object" && Object.keys(prefixed).length === 0;
        const baseEmpty = baseNode && typeof baseNode === "object" && Object.keys(baseNode).length === 0;
        if (prefEmpty && !baseEmpty) {
          delete node[name];
        }
      }
    }
  }
}

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