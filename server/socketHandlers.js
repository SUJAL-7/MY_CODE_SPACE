// COMPLETE (simplified) SOCKET HANDLERS WITH SIMPLE FILE TREE
// Retains existing terminal, stats, and filesystem CRUD endpoints.
// Replaces any prior complex tree logic with simple snapshot system.

import { v4 as uuidv4 } from "uuid";
import os from "os";
import {
  createSession,
  destroySession,
  getSession,
  findSessionBySessionId,
  forEachSession,
} from "./sessionManager.js";
import {
  createSessionExecShell,
  resizeExecTTY,
  stopAndRemoveContainer,
  removeWorkspaceDir,
  startStatsStream,
} from "./containerManager.js";
import {
  validateRequest,
  initSchema,
  inputSchema,
  resizeSchema,
  killSchema,
  statsSubscribeSchema,
  statsUnsubscribeSchema,
  sanitizeUsername,
  deriveSessionToken,
  verifySessionToken,
} from "./security.js";
import {
  listDirectory,
  readFile,
  writeFile,
  createDirectory,
  deleteEntry,
  renameEntry,
} from "./containerFileSystem.js";
import { attachResourceGuard, detachResourceGuard } from "./resourceGuard.js";

import {
  initSimpleTree,
  destroySimpleTree,
  resyncSimpleTree,
} from "./simpleFileTree.js";

// --- Configuration ---
export const SESSION_GRACE_PERIOD_MS = parseInt(process.env.SESSION_GRACE_PERIOD_MS || "120000", 10);
const MAX_IDLE_MINUTES = parseInt(process.env.MAX_IDLE_MINUTES || "120", 10);
const INPUT_MAX_TOKENS_PER_SEC = parseInt(process.env.INPUT_MAX_TOKENS_PER_SEC || "8000", 10);
const INPUT_BURST_BYTES = parseInt(process.env.INPUT_BURST_BYTES || "16000", 10);
const SERVER_INSTANCE_SECRET = (process.env.SERVER_INSTANCE_SECRET || "").trim();
const DEBUG_SANDBOX = process.env.DEBUG_SANDBOX === "1";
const SANDBOX_MODE = process.env.SANDBOX_MODE || "container";
const SOCKET_INIT_RATE_WINDOW_MS = parseInt(process.env.SOCKET_INIT_RATE_WINDOW_MS || "60000", 10);
const SOCKET_INIT_MAX = parseInt(process.env.SOCKET_INIT_MAX || "10", 10);

const socketInitTracker = new Map();
const downloadTokenMap = new Map();

function now() { return Date.now(); }

function refillTokens(sess) {
  const ts = now();
  const elapsed = (ts - sess.lastRefill) / 1000;
  if (elapsed <= 0) return;
  const add = elapsed * INPUT_MAX_TOKENS_PER_SEC;
  sess.inputTokens = Math.min(INPUT_BURST_BYTES, sess.inputTokens + add);
  sess.lastRefill = ts;
}

export function setupSocketHandlers(io) {
  io.on("connection", (socket) => {
    if (DEBUG_SANDBOX) console.log("[socket] connect", socket.id);

    socket.on("workspace:init", async (raw) => {
      if (SANDBOX_MODE !== "container") {
        socket.emit("workspace:error", "Sandbox mode disabled");
        return;
      }

      // Per-socket rate limit
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

      // --- Reconnect path ---
      if (existingSession && !existingSession.closed) {
        const oldSocketId = existingSession.socketId;
        const sameSocket = oldSocketId === socket.id;

        if (existingSession.disconnectTimer) {
          clearTimeout(existingSession.disconnectTimer);
          existingSession.disconnectTimer = null;
        }

        if (!sameSocket) {
          existingSession.sessionToken = deriveSessionToken(
            SERVER_INSTANCE_SECRET,
            existingSession.sessionId,
            socket.id
          );
        }
        existingSession.socketId = socket.id;
        existingSession.lastActivity = now();

        // Re-index for getSession(newSocketId)
        if (!sameSocket) {
          try { destroySession(oldSocketId); } catch { }
          createSession(socket.id, existingSession);
        }

        // Reattach stream if socket changed
        if (!sameSocket && existingSession.stream) {
          existingSession.stream.removeAllListeners("data");
          existingSession.stream.removeAllListeners("end");
          existingSession.stream.removeAllListeners("error");
          existingSession.stream.on("data", (chunk) => {
            if (!existingSession.closed) socket.emit("terminal:data", chunk.toString("utf8"));
          });
          existingSession.stream.on("end", () => {
            if (!existingSession.closed) existingSession.terminate();
          });
          existingSession.stream.on("error", (err) => {
            if (!existingSession.closed) {
              socket.emit("terminal:data", `\r\n[stream error: ${err.message}]\r\n`);
              existingSession.terminate();
            }
          });
        }

        socket.emit("workspace:ready", {
          user,
          sessionId: existingSession.sessionId,
          mode: "container",
          baseImage: existingSession.baseImage,
          networkMode: existingSession.networkMode,
          cwd: "/workspace",
          host: os.hostname(),
          token: existingSession.sessionToken,
          limits: { idleMinutes: MAX_IDLE_MINUTES },
          fsMode: "simple-json",
          resumed: !sameSocket,
        });

        // Emit (or re-emit) simple tree snapshot
        initSimpleTree(existingSession, socket);
        return;
      } else if (sessionId) {
        socket.emit("workspace:error", "Invalid init request");
        return;
      }

      // --- New session ---
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
          inputTokens: INPUT_BURST_BYTES,
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
            try {
              await stopAndRemoveContainer(this.container);
            } catch (e) { console.error("Stop/remove container failed", e); }
            try {
              await removeWorkspaceDir(this.sessionId);
            } catch (e) { console.error("Workspace remove failed", e); }
            destroySession(this.socketId);
            try { socket.emit("terminal:exit", { code: 137, signal: null }); } catch { }
          },
        };
        createSession(socket.id, sess);

        stream.on("data", (chunk) => {
          if (!sess.closed) socket.emit("terminal:data", chunk.toString("utf8"));
        });
        stream.on("end", () => {
          if (!sess.closed) sess.terminate();
        });
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

        // Start simple tree snapshots
        await initSimpleTree(sess, socket);

      } catch (e) {
        if (DEBUG_SANDBOX) console.error("[init error]", e);
        socket.emit("workspace:error", "Failed to start session: " + (e?.message || "unknown"));
      }
    });

    // ---------- Terminal wrappers ----------
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
      try { sess.stream.write(p.data); } catch { }
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

    // ---------- Stats ----------
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
        () => { }
      );
      sess.stopStats = stop;
    });

    wrap("stats:unsubscribe", statsUnsubscribeSchema, (p) => {
      const sess = getSession(socket.id);
      if (!sess || sess.closed) return;
      if (!verifySessionToken(SERVER_INSTANCE_SECRET, p.token, sess.sessionId, socket.id)) return;
      if (sess.stopStats) {
        try { sess.stopStats(); } catch { }
        sess.stopStats = null;
      }
    });

    // ---------- Shared session validator for fs ops ----------
    function validateSession(payload) {
      const sess = getSession(socket.id);
      if (!sess || sess.closed) throw new Error("Session not found");
      if (!verifySessionToken(SERVER_INSTANCE_SECRET, payload.token, sess.sessionId, socket.id))
        throw new Error("Bad token");
      if (payload.sessionId !== sess.sessionId) throw new Error("Session mismatch");
      return sess;
    }

    // ---------- Legacy CRUD FS APIs (still useful for editor) ----------
    socket.on("fs:read", async (payload) => {
      try {
        const sess = validateSession(payload);
        const rel = (payload.path || "").replace(/\\/g, "/").replace(/^\//, "");
        const data = await readFile(sess.container, rel);
        socket.emit("fs:readResult", { requestId: payload.requestId, ...data });
      } catch (e) {
        socket.emit("fs:error", { requestId: payload.requestId, op: "read", message: e.message });
      }
    });

    socket.on("fs:write", async (payload) => {
      try {
        const sess = validateSession(payload);
        const rel = (payload.path || "").replace(/\\/g, "/").replace(/^\//, "");
        await writeFile(sess.container, rel, payload.content || "");
        socket.emit("fs:writeResult", { requestId: payload.requestId, path: rel });
        // No incremental update — next scan will pick it up
      } catch (e) {
        socket.emit("fs:error", { requestId: payload.requestId, op: "write", message: e.message });
      }
    });

    socket.on("fs:createDir", async (payload) => {
      try {
        const sess = validateSession(payload);
        const rel = (payload.path || "").replace(/\\/g, "/").replace(/^\//, "");
        await createDirectory(sess.container, rel);
        socket.emit("fs:createDirResult", { requestId: payload.requestId, path: rel });
      } catch (e) {
        socket.emit("fs:error", { requestId: payload.requestId, op: "createDir", message: e.message });
      }
    });

    socket.on("fs:delete", async (payload) => {
      try {
        const sess = validateSession(payload);
        const rel = (payload.path || "").replace(/\\/g, "/").replace(/^\//, "");
        await deleteEntry(sess.container, rel);
        socket.emit("fs:deleteResult", { requestId: payload.requestId, path: rel });
      } catch (e) {
        socket.emit("fs:error", { requestId: payload.requestId, op: "delete", message: e.message });
      }
    });

    socket.on("fs:rename", async (payload) => {
      try {
        const sess = validateSession(payload);
        const fromRel = (payload.from || "").replace(/\\/g, "/").replace(/^\//, "");
        const toRel = (payload.to || "").replace(/\\/g, "/").replace(/^\//, "");
        await renameEntry(sess.container, fromRel, toRel);
        socket.emit("fs:renameResult", { requestId: payload.requestId, from: fromRel, to: toRel });
      } catch (e) {
        socket.emit("fs:error", { requestId: payload.requestId, op: "rename", message: e.message });
      }
    });

    // Download token (optional: unchanged)
    socket.on("fs:downloadToken", (payload) => {
      try {
        const sess = validateSession(payload);
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

    // Simple tree manual resync
    socket.on("fs:treeSimple:resync", () => {
      const sess = getSession(socket.id);
      if (!sess || sess.closed) return;
      resyncSimpleTree(sess, socket);
    });

    socket.on("disconnect", async () => {
      const sess = getSession(socket.id);
      if (sess && !sess.closed && !sess.disconnectTimer) {
        sess.disconnectTimer = setTimeout(async () => {
          if (!sess.closed) {
            await sess.terminate();
            if (DEBUG_SANDBOX) console.log(`[CLEANUP] Grace period expired ${sess.sessionId}`);
          }
        }, SESSION_GRACE_PERIOD_MS);
      }
    });
  });

  // Idle cleanup
  const MAX_IDLE_MS = MAX_IDLE_MINUTES * 60 * 1000;
  setInterval(async () => {
    const cutoff = now() - MAX_IDLE_MS;
    forEachSession(async (_sid, sess) => {
      if (sess.closed) return;
      if (sess.lastActivity < cutoff) {
        sess.terminate && (await sess.terminate());
      }
    });
  }, 60 * 1000);
}

function randomToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}