export const SESSION_GRACE_PERIOD_MS = parseInt(process.env.SESSION_GRACE_PERIOD_MS || "120000", 10);
export const MAX_IDLE_MINUTES = parseInt(process.env.MAX_IDLE_MINUTES || "120", 10);
export const INPUT_MAX_TOKENS_PER_SEC = parseInt(process.env.INPUT_MAX_TOKENS_PER_SEC || "8000", 10);
export const INPUT_BURST_BYTES = parseInt(process.env.INPUT_BURST_BYTES || "16000", 10);
export const SERVER_INSTANCE_SECRET = (process.env.SERVER_INSTANCE_SECRET || "").trim();
export const DEBUG_SANDBOX = process.env.DEBUG_SANDBOX === "1";
export const SANDBOX_MODE = process.env.SANDBOX_MODE || "container";
export const SOCKET_INIT_RATE_WINDOW_MS = parseInt(process.env.SOCKET_INIT_RATE_WINDOW_MS || "60000", 10);
export const SOCKET_INIT_MAX = parseInt(process.env.SOCKET_INIT_MAX || "10", 10);

export const SESSION_IDLE_MAX_MS = parseInt(process.env.SESSION_IDLE_MAX_MS || "600000", 10);
export const SESSION_IDLE_PING_MS = parseInt(process.env.SESSION_IDLE_PING_MS || "480000", 10);
export const SESSION_IDLE_PING_TIMEOUT_MS = parseInt(process.env.SESSION_IDLE_PING_TIMEOUT_MS || "120000", 10);

export const _safePingMs = Math.min(SESSION_IDLE_PING_MS, SESSION_IDLE_MAX_MS - 60000);
