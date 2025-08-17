export function registerWorkspaceHandlers(socket, {
  onReady,
  onError,
  onExit,
}) {
  socket.on("workspace:ready", (payload) => {
    if (typeof onReady === "function") onReady(payload);
  });

  socket.on("workspace:error", (msg) => {
    if (typeof onError === "function") onError(msg);
  });

  socket.on("terminal:exit", () => {
    if (typeof onExit === "function") onExit();
  });
}