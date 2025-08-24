// const { DEBUG, NUDGE_MIN_DELAY_MS, NUDGE_MAX_WAIT_MS } = require("./constants");
// const { rebuild } = require("./rebuild");
import { DEBUG, NUDGE_MIN_DELAY_MS, NUDGE_MAX_WAIT_MS } from "./constants.js";
import { rebuild } from "./rebuild.js";

export async function nudgeSimpleTree(session, socket, reason = "nudge") {
  const st = session.simpleTree;
  if (!st || st.disposed || st.failed) return;

  if (st.rebuildInFlight) {
    if (DEBUG) console.log("[simpleFS] nudge ignored (in-flight rebuild)");
    scheduleDebouncedNudge(session, socket, reason);
    return;
  }

  scheduleDebouncedNudge(session, socket, reason);
}

function scheduleDebouncedNudge(session, socket, reason) {
  const st = session.simpleTree;
  if (!st || st.disposed) return;

  const nowTs = Date.now();
  if (!st.firstNudgeAt) st.firstNudgeAt = nowTs;

  const elapsed = nowTs - st.firstNudgeAt;
  const delay = elapsed >= NUDGE_MAX_WAIT_MS ? 0 : NUDGE_MIN_DELAY_MS;

  if (st.nudgeTimer) clearTimeout(st.nudgeTimer);
  st.nudgeTimer = setTimeout(() => {
    st.nudgeTimer = null;
    st.firstNudgeAt = 0;
    rebuild(session, socket, `debounced-${reason}`, { forceEmit: true }).catch(() => {});
  }, delay);
}
