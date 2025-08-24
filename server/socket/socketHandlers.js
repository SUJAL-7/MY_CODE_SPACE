import { DEBUG_SANDBOX, MAX_IDLE_MINUTES } from "./config.js";
import { now } from "./utils.js";
import { forEachSession, destroySession } from "../sessionManager.js";
import { registerWorkspaceHandler } from "./workspaceHandler.js";
import { registerTerminalHandlers } from "./terminalHandler.js";
import { registerStatsHandlers } from "./statsHandler.js";
import { registerFsHandlers } from "./fsHandler.js";
import { registerSessionEvents } from "./sessionEvents.js";
import { startIdleMonitor } from "./idleMonitor.js";

export function setupSocketHandlers(io) {
  io.on("connection", (socket) => {
    if (DEBUG_SANDBOX) console.log("[socket] connect", socket.id);

    registerWorkspaceHandler(socket);
    registerTerminalHandlers(socket);
    registerStatsHandlers(socket);
    registerFsHandlers(socket);
    registerSessionEvents(socket);
  });

  // idle cleanup
  const MAX_IDLE_MS = MAX_IDLE_MINUTES * 60 * 1000;
  setInterval(async () => {
    const cutoff = now() - MAX_IDLE_MS;

    await forEachSession(async (session) => {
      if (session.lastActivity && session.lastActivity < cutoff) {
        if (DEBUG_SANDBOX) {
          console.log(
            `[idle monitor] Destroying idle session: ${session.sessionId}`
          );
        }
        await destroySession(session.sessionId);
      }
    });
  }, 60 * 1000); // check every 1 minute

  // optional: background monitor (if more detailed monitoring is needed)
  startIdleMonitor();
}
