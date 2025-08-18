// Session management, with reconnect/disconnect-grace support + idle/ping logic

const sessions = new Map();          // socketId => session
const userSessionMap = new Map();    // sessionId => session
const userSessionCount = new Map();

/**
 * sessionData is expected to contain at least:
 * - sessionId
 * - username
 * - terminate()  (function that stops container & cleans)
 */
export function createSession(socketId, sessionData) {
  const now = Date.now();
  const enriched = {
    ...sessionData,
    lastActivity: now,
    pingSentAt: null
  };
  sessions.set(socketId, enriched);
  userSessionMap.set(enriched.sessionId, enriched);
  const user = enriched.username;
  userSessionCount.set(user, (userSessionCount.get(user) || 0) + 1);
}

export function destroySession(socketId) {
  const sess = sessions.get(socketId);
  if (!sess) return;
  const user = sess.username;
  sessions.delete(socketId);
  userSessionMap.delete(sess.sessionId);
  const c = userSessionCount.get(user) || 0;
  if (c <= 1) userSessionCount.delete(user);
  else userSessionCount.set(user, c - 1);
}

export function getSession(socketId) {
  return sessions.get(socketId);
}

// Reconnect lookup
export function findSessionBySessionId(sessionId) {
  return userSessionMap.get(sessionId);
}

export function getSessionStats() {
  return { count: sessions.size, users: Array.from(userSessionCount.keys()) };
}

export function forEachSession(fn) {
  for (const [id, sess] of sessions.entries()) fn(id, sess);
}

/* ---------- Idle / Activity Helpers ---------- */

export function markSessionActivity(session) {
  if (!session) return;
  session.lastActivity = Date.now();
  session.pingSentAt = null;
}

export function setSessionPingSent(session) {
  if (!session) return;
  if (!session.pingSentAt) session.pingSentAt = Date.now();
}

export function clearSessionPing(session) {
  if (!session) return;
  session.pingSentAt = null;
}