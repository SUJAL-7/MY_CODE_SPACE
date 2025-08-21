import { io } from "socket.io-client";

/*
  Unified env var (Vite style):
  Set VITE_REACT_APP_SERVER_URL (or fallback).
*/
const SERVER_URL =
  import.meta.env.VITE_REACT_APP_SERVER_URL ||
  import.meta.env.REACT_APP_SERVER_URL ||
  "http://3.108.254.28:8080";

let socketSingleton = null;

export function connectSocket() {
  if (socketSingleton) return socketSingleton;
  socketSingleton = io(SERVER_URL, {
    transports: ["websocket"],
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  });

  // OPTIONAL: enable debug by uncommenting
  // socketSingleton.onAny((ev, ...args) => {
  //   console.log("[socket:any]", ev, ...args);
  // });

  return socketSingleton;
}

export function getSocket() {
  return socketSingleton;
}

export function disconnectSocket() {
  if (socketSingleton) {
    socketSingleton.disconnect();
    socketSingleton = null;
  }
}