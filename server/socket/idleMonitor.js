import { SESSION_IDLE_MAX_MS, SESSION_IDLE_PING_TIMEOUT_MS, _safePingMs } from "./config.js";
import { forEachSession, setSessionPingSent } from "../sessionManager.js";

let _idleMonitorStarted = false;
export function startIdleMonitor(io) {
  if (_idleMonitorStarted) return;
  _idleMonitorStarted = true;
  setInterval(() => {
    const now = Date.now();
    forEachSession((socketId, sess) => {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) return;

      const idleFor = now - (sess.lastActivity || sess.createdAt || now);
      if (idleFor >= SESSION_IDLE_MAX_MS) {
        socket.emit("terminal:data", `\n[session] idle ${Math.round(idleFor/1000)}s >= ${Math.round(SESSION_IDLE_MAX_MS/1000)}s – terminating\n`);
        try { sess.terminate(); } catch {}
        return;
      }
      if (idleFor >= _safePingMs) {
        if (sess.pingSentAt) {
          const sincePing = now - sess.pingSentAt;
          if (sincePing >= SESSION_IDLE_PING_TIMEOUT_MS) {
            socket.emit("terminal:data", `[session] no pong within ${(SESSION_IDLE_PING_TIMEOUT_MS/1000)}s – terminating\n`);
            try { sess.terminate(); } catch {}
          }
          return;
        }
        setSessionPingSent(sess);
        socket.emit("session:ping", {
          idleSeconds: Math.round(idleFor / 1000),
          willTerminateAfterSeconds: Math.round((SESSION_IDLE_MAX_MS - idleFor) / 1000),
        });
        socket.emit("terminal:data",
          `[session] ping at ${Math.round(idleFor/1000)}s idle; terminate in ${Math.round((SESSION_IDLE_MAX_MS - idleFor)/1000)}s if no activity\n`);
      }
    });
  }, 5000);
}
