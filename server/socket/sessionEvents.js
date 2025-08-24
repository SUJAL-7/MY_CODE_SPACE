import { getSession, markSessionActivity } from "../sessionManager.js";
import { SESSION_GRACE_PERIOD_MS } from "./config.js";

export function registerSessionEvents(socket) {
  socket.onAny((eventName) => {
    if (
      eventName === "session:ping" ||
      eventName === "session:pong" ||
      eventName.startsWith("stats:") ||
      eventName === "terminal:data"
    ) return;
    const sess = getSession(socket.id);
    if (sess) markSessionActivity(sess);
  });

  socket.on("session:pong", () => {
    const sess = getSession(socket.id);
    if (sess) {
      markSessionActivity(sess);
      socket.emit("terminal:data", "[session] pong received, session extended\n");
    }
  });

  socket.on("disconnect", async () => {
    const sess = getSession(socket.id);
    if (sess && !sess.closed && !sess.disconnectTimer) {
      sess.disconnectTimer = setTimeout(async () => {
        if (!sess.closed) {
          await sess.terminate();
        }
      }, SESSION_GRACE_PERIOD_MS);
    }
  });
}
