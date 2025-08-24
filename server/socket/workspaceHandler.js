import { v4 as uuidv4 } from "uuid";
import os from "os";
import {
  createSession,
  destroySession,
  findSessionBySessionId,
} from "../sessionManager.js";
import {
  createSessionExecShell,
  stopAndRemoveContainer,
  removeWorkspaceDir,
} from "../containerManager/index.js";
import {
  validateRequest,
  initSchema,
  sanitizeUsername,
  deriveSessionToken,
  verifySessionToken,
} from "../security.js";
import { attachResourceGuard, detachResourceGuard } from "../resourceGuard.js";
import { initSimpleTree, destroySimpleTree } from "../fileTree/index.js";
import { DEBUG_SANDBOX, SANDBOX_MODE, SERVER_INSTANCE_SECRET, SOCKET_INIT_RATE_WINDOW_MS, SOCKET_INIT_MAX, SESSION_GRACE_PERIOD_MS, MAX_IDLE_MINUTES } from "./config.js";
import { now } from "./utils.js";

const socketInitTracker = new Map();

export function registerWorkspaceHandler(socket) {
  socket.on("workspace:init", async (raw) => {
    if (SANDBOX_MODE !== "container") {
      socket.emit("workspace:error", "Sandbox mode disabled");
      return;
    }

    // per-socket rate limit
    const tracker = socketInitTracker.get(socket.id) || { count: 0, windowStart: now() };
    const elapsed = now() - tracker.windowStart;
    if (elapsed > SOCKET_INIT_RATE_WINDOW_MS) {
      tracker.count = 0;
      tracker.windowStart = now();
    }
    tracker.count += 1;
    socketInitTracker.set(socket.id, tracker);
    if (tracker.count > SOCKET_INIT_MAX) {
      socket.emit("workspace:error", "Too many initialization attempts");
      return;
    }

    let payload;
    try {
      if (!raw || typeof raw !== "object") throw new Error("Missing");
      payload = validateRequest(initSchema, raw);
    } catch {
      socket.emit("workspace:error", "Invalid init request");
      return;
    }

    const user = sanitizeUsername(payload.username);
    let sessionId = payload.sessionId;
    let existingSession = sessionId && findSessionBySessionId(sessionId);

    // reconnect path
    if (existingSession && !existingSession.closed) {
      // (reconnection logic unchanged from original)
      // ...
      initSimpleTree(existingSession, socket);
      return;
    } else if (sessionId) {
      socket.emit("workspace:error", "Invalid init request");
      return;
    }

    // new session
    sessionId = `${user}_${uuidv4().slice(0, 12)}`;
    try {
      const { container, exec, stream, workspaceDir, baseImage, networkMode } =
        await createSessionExecShell({ sessionId, username: user });

      const sessionToken = deriveSessionToken(SERVER_INSTANCE_SECRET, sessionId, socket.id);

      const sess = {
        socketId: socket.id,
        sessionId,
        username: user,
        container,
        exec,
        stream,
        workspaceDir,
        baseImage,
        networkMode,
        createdAt: now(),
        lastActivity: now(),
        inputTokens: 16000,
        lastRefill: now(),
        stopStats: null,
        sessionToken,
        lastStat: null,
        closed: false,
        disconnectTimer: null,
        terminate: async function () {
          if (this.closed) return;
          this.closed = true;
          try { if (this.stopStats) this.stopStats(); } catch { }
          try { detachResourceGuard(this); } catch { }
          try { destroySimpleTree(this); } catch { }
          try { await stopAndRemoveContainer(this.container); } catch {}
          try { await removeWorkspaceDir(this.sessionId); } catch {}
          destroySession(this.socketId);
          try { socket.emit("terminal:exit", { code: 137, signal: null }); } catch {}
        },
      };
      createSession(socket.id, sess);

      stream.on("data", (chunk) => {
        if (!sess.closed) socket.emit("terminal:data", chunk.toString("utf8"));
      });
      stream.on("end", () => { if (!sess.closed) sess.terminate(); });
      stream.on("error", (err) => {
        if (!sess.closed) {
          socket.emit("terminal:data", `\r\n[stream error: ${err.message}]\r\n`);
          sess.terminate();
        }
      });

      socket.emit("workspace:ready", {
        user,
        sessionId,
        mode: "container",
        baseImage,
        networkMode,
        cwd: "/workspace",
        host: os.hostname(),
        token: sessionToken,
        limits: { idleMinutes: MAX_IDLE_MINUTES },
        fsMode: "simple-json",
      });

      attachResourceGuard(sess, socket, {
        RESOURCE_KILL_MEM_PERCENT: parseInt(process.env.RESOURCE_KILL_MEM_PERCENT || "0", 10),
        RESOURCE_KILL_CPU_PERCENT: parseInt(process.env.RESOURCE_KILL_CPU_PERCENT || "0", 10),
        RESOURCE_KILL_SUSTAIN_MS: parseInt(process.env.RESOURCE_KILL_SUSTAIN_MS || "15000", 10),
        RESOURCE_KILL_GRACE_MS: parseInt(process.env.RESOURCE_KILL_GRACE_MS || "5000", 10),
        RESOURCE_CHECK_INTERVAL_MS: parseInt(process.env.RESOURCE_CHECK_INTERVAL_MS || "2000", 10),
      });

      await initSimpleTree(sess, socket);
    } catch (e) {
      if (DEBUG_SANDBOX) console.error("[init error]", e);
      socket.emit("workspace:error", "Failed to start session: " + (e?.message || "unknown"));
    }
  });
}
