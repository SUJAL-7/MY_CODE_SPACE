// Enhanced filesystem socket helpers with requestId generation & debug logs.

let _fsReqCounter = 0;
function nextReqId(prefix) {
  _fsReqCounter = (_fsReqCounter + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${_fsReqCounter}`;
}

export function registerFsHandlers(socket, {
  onListResult,
  onReadResult,
  onWriteResult,
  onCreateDirResult,
  onDeleteResult,
  onRenameResult,
  onFsError,
  onDelta,
}) {
  if (onListResult) socket.on("fs:listResult", onListResult);
  if (onReadResult) socket.on("fs:readResult", onReadResult);
  if (onWriteResult) socket.on("fs:writeResult", onWriteResult);
  if (onCreateDirResult) socket.on("fs:createDirResult", onCreateDirResult);
  if (onDeleteResult) socket.on("fs:deleteResult", onDeleteResult);
  if (onRenameResult) socket.on("fs:renameResult", onRenameResult);
  if (onFsError) socket.on("fs:error", onFsError);
  if (onDelta) socket.on("fs:delta", onDelta);
}

export function unregisterFsHandlers(socket, handlers) {
  if (!socket) return;
  const {
    onListResult,
    onReadResult,
    onWriteResult,
    onCreateDirResult,
    onDeleteResult,
    onRenameResult,
    onFsError,
    onDelta,
  } = handlers || {};
  if (onListResult) socket.off("fs:listResult", onListResult);
  if (onReadResult) socket.off("fs:readResult", onReadResult);
  if (onWriteResult) socket.off("fs:writeResult", onWriteResult);
  if (onCreateDirResult) socket.off("fs:createDirResult", onCreateDirResult);
  if (onDeleteResult) socket.off("fs:deleteResult", onDeleteResult);
  if (onRenameResult) socket.off("fs:renameResult", onRenameResult);
  if (onFsError) socket.off("fs:error", onFsError);
  if (onDelta) socket.off("fs:delta", onDelta);
}

function emit(socket, event, payload) {
  // Basic debug (suppress noisy content bodies)
  const dbg = { ...payload };
  if (typeof dbg.content === "string" && dbg.content.length > 64) {
    dbg.content = dbg.content.slice(0, 64) + "...";
  }
  // console.log("[FS EMIT]", event, dbg);
  socket.emit(event, payload);
}

export function listDirectory(socket, { sessionId, token, path = ".", requestId }) {
  const reqId = requestId || nextReqId("ls");
  emit(socket, "fs:list", { sessionId, token, path, requestId: reqId });
  return reqId;
}

export function readFile(socket, { sessionId, token, path, requestId }) {
  const reqId = requestId || nextReqId("read");
  emit(socket, "fs:read", { sessionId, token, path, requestId: reqId });
  return reqId;
}

export function writeFile(socket, { sessionId, token, path, content, requestId }) {
  const reqId = requestId || nextReqId("write");
  emit(socket, "fs:write", { sessionId, token, path, content, requestId: reqId });
  return reqId;
}

export function createDirectory(socket, { sessionId, token, path, requestId }) {
  const reqId = requestId || nextReqId("mkdir");
  emit(socket, "fs:createDir", { sessionId, token, path, requestId: reqId });
  return reqId;
}

export function deleteEntry(socket, { sessionId, token, path, requestId }) {
  const reqId = requestId || nextReqId("rm");
  emit(socket, "fs:delete", { sessionId, token, path, requestId: reqId });
  return reqId;
}

export function renameEntry(socket, { sessionId, token, from, to, requestId }) {
  const reqId = requestId || nextReqId("mv");
  emit(socket, "fs:rename", { sessionId, token, from, to, requestId: reqId });
  return reqId;
}