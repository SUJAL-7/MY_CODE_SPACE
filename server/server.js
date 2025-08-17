import express from "express";
import http from "http";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import { Server } from "socket.io";
import os from "os";
import cookieParser from "cookie-parser";
import { v4 as uuidv4 } from "uuid";

import {
  ensureWorkspaceRoot,
  getAllowlist,
  getAllowedNetworkModes,
  getDefaultNetworkMode,
} from "./containerManager.js";
import { setupSocketHandlers, SESSION_GRACE_PERIOD_MS } from "./socketHandlers.js";
import { getSessionStats } from "./sessionManager.js";

const PORT = process.env.PORT || 8080;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const MAX_IDLE_MINUTES = parseInt(process.env.MAX_IDLE_MINUTES || "120", 10);

await ensureWorkspaceRoot();

/* Express setup */
const app = express();
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json({ limit: "64kb", strict: true }));
app.use(cookieParser());

const limiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(["/health", "/config"], limiter);

// Endpoint to set sessionId cookie with same expiry as grace period
app.post("/set-session-cookie", (req, res) => {
    console.log("BODY RECEIVED:", req.body);
  const { sessionId, username } = req.body;
  if (!sessionId || !username) return res.status(400).json({ error: "Missing sessionId or username" });
  res.cookie("sessionId", sessionId, {
    maxAge: SESSION_GRACE_PERIOD_MS,
    httpOnly: false,
    sameSite: "lax",
    path: "/",
  });
  res.cookie("username", username, {
    maxAge: SESSION_GRACE_PERIOD_MS,
    httpOnly: false,
    sameSite: "lax",
    path: "/",
  });
  res.json({ ok: true });
});

app.get("/config", (_req, res) => {
  res.json({
    allowlist: getAllowlist(),
    network: {
      allowedModes: getAllowedNetworkModes(),
      defaultMode: getDefaultNetworkMode(),
    },
    limits: {
      idleMinutes: MAX_IDLE_MINUTES,
    },
    fsMode: "container-native",
    sessionGraceSeconds: Math.floor(SESSION_GRACE_PERIOD_MS / 1000),
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    sessions: getSessionStats(),
    hostname: os.hostname(),
  });
});

/* HTTP & Socket.io */
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_URL, methods: ["GET", "POST"] },
});

/* Socket logic */
setupSocketHandlers(io);

process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));
process.on("unhandledRejection", (r) => console.error("[unhandledRejection]", r));

httpServer.listen(PORT, () => {
  console.log(`DevSpace server (container-native FS) listening on ${PORT}`);
});