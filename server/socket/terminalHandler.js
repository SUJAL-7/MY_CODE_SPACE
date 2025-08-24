import { getSession } from "../sessionManager.js";
import { validateRequest, inputSchema, resizeSchema, killSchema, verifySessionToken } from "../security.js";
import { refillTokens, now } from "./utils.js";
import { resizeExecTTY } from "../containerManager/index.js";
import { SERVER_INSTANCE_SECRET } from "./config.js";

export function registerTerminalHandlers(socket) {
  function wrap(event, schema, handler) {
    socket.on(event, (raw) => {
      try {
        if (!raw || typeof raw !== "object") throw new Error("Payload missing");
        const p = validateRequest(schema, raw);
        handler(p);
      } catch (e) {
        socket.emit("terminal:data", `\r\n[invalid ${event}] ${e.message}\r\n`);
      }
    });
  }

  wrap("terminal:input", inputSchema, (p) => {
    const sess = getSession(socket.id);
    if (!sess || sess.closed) return;
    if (!verifySessionToken(SERVER_INSTANCE_SECRET, p.token, sess.sessionId, socket.id)) return;
    if (p.sessionId !== sess.sessionId) return;
    sess.lastActivity = now();
    refillTokens(sess);
    const bytes = Buffer.byteLength(p.data);
    if (sess.inputTokens < bytes) {
      socket.emit("terminal:data", "\r\n[input throttled]\r\n");
      return;
    }
    sess.inputTokens -= bytes;
    try { sess.stream.write(p.data); } catch {}
  });

  wrap("terminal:resize", resizeSchema, (p) => {
    const sess = getSession(socket.id);
    if (!sess || sess.closed) return;
    if (!verifySessionToken(SERVER_INSTANCE_SECRET, p.token, sess.sessionId, socket.id)) return;
    resizeExecTTY(sess.container, sess.exec, { cols: p.cols, rows: p.rows });
  });

  wrap("terminal:kill", killSchema, (p) => {
    const sess = getSession(socket.id);
    if (!sess || sess.closed) return;
    if (!verifySessionToken(SERVER_INSTANCE_SECRET, p.token, sess.sessionId, socket.id)) return;
    sess.terminate();
  });
}
