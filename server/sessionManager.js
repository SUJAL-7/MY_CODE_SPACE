// Session management, with reconnect/disconnect-grace support

const sessions = new Map(); // socketId => session
const userSessionMap = new Map(); // sessionId => session
const userSessionCount = new Map();

export function createSession(socketId, sessionData) {
  sessions.set(socketId, sessionData);
  userSessionMap.set(sessionData.sessionId, sessionData);
  const user = sessionData.username;
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

// Used for reconnect logic
export function findSessionBySessionId(sessionId) {
  return userSessionMap.get(sessionId);
}

export function getSessionStats() {
  return { count: sessions.size, users: Array.from(userSessionCount.keys()) };
}

export function forEachSession(fn) {
  for (const [id, sess] of sessions.entries()) fn(id, sess);
}