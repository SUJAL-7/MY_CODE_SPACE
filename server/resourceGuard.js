// Resource guard for session resource limits (CPU/mem kill logic)

export function attachResourceGuard(session, socket, config) {
  const {
    RESOURCE_KILL_MEM_PERCENT,
    RESOURCE_KILL_CPU_PERCENT,
    RESOURCE_KILL_SUSTAIN_MS,
    RESOURCE_KILL_GRACE_MS,
    RESOURCE_CHECK_INTERVAL_MS,
  } = config;
  if (!RESOURCE_KILL_MEM_PERCENT && !RESOURCE_KILL_CPU_PERCENT) return;
  session._rg = { cpuHighSince: null, warned: false, graceTimer: null };
  session._rgTimer = setInterval(() => {
    if (session.closed) return;
    const stat = session.lastStat;
    if (!stat) return;

    // Memory immediate
    if (RESOURCE_KILL_MEM_PERCENT && stat.memPercent >= RESOURCE_KILL_MEM_PERCENT) {
      socket.emit(
        "terminal:data",
        `\n[resource] memory ${stat.memPercent.toFixed(1)}% >= ${RESOURCE_KILL_MEM_PERCENT}% – terminating\n`
      );
      session.terminate();
      return;
    }

    // CPU
    if (RESOURCE_KILL_CPU_PERCENT && stat.cpuPercent >= RESOURCE_KILL_CPU_PERCENT) {
      if (!session._rg.cpuHighSince) session._rg.cpuHighSince = Date.now();
      else {
        const elapsed = Date.now() - session._rg.cpuHighSince;
        if (elapsed >= RESOURCE_KILL_SUSTAIN_MS && !session._rg.warned) {
          session._rg.warned = true;
          socket.emit(
            "terminal:data",
            `\n[resource] CPU ${stat.cpuPercent.toFixed(1)}% high; terminating in ${
              RESOURCE_KILL_GRACE_MS / 1000
            }s if still high\n`
          );
          session._rg.graceTimer = setTimeout(() => {
            if (session.closed) return;
            if (session.lastStat?.cpuPercent >= RESOURCE_KILL_CPU_PERCENT) {
              socket.emit("terminal:data", `[resource] CPU still high, terminating\n`);
              session.terminate();
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

export function detachResourceGuard(session) {
  if (session._rgTimer) clearInterval(session._rgTimer);
  if (session._rg?.graceTimer) clearTimeout(session._rg.graceTimer);
  delete session._rgTimer;
  delete session._rg;
}