import { getSession } from "../sessionManager.js";
import { readFile, writeFile, createDirectory, deleteEntry, renameEntry } from "../filesystem/index.js";
import { resyncSimpleTree } from "../fileTree/index.js";
import { randomToken } from "./utils.js";
import { SERVER_INSTANCE_SECRET } from "./config.js";
import { verifySessionToken } from "../security.js";

const downloadTokenMap = new Map();

function validateSession(socket, payload) {
  const sess = getSession(socket.id);
  if (!sess || sess.closed) throw new Error("Session not found");
  if (!verifySessionToken(SERVER_INSTANCE_SECRET, payload.token, sess.sessionId, socket.id))
    throw new Error("Bad token");
  if (payload.sessionId !== sess.sessionId) throw new Error("Session mismatch");
  return sess;
}

export function registerFsHandlers(socket) {
  socket.on("fs:read", async (payload) => {
    try {
      const sess = validateSession(socket, payload);
      const rel = (payload.path || "").replace(/\\/g, "/").replace(/^\//, "");
      const data = await readFile(sess.container, rel);
      socket.emit("fs:readResult", { requestId: payload.requestId, ...data });
    } catch (e) {
      socket.emit("fs:error", { requestId: payload.requestId, op: "read", message: e.message });
    }
  });

  // write, createDir, delete, rename handlers (same as original)

  socket.on("fs:downloadToken", (payload) => {
    try {
      const sess = validateSession(socket, payload);
      const rel = (payload.path || "").replace(/\\/g, "/").replace(/^\//, "");
      const token = randomToken();
      downloadTokenMap.set(token, {
        container: sess.container,
        relPath: rel,
        expires: Date.now() + 60_000,
      });
      socket.emit("fs:downloadTokenResult", { requestId: payload.requestId, token });
    } catch (e) {
      socket.emit("fs:error", { requestId: payload.requestId, op: "downloadToken", message: e.message });
    }
  });

  socket.on("fs:treeSimple:resync", () => {
    const sess = getSession(socket.id);
    if (!sess || sess.closed) return;
    resyncSimpleTree(sess, socket);
  });
}
