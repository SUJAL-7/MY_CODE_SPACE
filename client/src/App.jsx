import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useLayoutEffect,
} from "react";

import { connectSocket, disconnectSocket } from "./sockets";
import { registerSimpleTree, unregisterSimpleTree } from "./sockets/treeHandlers";

import Login from "./components/Login";
import TopBar from "./components/TopBar";
import Sidebar from "./components/Sidebar/Sidebar";
import EditorTabs from "./components/Editor/EditorTabs";
import EditorPane from "./components/Editor/EditorPane";
import Terminal from "./components/Terminal";
import StatusBar from "./components/StatusBar";

const SERVER_URL =
  import.meta.env.VITE_REACT_APP_SERVER_URL || "http://localhost:8080";

function getCookie(name) {
  const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[2]) : "";
}
function clearCookie(name) {
  document.cookie = `${name}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
}
async function setSessionCookies(sessionId, username) {
  try {
    await fetch(`${SERVER_URL}/set-session-cookie`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, username }),
    });
  } catch {}
}
function shortHash(str) {
  if (!str) return "∅";
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export default function App() {
  const [phase, setPhase] = useState("boot");
  const [sessionInfo, setSessionInfo] = useState(null);
  const [error, setError] = useState("");
  const [pendingUsername, setPendingUsername] = useState("");

  const [simpleTree, setSimpleTree] = useState(null); // { version, tree, changed }
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFile, setActiveFile] = useState("");
  const [terminalOutput, setTerminalOutput] = useState([]);

  const [showDebugPanel, setShowDebugPanel] = useState(true);
  const [terminalDataCount, setTerminalDataCount] = useState(0);

  const socketRef = useRef(null);
  const initSentRef = useRef(false);
  const phaseRef = useRef(phase);
  const lastTokenRef = useRef(null);
  const lastWorkspaceReadyTimeRef = useRef(0);
  const duplicateInitCountRef = useRef(0);

  const [cookieUsername, setCookieUsername] = useState("");
  const [cookieSessionId, setCookieSessionId] = useState("");

  useLayoutEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const cu = getCookie("username");
    const cs = getCookie("sessionId");
    setCookieUsername(cu);
    setCookieSessionId(cs);
    setPhase(cu && cs ? "connecting" : "login");
  }, []);

  useEffect(() => {
    const key = (e) => {
      if (e.ctrlKey && e.shiftKey && e.code === "KeyD")
        setShowDebugPanel((v) => !v);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const ensureSocket = useCallback(() => {
    if (!socketRef.current) {
      socketRef.current = connectSocket();
      socketRef.current.onAny((ev, ...args) => {
        if (ev === "terminal:data") return;
        console.log("[DBG][onAny]", ev, ...(args.length ? args : []));
      });
    }
    return socketRef.current;
  }, []);

  const maybeInit = useCallback(() => {
    const socket = ensureSocket();
    if (!socket) return;
    if (initSentRef.current) {
      duplicateInitCountRef.current += 1;
      return;
    }
    const username =
      pendingUsername ||
      cookieUsername ||
      sessionInfo?.user ||
      sessionInfo?.username;
    const isResume = !!cookieSessionId && phase === "connecting" && !sessionInfo;
    const isNew = !!pendingUsername && phase === "connecting" && !cookieSessionId && !sessionInfo;
    if (!username || (!isResume && !isNew)) return;

    const emit = (payload) => {
      initSentRef.current = true;
      duplicateInitCountRef.current = 0;
      lastWorkspaceReadyTimeRef.current = 0;
      socket.emit("workspace:init", payload);
    };

    if (!socket.connected) {
      socket.once("connect", () => {
        if (!initSentRef.current && ["connecting", "reconnecting"].includes(phaseRef.current)) {
          emit(isResume ? { username, sessionId: cookieSessionId } : { username });
        }
      });
      return;
    }
    emit(isResume ? { username, sessionId: cookieSessionId } : { username });
  }, [ensureSocket, phase, pendingUsername, cookieUsername, cookieSessionId, sessionInfo]);

  useEffect(() => {
    if (phase === "connecting") maybeInit();
  }, [phase, maybeInit]);

  useEffect(() => {
    if (pendingUsername && phase === "login") setPhase("connecting");
  }, [pendingUsername, phase]);

  // Workspace / terminal events
  useEffect(() => {
    const socket = ensureSocket();

    const onConnect = () => {
      if ((phase === "connecting" || phase === "reconnecting") && !initSentRef.current) {
        maybeInit();
      }
    };
    const onDisconnect = () => {
      if (phase === "ready") {
        setPhase("reconnecting");
        initSentRef.current = false;
      }
    };
    const onReady = async (payload) => {
      const now = performance.now();
      lastWorkspaceReadyTimeRef.current = now;
      lastTokenRef.current = payload.token;
      setSessionInfo(payload);
      setPhase("ready");
      setError("");
      await setSessionCookies(payload.sessionId, payload.user || payload.username);
      setCookieSessionId(payload.sessionId);
      setCookieUsername(payload.user || payload.username);
      if (pendingUsername) setPendingUsername("");
      initSentRef.current = true;
    };
    const onError = (msg) => {
      if (msg === "Invalid init request") {
        clearCookie("sessionId");
        clearCookie("username");
        setCookieSessionId("");
        setCookieUsername("");
        setSessionInfo(null);
        setPhase("login");
        setError("Session invalid or expired.");
        initSentRef.current = false;
        return;
      }
      setPhase("error");
      setError(msg || "Workspace unavailable.");
    };
    const onTermData = (data) => {
      setTerminalOutput((prev) => {
        if (prev.length > 6000) return [...prev.slice(-6000), data];
        return [...prev, data];
      });
      setTerminalDataCount((c) => c + 1);
    };
    const onTermExit = () => {
      setSessionInfo(null);
      setPhase("login");
      setError("Session terminated.");
      clearCookie("sessionId");
      clearCookie("username");
      setCookieSessionId("");
      setCookieUsername("");
      initSentRef.current = false;
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("workspace:ready", onReady);
    socket.on("workspace:error", onError);
    socket.on("terminal:data", onTermData);
    socket.on("terminal:exit", onTermExit);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("workspace:ready", onReady);
      socket.off("workspace:error", onError);
      socket.off("terminal:data", onTermData);
      socket.off("terminal:exit", onTermExit);
    };
  }, [ensureSocket, maybeInit, phase, pendingUsername]);

  // Simple file tree listener
  useEffect(() => {
    if (phase !== "ready" || !sessionInfo) return;
    const socket = socketRef.current;
    if (!socket) return;
    const handleSnapshot = (payload) => {
      setSimpleTree(payload);
    };
    registerSimpleTree(socket, { onSnapshot: handleSnapshot });
    return () => unregisterSimpleTree(socket, { onSnapshot: handleSnapshot });
  }, [phase, sessionInfo?.sessionId]);

  const handleOpenFile = useCallback((path) => {
    if (!openFiles.includes(path)) setOpenFiles((prev) => [...prev, path]);
    setActiveFile(path);
  }, [openFiles]);

  const handleLogout = useCallback(() => {
    clearCookie("sessionId");
    clearCookie("username");
    setCookieSessionId("");
    setCookieUsername("");
    setSessionInfo(null);
    setPhase("login");
    setError("");
    setPendingUsername("");
    setOpenFiles([]);
    setActiveFile("");
    setSimpleTree(null);
    setTerminalOutput([]);
    if (socketRef.current) {
      disconnectSocket();
      socketRef.current = null;
    }
    initSentRef.current = false;
  }, []);

  const handleUserCommand = useCallback(() => {}, []);

  const DebugPanel = () => {
    if (!showDebugPanel) {
      return (
        <div
          onClick={() => setShowDebugPanel(true)}
          style={{
            position: "fixed",
            bottom: 8,
            right: 8,
            background: "#263238",
            padding: "4px 8px",
            borderRadius: 4,
            fontSize: 10,
            cursor: "pointer",
            color: "#90caf9",
            opacity: 0.6,
            zIndex: 9999,
          }}
        >
          DBG
        </div>
      );
    }
    const socket = socketRef.current;
    return (
      <div
        style={{
          position: "fixed",
          bottom: 8,
          right: 8,
          background: "#111",
          color: "#eee",
          padding: "8px 10px",
          border: "1px solid #444",
          borderRadius: 6,
          fontSize: 11,
          maxWidth: 360,
          zIndex: 9999,
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <strong>Debug</strong>
          <button
            style={{ background: "#333", color: "#ccc", border: "none", cursor: "pointer", fontSize: 10 }}
            onClick={() => setShowDebugPanel(false)}
          >
            hide
          </button>
        </div>
        <div>phase: {phase}</div>
        <div>socket: {socket?.id || "∅"}</div>
        <div>connected: {String(socket?.connected)}</div>
        <div>initSent: {String(initSentRef.current)}</div>
        <div>tokenHash: {sessionInfo?.token ? shortHash(sessionInfo.token) : "∅"}</div>
        <div>treeVersion: {simpleTree?.version ?? "—"}</div>
        <div>treeChanged: {String(simpleTree?.changed)}</div>
        <div>openFiles: {openFiles.length}</div>
        <div>termChunks: {terminalDataCount}</div>
        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button
            style={{ background: "#424242", border: "none", color: "#eee", padding: "2px 6px", cursor: "pointer" }}
            onClick={() => setTerminalOutput([])}
          >
            Clear Term
          </button>
          <button
            style={{ background: "#424242", border: "none", color: "#eee", padding: "2px 6px", cursor: "pointer" }}
            onClick={() => socket?.emit("fs:treeSimple:resync")}
          >
            Resync Tree
          </button>
        </div>
        <div style={{ marginTop: 4, opacity: 0.7 }}>Ctrl+Shift+D toggle</div>
      </div>
    );
  };

  // Phase renders
  if (phase === "boot") {
    return (
      <>
        <div className="h-screen w-screen flex items-center justify-center bg-gray-900 text-white">
          Initializing...
        </div>
        <DebugPanel />
      </>
    );
  }
  if (phase === "login") {
    return (
      <>
        <Login
          setUsername={(name) => {
            setPendingUsername(name.trim());
          }}
        />
        <DebugPanel />
      </>
    );
  }
  if (phase === "connecting" || phase === "reconnecting") {
    return (
      <>
        <div className="h-screen w-screen flex items-center justify-center bg-gray-900 text-white">
          {phase === "connecting" ? "Connecting..." : "Reconnecting..."}
        </div>
        <DebugPanel />
      </>
    );
  }
  if (phase === "error") {
    return (
      <>
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-gray-900 text-white">
          <h2 className="text-xl mb-2">Error</h2>
          <p className="mb-3">{error}</p>
          <button
            className="px-4 py-2 bg-blue-600 rounded"
            onClick={handleLogout}
          >
            Back to Login
          </button>
        </div>
        <DebugPanel />
      </>
    );
  }

  // Ready
  return (
    <>
      <div className="h-screen w-screen flex flex-col bg-gray-900 text-white">
        <TopBar
          username={
            sessionInfo
              ? sessionInfo.user || sessionInfo.username || cookieUsername
              : ""
          }
          sessionInfo={sessionInfo}
          setSessionInfo={setSessionInfo}
          socketRef={socketRef}
          onLogout={handleLogout}
        />
        <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
          <Sidebar
            tree={simpleTree?.tree}
            onOpenFile={handleOpenFile}
            onResyncTree={() => socketRef.current?.emit("fs:treeSimple:resync")}
          />
          <div className="flex flex-1 flex-col min-h-0 min-w-0">
            <EditorTabs
              openFiles={openFiles}
              activeFile={activeFile}
              setActiveFile={setActiveFile}
              setOpenFiles={setOpenFiles}
            />
            <EditorPane
              activeFile={activeFile}
              openFiles={openFiles}
              setOpenFiles={setOpenFiles}
              socketRef={socketRef}
              sessionInfo={sessionInfo}
            />
          </div>
        </div>
        <Terminal
          terminalOutput={terminalOutput}
          sessionInfo={sessionInfo}
          socketRef={socketRef}
          connected={phase === "ready"}
          onUserCommand={handleUserCommand}
        />
        <StatusBar
          error={error}
          connected={phase === "ready"}
          sessionInfo={sessionInfo}
        />
      </div>
      <DebugPanel />
    </>
  );
}