import { getSession } from "../sessionManager.js";
import { validateRequest, statsSubscribeSchema, statsUnsubscribeSchema, verifySessionToken } from "../security.js";
import { startStatsStream } from "../containerManager/index.js";
import { SERVER_INSTANCE_SECRET } from "./config.js";

export function registerStatsHandlers(socket) {
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

  wrap("stats:subscribe", statsSubscribeSchema, (p) => {
    const sess = getSession(socket.id);
    if (!sess || sess.closed) return;
    if (!verifySessionToken(SERVER_INSTANCE_SECRET, p.token, sess.sessionId, socket.id)) return;
    if (sess.stopStats) return;
    const stop = startStatsStream(
      sess,
      (stat) => {
        if (sess.closed) return;
        sess.lastStat = stat;
        socket.emit("stats:tick", stat);
      },
      () => {}
    );
    sess.stopStats = stop;
  });

  wrap("stats:unsubscribe", statsUnsubscribeSchema, (p) => {
    const sess = getSession(socket.id);
    if (!sess || sess.closed) return;
    if (!verifySessionToken(SERVER_INSTANCE_SECRET, p.token, sess.sessionId, socket.id)) return;
    if (sess.stopStats) {
      try { sess.stopStats(); } catch {}
      sess.stopStats = null;
    }
  });
}
