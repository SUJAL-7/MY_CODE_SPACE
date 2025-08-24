// const { emitSnapshot, warmup, startLoop, rebuild } = require("./rebuild");
import { emitSnapshot, warmup, startLoop, rebuild } from "./rebuild.js";

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
    failed: false,
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

