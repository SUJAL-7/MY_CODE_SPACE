/**
 * Minimal DevSpace Server
 * - No progress / banner
 * - Immediate shell access
 * - Explicit container cleanup when shell (exec) ends
 */

import express from "express";
import http from "http";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import os from "os";
import Docker from "dockerode";

import {
  ensureWorkspaceRoot,
  createSessionExecShell,
  resizeExecTTY,
  stopAndRemoveContainer,
  removeWorkspaceDir,
  startStatsStream,
  stopStatsStream,
  getAllowlist,
  getAllowedNetworkModes,
  getDefaultNetworkMode
} from "./containerManager.js";

import {
  initSchema,
  inputSchema,
  resizeSchema,
  killSchema,
  statsSubscribeSchema,
  statsUnsubscribeSchema,
  validateRequest,
  sanitizeUsername,
  deriveSessionToken,
  verifySessionToken
} from "./security.js";

const PORT = process.env.PORT || 8080;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const SANDBOX_MODE = process.env.SANDBOX_MODE || "container";

const MAX_IDLE_MINUTES = parseInt(process.env.MAX_IDLE_MINUTES || "120", 10);
const CLEAN_INTERVAL_SECONDS = parseInt(process.env.CLEAN_INTERVAL_SECONDS || "60", 10);

const INPUT_MAX_TOKENS_PER_SEC = parseInt(process.env.INPUT_MAX_TOKENS_PER_SEC || "8000", 10);
const INPUT_BURST_BYTES = parseInt(process.env.INPUT_BURST_BYTES || "16000", 10);

const MAX_CONCURRENT_SESSIONS = parseInt(process.env.MAX_CONCURRENT_SESSIONS || "0", 10);
const MAX_SESSIONS_PER_USER = parseInt(process.env.MAX_SESSIONS_PER_USER || "0", 10);

const SOCKET_INIT_RATE_WINDOW_MS = parseInt(process.env.SOCKET_INIT_RATE_WINDOW_MS || "60000", 10);
const SOCKET_INIT_MAX = parseInt(process.env.SOCKET_INIT_MAX || "10", 10);

const SERVER_INSTANCE_SECRET = (process.env.SERVER_INSTANCE_SECRET || "").trim();
const DEBUG_SANDBOX = process.env.DEBUG_SANDBOX === "1";

const RESOURCE_KILL_MEM_PERCENT = parseInt(process.env.RESOURCE_KILL_MEM_PERCENT || "0", 10);
const RESOURCE_KILL_CPU_PERCENT = parseInt(process.env.RESOURCE_KILL_CPU_PERCENT || "0", 10);
const RESOURCE_KILL_SUSTAIN_MS = parseInt(process.env.RESOURCE_KILL_SUSTAIN_MS || "15000", 10);
const RESOURCE_KILL_GRACE_MS = parseInt(process.env.RESOURCE_KILL_GRACE_MS || "5000", 10);
const RESOURCE_CHECK_INTERVAL_MS = parseInt(process.env.RESOURCE_CHECK_INTERVAL_MS || "2000", 10);

if (!SERVER_INSTANCE_SECRET || SERVER_INSTANCE_SECRET.length < 16) {
  console.error("[FATAL] SERVER_INSTANCE_SECRET must be set (>=16 chars)");
  process.exit(1);
}

await ensureWorkspaceRoot();

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json({ limit: "64kb", strict: true }));

const publicLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(["/health", "/config"], publicLimiter);

const sessions = new Map();
const userSessionCount = new Map();
const socketInitTracker = new Map();

function now() { return Date.now(); }
function userCount(u) { return userSessionCount.get(u) || 0; }
function incUser(u) { userSessionCount.set(u, (userSessionCount.get(u) || 0) + 1); }
function decUser(u) {
  const c = userSessionCount.get(u) || 0;
  if (c <= 1) userSessionCount.delete(u); else userSessionCount.set(u, c - 1);
}
function refillTokens(sess) {
  const ts = now();
  const elapsed = (ts - sess.lastRefill) / 1000;
  if (elapsed <= 0) return;
  const add = elapsed * INPUT_MAX_TOKENS_PER_SEC;
  sess.inputTokens = Math.min(INPUT_BURST_BYTES, sess.inputTokens + add);
  sess.lastRefill = ts;
}

app.get("/config", (_req, res) => {
  res.json({
    allowlist: getAllowlist(),
    network: {
      allowedModes: getAllowedNetworkModes(),
      defaultMode: getDefaultNetworkMode()
    },
    limits: {
      maxConcurrentSessions: MAX_CONCURRENT_SESSIONS || null,
      maxSessionsPerUser: MAX_SESSIONS_PER_USER || null,
      idleMinutes: MAX_IDLE_MINUTES
    }
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    sessions: sessions.size,
    users: Array.from(userSessionCount.entries())
  });
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_URL, methods: ["GET", "POST"] }
});

function wrap(socket, event, schema, handler, errorChannel = "terminal:data") {
  socket.on(event, (raw) => {
    try {
      if (!raw || typeof raw !== "object") throw new Error("Payload missing");
      const payload = validateRequest(schema, raw);
      handler(payload);
    } catch {
      if (errorChannel === "terminal:data") socket.emit("terminal:data", `\r\n[invalid ${event}]\r\n`);
      else socket.emit(errorChannel, `Invalid ${event}`);
    }
  });
}

/* -------- Resource Guard (optional kill) -------- */
function attachResourceGuard(session, socket) {
  if (!RESOURCE_KILL_MEM_PERCENT && !RESOURCE_KILL_CPU_PERCENT) return;
  session._rg = { cpuHighSince: null, warned: false, graceTimer: null };
  session._rgTimer = setInterval(() => {
    if (session.closed) return; // FIX: don't act on closed sessions
    const stat = session.lastStat;
    if (!stat) return;

    if (RESOURCE_KILL_MEM_PERCENT && stat.memPercent >= RESOURCE_KILL_MEM_PERCENT) {
      socket.emit("terminal:data", `\n[resource] memory ${stat.memPercent.toFixed(1)}% >= ${RESOURCE_KILL_MEM_PERCENT}% – terminating\n`);
      terminateSession(session, socket);
      return;
    }

    if (RESOURCE_KILL_CPU_PERCENT && stat.cpuPercent >= RESOURCE_KILL_CPU_PERCENT) {
      if (!session._rg.cpuHighSince) {
        session._rg.cpuHighSince = now();
      } else {
        const elapsed = now() - session._rg.cpuHighSince;
        if (elapsed >= RESOURCE_KILL_SUSTAIN_MS && !session._rg.warned) {
          session._rg.warned = true;
          socket.emit("terminal:data", `\n[resource] CPU ${stat.cpuPercent.toFixed(1)}% high; terminating in ${(RESOURCE_KILL_GRACE_MS/1000)}s if still high\n`);
          session._rg.graceTimer = setTimeout(() => {
            if (session.closed) return;
            const s2 = session.lastStat;
            if (s2 && s2.cpuPercent >= RESOURCE_KILL_CPU_PERCENT) {
              socket.emit("terminal:data", `[resource] CPU still high, terminating\n`);
              terminateSession(session, socket);
            } else {
              session._rg.cpuHighSince = null;
              session._rg.warned = false;
              socket.emit("terminal:data", `[resource] CPU normalized\n`);
            }
          }, RESOURCE_KILL_GRACE_MS);
        }
      }
    } else {
      session._rg.cpuHighSince = null;
      session._rg.warned = false;
      if (session._rg.graceTimer) {
        clearTimeout(session._rg.graceTimer);
        session._rg.graceTimer = null;
      }
    }
  }, RESOURCE_CHECK_INTERVAL_MS);
}

function detachResourceGuard(session) {
  if (session._rgTimer) clearInterval(session._rgTimer);
  if (session._rg?.graceTimer) clearTimeout(session._rg.graceTimer);
  delete session._rgTimer;
  delete session._rg;
}

async function terminateSession(sess, socket) {
  if (sess.closed) return;          // FIX: idempotency guard
  sess.closed = true;               // FIX: mark closed early
  try { if (sess.stopStats) sess.stopStats(); } catch {}
  try { detachResourceGuard(sess); } catch {}
  try { await stopAndRemoveContainer(sess.container); } catch {}
  try { await removeWorkspaceDir(sess.sessionId, sess.username); } catch {}
  sessions.delete(sess.socketId);
  decUser(sess.username);
  socket.emit("terminal:exit", { code: 137, signal: null });
}

/* ---------------- Socket: Connection ---------------- */
io.on("connection", (socket) => {
  if (DEBUG_SANDBOX) console.log("[socket] connect", socket.id);

  socket.on("workspace:init", async (raw) => {
    if (SANDBOX_MODE !== "container") {
      socket.emit("workspace:error", "Sandbox mode disabled");
      return;
    }

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
    if (MAX_CONCURRENT_SESSIONS && sessions.size >= MAX_CONCURRENT_SESSIONS) {
      socket.emit("workspace:error", "Global session limit reached");
      return;
    }
    if (MAX_SESSIONS_PER_USER && userCount(user) >= MAX_SESSIONS_PER_USER) {
      socket.emit("workspace:error", "User session quota exceeded");
      return;
    }

    const sessionId = `${user}_${uuidv4().slice(0, 12)}`;

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
        closed: false          // FIX: track lifecycle
      };
      sessions.set(socket.id, sess);
      incUser(user);

      stream.on("data", chunk => {
        if (!sess.closed) socket.emit("terminal:data", chunk.toString("utf8"));
      });

      // FIX: When shell ends, terminate the whole session (cleans container)
      stream.on("end", () => {
        if (!sess.closed) terminateSession(sess, socket);
      });
      stream.on("error", err => {
        if (!sess.closed) {
          socket.emit("terminal:data", `\r\n[stream error: ${err.message}]\r\n`);
          terminateSession(sess, socket); // FIX
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
        limits: { idleMinutes: MAX_IDLE_MINUTES }
      });

      attachResourceGuard(sess, socket);

    } catch (e) {
      if (DEBUG_SANDBOX) console.error("[init error]", e);
      socket.emit("workspace:error", "Failed to start session: " + (e?.message || "unknown"));
    }
  });

  wrap(socket, "terminal:input", inputSchema, (p) => {
    const sess = sessions.get(socket.id); if (!sess || sess.closed) return;
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
    try { if (!sess.closed) sess.stream.write(p.data); } catch {}
  });

  wrap(socket, "terminal:resize", resizeSchema, (p) => {
    const sess = sessions.get(socket.id); if (!sess || sess.closed) return;
    if (!verifySessionToken(SERVER_INSTANCE_SECRET, p.token, sess.sessionId, socket.id)) return;
    if (p.sessionId !== sess.sessionId) return;
    resizeExecTTY(sess.container, sess.exec, { cols: p.cols, rows: p.rows });
  });

  wrap(socket, "terminal:kill", killSchema, (p) => {
    const sess = sessions.get(socket.id); if (!sess || sess.closed) return;
    if (!verifySessionToken(SERVER_INSTANCE_SECRET, p.token, sess.sessionId, socket.id)) return;
    if (p.sessionId !== sess.sessionId) return;
    terminateSession(sess, socket);
  });

  wrap(socket, "stats:subscribe", statsSubscribeSchema, (p) => {
    const sess = sessions.get(socket.id); if (!sess || sess.closed) return;
    if (!verifySessionToken(SERVER_INSTANCE_SECRET, p.token, sess.sessionId, socket.id)) return;
    if (p.sessionId !== sess.sessionId) return;
    if (sess.stopStats) return;
    const stop = startStatsStream(sess, stat => {
      if (sess.closed) return;
      sess.lastStat = stat;
      socket.emit("stats:tick", stat);
    }, () => {});
    sess.stopStats = stop;
  }, "workspace:error");

  wrap(socket, "stats:unsubscribe", statsUnsubscribeSchema, (p) => {
    const sess = sessions.get(socket.id); if (!sess || sess.closed) return;
    if (!verifySessionToken(SERVER_INSTANCE_SECRET, p.token, sess.sessionId, socket.id)) return;
    if (p.sessionId !== sess.sessionId) return;
    if (sess.stopStats) { try { sess.stopStats(); } catch {} sess.stopStats = null; }
  }, "workspace:error");

  socket.on("disconnect", async () => {
    const sess = sessions.get(socket.id);
    if (sess && !sess.closed) {
      await terminateSession(sess, socket);
    }
  });
});

/* ---------------- Idle Cleanup ---------------- */
const MAX_IDLE_MS = MAX_IDLE_MINUTES * 60 * 1000;
setInterval(async () => {
  const cutoff = now() - MAX_IDLE_MS;
  for (const [sid, sess] of sessions) {
    if (sess.closed) continue;
    if (sess.lastActivity < cutoff) {
      const sock = io.sockets.sockets.get(sid);
      if (sock) {
        await terminateSession(sess, sock);
      } else {
        // Fallback
        sess.closed = true;
        try { if (sess.stopStats) sess.stopStats(); } catch {}
        try { await stopAndRemoveContainer(sess.container); } catch {}
        try { await removeWorkspaceDir(sess.sessionId, sess.username); } catch {}
        sessions.delete(sid);
        decUser(sess.username);
      }
    }
  }
}, CLEAN_INTERVAL_SECONDS * 1000);

/* ---------------- Errors & Start ---------------- */
process.on("uncaughtException", e => console.error("[uncaughtException]", e));
process.on("unhandledRejection", r => console.error("[unhandledRejection]", r));

httpServer.listen(PORT, () => {
  console.log(`Minimal DevSpace server listening on ${PORT} (auto-clean on shell exit)`);
});