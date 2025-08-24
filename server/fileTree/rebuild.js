// const { DEBUG, SCAN_MS, WARMUP_SCANS, WARMUP_INTERVAL } = require("./constants");
// const { delay } = require("./utils");
// const { buildTree } = require("./buildTree");
// const { hashTree } = require("./hashTree");
import { DEBUG, SCAN_MS, WARMUP_SCANS, WARMUP_INTERVAL } from "./constants.js";
import { delay } from "./utils.js";
import { buildTree } from "./buildTree.js";
import { hashTree } from "./hashTree.js";

export async function warmup(session, socket) {
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

export async function rebuild(session, socket, reason, opts = {}) {
  const st = session.simpleTree;
  if (!st || st.disposed) return;
  if (st.rebuildInFlight) return;
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
    DEBUG && console.log(`[simpleFS] skip reason=${reason} changed=${changed} empty=${isEmpty}`);
  }

  st.rebuildInFlight = false;
}

export function emitSnapshot(session, socket, changed, reason) {
  if (!session.simpleTree) return;
  socket.emit("fs:treeSimple", {
    version: session.simpleTree.version,
    tree: session.simpleTree.tree,
    changed,
    reason,
  });
}

export function startLoop(session, socket) {
  const loop = async () => {
    if (!session.simpleTree || session.simpleTree.disposed || session.simpleTree.failed) return;
    await rebuild(session, socket, "periodic");
    if (session.simpleTree && !session.simpleTree.disposed) {
      session.simpleTree.loopTimer = setTimeout(loop, SCAN_MS);
    }
  };
  session.simpleTree.loopTimer = setTimeout(loop, SCAN_MS);
}

// module.exports = { warmup, rebuild, emitSnapshot, startLoop };
