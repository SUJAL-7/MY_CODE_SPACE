import path from "path";

const SENTINEL = "__FSE__";
const WORKSPACE_ROOT = "/workspace";
const POLL_INTERVAL_MS = parseInt(process.env.FILE_TREE_POLL_INTERVAL_MS || "5000", 10);
const DEBUG = process.env.DEBUG_SANDBOX === "1";

export async function initFileTree(session, socket) {
  if (session.fileTreeState) {
    emitSnapshot(session, socket);
    return;
  }
  session.fileTreeState = {
    version: 0,
    nodes: new Map(),
    pollTimer: null,
    watcherActive: false,
    watcherStarted: false,
  };

  try {
    await fullScan(session);
    emitSnapshot(session, socket);
    await startRealtime(session, socket);
    // NEW: schedule reconciliation after watcher starts to catch race
    scheduleReconcile(session, socket);
  } catch (e) {
    console.error("[fileTree] initial scan failed:", e.message);
    emitSnapshot(session, socket);
    startPolling(session, socket);
  }
}

export function destroyFileTree(session) {
  const st = session.fileTreeState;
  if (!st) return;
  if (st.pollTimer) clearTimeout(st.pollTimer);
  session.fileTreeState = null;
}

/* ---------------- Scans ---------------- */

async function fullScan(session) {
  const raw = await execInContainer(session.container, `
set -e
find ${WORKSPACE_ROOT} -type d -printf '${SENTINEL}|d|0|%T@|%P\\n'
find ${WORKSPACE_ROOT} -type f -printf '${SENTINEL}|f|%s|%T@|%P\\n'
`);
  const nodes = new Map();
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t.startsWith(SENTINEL + "|")) continue;
    const parts = t.split("|");
    if (parts.length !== 5) continue;
    const kind = parts[1]; // d | f
    const sizeStr = parts[2];
    const mtimeStr = parts[3];
    const rel = parts[4];
    if (rel === "") continue; // skip root itself
    const name = rel.split("/").pop();
    const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    const isDir = kind === "d";
    nodes.set(rel, {
      name,
      path: rel,
      parent,
      type: isDir ? "directory" : "file",
      isDir,
      size: Number(sizeStr) || 0,
      mtime: Math.round(parseFloat(mtimeStr) * 1000) || 0,
    });
  }
  session.fileTreeState.nodes = nodes;
  DEBUG && console.log("[fileTree] full scan complete; nodes=", nodes.size);
}

/* Reconciliation scan: diff a fresh scan with current in-memory nodes and emit missing adds */
async function reconcileScan(session, socket) {
  if (!session.fileTreeState) return;
  const beforeCount = session.fileTreeState.nodes.size;
  const tempSession = { container: session.container, fileTreeState: { nodes: new Map() } };
  await fullScan(tempSession); // fills tempSession.fileTreeState.nodes
  const current = session.fileTreeState.nodes;
  const fresh = tempSession.fileTreeState.nodes;
  const ops = [];

  // Additions
  for (const [p, node] of fresh.entries()) {
    if (!current.has(p)) {
      current.set(p, node);
      ops.push({ op: "add", node: exportNode(node) });
    }
  }
  // (We intentionally do NOT remove here; early reconciliation should only add missed items.)

  if (ops.length) {
    DEBUG && console.log("[fileTree] reconcile added", ops.length, "nodes (preWatcherCount=", beforeCount, ")");
    emitDelta(session, socket, ops);
  } else {
    DEBUG && console.log("[fileTree] reconcile found no new nodes");
  }
}

/* ---------------- Snapshot / Delta ---------------- */

function emitSnapshot(session, socket) {
  const st = session.fileTreeState;
  if (!st) return;
  const root = buildNested(st.nodes);
  // Normalize root
  const normalizedRoot = {
    path: "",
    name: "",
    type: "directory",
    isDir: true,
    entries: root.entries || [],
  };
  socket.emit("fs:treeInit", { version: st.version, root: normalizedRoot });
  DEBUG && console.log("[fileTree] emit snapshot v", st.version, "children:", normalizedRoot.entries.length);
}

function buildNested(nodes) {
  const children = new Map();
  for (const n of nodes.values()) {
    if (!children.has(n.parent)) children.set(n.parent, []);
    children.get(n.parent).push(n);
  }
  for (const arr of children.values()) {
    arr.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
  }
  function build(path) {
    const entries = (children.get(path) || []).map((n) => {
      if (n.isDir) {
        return {
          name: n.name,
          path: n.path,
          type: n.type,
          isDir: true,
          size: n.size,
          mtime: n.mtime,
          entries: build(n.path).entries,
        };
      }
      return {
        name: n.name,
        path: n.path,
        type: n.type,
        isDir: false,
        size: n.size,
        mtime: n.mtime,
      };
    });
    return { path, entries };
  }
  return build("");
}

function emitDelta(session, socket, ops) {
  if (!ops.length) return;
  const st = session.fileTreeState;
  if (!st) return;
  st.version += 1;
  socket.emit("fs:treeDelta", { version: st.version, ops });
  DEBUG && console.log("[fileTree] emit delta v", st.version, "ops:", ops.map(o => o.op + ":" + (o.node?.path || o.path)).join(","));
}

/* ---------------- Watcher ---------------- */

async function startRealtime(session, socket) {
  // Check inotifywait
  const which = await execInContainer(session.container, "which inotifywait || true");
  if (!which.includes("inotifywait")) {
    DEBUG && console.log("[fileTree] inotifywait absent; using polling fallback");
    startPolling(session, socket);
    return;
  }

  return new Promise((resolve) => {
    session.container.exec({
      Cmd: ["bash", "-lc", `
inotifywait -m -r -e create -e delete -e move -e modify --format '%e|%w|%f|%T' --timefmt '%s' ${WORKSPACE_ROOT}
`],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    }, (err, execObj) => {
      if (err) {
        DEBUG && console.log("[fileTree] watcher start failed:", err.message);
        startPolling(session, socket);
        resolve();
        return;
      }
      execObj.start((err2, stream) => {
        if (err2) {
          DEBUG && console.log("[fileTree] watcher stream failed:", err2.message);
          startPolling(session, socket);
          resolve();
          return;
        }
        session.fileTreeState.watcherActive = true;
        session.fileTreeState.watcherStarted = true;
        DEBUG && console.log("[fileTree] watcher started");
        stream.on("data", (d) => {
          for (const line of d.toString("utf8").split("\n")) {
            const t = line.trim();
            if (!t) continue;
            handleInotifyEvent(session, socket, t);
          }
        });
        stream.on("error", (e) => {
          DEBUG && console.log("[fileTree] watcher error:", e.message);
        });
        stream.on("end", () => {
          DEBUG && console.log("[fileTree] watcher ended; fallback polling");
          session.fileTreeState.watcherActive = false;
          startPolling(session, socket);
        });
        resolve();
      });
    });
  });
}

// NEW: schedule reconciliation after short delay
function scheduleReconcile(session, socket) {
  setTimeout(() => {
    if (!session.fileTreeState) return;
    reconcileScan(session, socket).catch(e =>
      console.warn("[fileTree] reconcile error:", e.message)
    );
  }, 400); // 400ms to allow user to create early files
}

function handleInotifyEvent(session, socket, line) {
  const st = session.fileTreeState;
  if (!st) return;

  const parts = line.split("|");
  if (parts.length < 4) return;
  const events = parts[0].split(",");
  const watched = parts[1];
  const fname = parts[2];
  const tsMs = Math.round(Number(parts[3]) * 1000) || Date.now();
  if (!fname) return;

  let relDir = watched.replace(/^\/workspace\/?/, "").replace(/\/$/, "");
  if (relDir === WORKSPACE_ROOT.replace("/", "")) relDir = "";
  const relPath = relDir ? `${relDir}/${fname}` : fname;

  const ops = [];
  const nodes = st.nodes;
  const needStat = events.some((e) => ["CREATE", "MOVED_TO", "MODIFY"].includes(e));

  if (events.includes("DELETE") || events.includes("MOVED_FROM")) {
    for (const k of Array.from(nodes.keys())) {
      if (k === relPath || k.startsWith(relPath + "/")) {
        nodes.delete(k);
        ops.push({ op: "remove", path: k });
      }
    }
  }

  if (needStat) {
    statNode(session, relPath)
      .then((node) => {
        if (!node) {
          if (ops.length) emitDelta(session, socket, ops);
          return;
        }
        const existing = nodes.get(relPath);
        if (!existing) {
          nodes.set(relPath, node);
          emitDelta(session, socket, [...ops, { op: "add", node: exportNode(node) }]);
        } else if (!node.isDir && (existing.size !== node.size || existing.mtime !== node.mtime)) {
          existing.size = node.size;
          existing.mtime = node.mtime;
          emitDelta(session, socket, [...ops, { op: "update", path: relPath, size: existing.size, mtime: existing.mtime }]);
        } else if (ops.length) {
          emitDelta(session, socket, ops);
        }
      })
      .catch(() => {
        if (ops.length) emitDelta(session, socket, ops);
      });
    return;
  }

  if (ops.length) emitDelta(session, socket, ops);
}

/* ---------------- Polling Fallback ---------------- */

function startPolling(session, socket) {
  const st = session.fileTreeState;
  if (!st) return;
  const tick = async () => {
    if (!session.fileTreeState) return;
    try {
      const prev = st.nodes;
      const raw = await execInContainer(session.container, `
set -e
find ${WORKSPACE_ROOT} -type d -printf '${SENTINEL}|d|0|%T@|%P\\n'
find ${WORKSPACE_ROOT} -type f -printf '${SENTINEL}|f|%s|%T@|%P\\n'
`);
      const fresh = new Map();
      const seen = new Set();

      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t.startsWith(SENTINEL + "|")) continue;
        const parts = t.split("|");
        if (parts.length !== 5) continue;
        const kind = parts[1];
        const sizeStr = parts[2];
        const mtStr = parts[3];
        const rel = parts[4];
        if (!rel) continue;
        seen.add(rel);
        const name = rel.split("/").pop();
        const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
        const isDir = kind === "d";
        const size = Number(sizeStr) || 0;
        const mtime = Math.round(parseFloat(mtStr) * 1000) || 0;
        fresh.set(rel, {
          name,
          path: rel,
          parent,
          type: isDir ? "directory" : "file",
          isDir,
          size,
          mtime,
        });
      }

      const ops = [];
      // additions / updates
      for (const [p, node] of fresh.entries()) {
        const existing = prev.get(p);
        if (!existing) {
          prev.set(p, node);
          ops.push({ op: "add", node: exportNode(node) });
        } else if (!node.isDir &&
          (existing.size !== node.size || existing.mtime !== node.mtime)) {
          existing.size = node.size;
          existing.mtime = node.mtime;
          ops.push({ op: "update", path: p, size: existing.size, mtime: existing.mtime });
        }
      }
      // deletions
      for (const k of Array.from(prev.keys())) {
        if (!fresh.has(k)) {
          prev.delete(k);
          ops.push({ op: "remove", path: k });
        }
      }
      if (ops.length) emitDelta(session, socket, ops);
    } catch (e) {
      DEBUG && console.warn("[fileTree] polling error:", e.message);
    } finally {
      if (session.fileTreeState) {
        session.fileTreeState.pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    }
  };
  tick();
}

/* ---------------- Helpers ---------------- */

function exportNode(node) {
  return {
    name: node.name,
    path: node.path,
    type: node.type,
    isDir: node.isDir,
    size: node.size,
    mtime: node.mtime,
  };
}

async function statNode(session, relPath) {
  const esc = relPath.replace(/(["`$\\])/g, "\\$1");
  const raw = await execInContainer(session.container, `
if [ -d "${WORKSPACE_ROOT}/${esc}" ]; then
  printf "d|0|%s\\n" "$(stat -c %Y "${WORKSPACE_ROOT}/${esc}" 2>/dev/null || echo 0)";
elif [ -f "${WORKSPACE_ROOT}/${esc}" ]; then
  printf "f|%s|%s\\n" "$(stat -c %s "${WORKSPACE_ROOT}/${esc}" 2>/dev/null || echo 0)" "$(stat -c %Y "${WORKSPACE_ROOT}/${esc}" 2>/dev/null || echo 0)";
else
  printf "x|0|0\\n";
fi
`);
  const line = raw.trim();
  const [kind, sizeStr, mtStr] = line.split("|");
  if (kind === "x") return null;
  const name = relPath.split("/").pop();
  const parent = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
  const isDir = kind === "d";
  return {
    name,
    path: relPath,
    parent,
    type: isDir ? "directory" : "file",
    isDir,
    size: Number(sizeStr) || 0,
    mtime: Math.round(Number(mtStr) * 1000) || Date.now(),
  };
}

function execInContainer(container, cmd) {
  return new Promise((resolve, reject) => {
    container.exec({
      Cmd: ["bash", "-lc", cmd],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    }, (err, execObj) => {
      if (err) return reject(err);
      execObj.start((err2, stream) => {
        if (err2) return reject(err2);
        let out = "";
        stream.on("data", (d) => (out += d.toString("utf8")));
        stream.on("error", reject);
        stream.on("end", () => resolve(out));
      });
    });
  });
}

export async function resyncFileTree(session, socket) {
  if (!session.fileTreeState) {
    await initFileTree(session, socket);
    return;
  }
  await fullScan(session);
  emitSnapshot(session, socket);
  // Also schedule a reconcile a short time later to catch any race during the rescan
  scheduleReconcile(session, socket);
}