export function registerTerminalHandlers(socket, {
  onTerminalData,
}) {
  socket.on("terminal:data", (data) => {
    if (typeof onTerminalData === "function") onTerminalData(data);
  });
}

export function sendTerminalInput(socket, { sessionId, token, data }) {
  socket.emit("terminal:input", { sessionId, token, data });
}

export function resizeTerminal(socket, { sessionId, token, cols, rows }) {
  socket.emit("terminal:resize", { sessionId, token, cols, rows });
}

export function killTerminal(socket, { sessionId, token }) {
  socket.emit("terminal:kill", { sessionId, token });
}