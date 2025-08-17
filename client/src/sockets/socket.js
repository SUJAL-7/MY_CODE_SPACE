import { io } from "socket.io-client";

// Prefer explicit env variable; fallback to same host on port 8080
const envUrl = import.meta.env.VITE_SERVER_URL || import.meta.env.VITE_BACKEND_URL;
const fallbackUrl = `${window.location.protocol}//${window.location.hostname}:8080`;
export const SERVER_URL = envUrl || fallbackUrl;

export const socket = io(SERVER_URL, {
  transports: ["websocket"],
  autoConnect: true
});

// Basic debug (optional)
socket.on("connect", () => console.log("[socket] connected", socket.id));
socket.on("disconnect", (reason) => console.log("[socket] disconnected", reason));
socket.on("connect_error", (err) => console.error("[socket] connect_error", err.message));