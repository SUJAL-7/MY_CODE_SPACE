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
  import.meta.env.VITE_REACT_APP_SERVER_URL || "http://3.108.254.28:8080";

  // const SERVER_URL = "http://localhost:8080";

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
  } catch (error) {
    console.error("Error setting session cookies:", error);
  }
}

export default function App() {
  const [phase, setPhase] = useState("boot");
  const [sessionInfo, setSessionInfo] = useState(null);
  const [error, setError] = useState("");
  const [pendingUsername, setPendingUsername] = useState("");

  const [simpleTree, setSimpleTree] = useState(null);
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFile, setActiveFile] = useState("");
  const [terminalOutput, setTerminalOutput] = useState([]);
  const [fileMeta, setFileMeta] = useState({});

  const socketRef = useRef(null);
  const initSentRef = useRef(false);
  const phaseRef = useRef(phase);

  const [cookieUsername, setCookieUsername] = useState("");
  const [cookieSessionId, setCookieSessionId] = useState("");

  // VSCode-like UI toggles
  const [showSidebar, setShowSidebar] = useState(true);
  const [showTerminal, setShowTerminal] = useState(true);

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
      // Sidebar toggle (Ctrl+B / Cmd+B)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyB") {
        setShowSidebar((v) => !v);
        e.preventDefault();
      }
      // Terminal toggle (Ctrl+`)
      if ((e.ctrlKey || e.metaKey) && e.code === "Backquote") {
        setShowTerminal((v) => !v);
        e.preventDefault();
      }
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
    if (initSentRef.current) return;

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
    setFileMeta({});
    if (socketRef.current) {
      disconnectSocket();
      socketRef.current = null;
    }
    initSentRef.current = false;
  }, []);

  const handleUserCommand = useCallback(() => {}, []);

  // ---- PHASE RENDERS ----

  if (phase === "boot") {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#1e1e1e] text-[#cccccc]">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#4ec9b0] mb-4"></div>
          <span className="text-lg tracking-wider font-medium">Initializing workspace...</span>
        </div>
      </div>
    );
  }

  if (phase === "login") {
    return (
      <div className="h-screen w-screen bg-[#1e1e1e]">
        <Login setUsername={(name) => setPendingUsername(name.trim())} />
      </div>
    );
  }

  if (phase === "connecting" || phase === "reconnecting") {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#1e1e1e] text-[#cccccc]">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#4ec9b0] mb-4"></div>
          <span className="text-lg tracking-wider font-medium">
            {phase === "connecting" ? "Connecting to workspace..." : "Reconnecting..."}
          </span>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#1e1e1e] text-[#cccccc]">
        <div className="flex flex-col items-center max-w-md p-6 bg-[#252526] rounded-lg border border-[#3e3e42]">
          <div className="mb-4 text-xl font-semibold text-[#f48771]">Connection Error</div>
          <div className="mb-6 text-center text-[#cccccc]">{error}</div>
          <button
            className="px-5 py-2 rounded bg-[#0e639c] hover:bg-[#1177bb] transition-colors text-white font-medium"
            onClick={handleLogout}
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  // ---- MAIN STRUCTURED LAYOUT ----

  return (
    <div className="h-screen w-screen flex flex-col bg-[#1e1e1e] text-[#cccccc] font-[inherit] overflow-hidden">
      {/* TopBar */}
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

      {/* Main Layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Activity Bar */}
        <div className="flex flex-col items-center bg-[#333333] w-12 py-2 flex-shrink-0 border-r border-[#3e3e42]">
          <button
            className={`mb-3 p-2 rounded transition-colors ${
              showSidebar 
                ? "bg-[#007acc] text-white" 
                : "text-[#858585] hover:text-[#cccccc] hover:bg-[#3e3e42]"
            }`}
            title="Explorer (Ctrl+B)"
            onClick={() => setShowSidebar((v) => !v)}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
            </svg>
          </button>
          
          <button
            className={`p-2 rounded transition-colors ${
              showTerminal 
                ? "bg-[#007acc] text-white" 
                : "text-[#858585] hover:text-[#cccccc] hover:bg-[#3e3e42]"
            }`}
            title="Terminal (Ctrl+`)"
            onClick={() => setShowTerminal((v) => !v)}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </button>
        </div>

        {/* Sidebar */}
        {showSidebar && (
          <div className="w-64 bg-[#252526] border-r border-[#3e3e42] flex flex-col">
            <Sidebar
              tree={simpleTree?.tree}
              onOpenFile={handleOpenFile}
              onResyncTree={() => socketRef.current?.emit("fs:treeSimple:resync")}
            />
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex flex-col flex-1 min-h-96 min-w-0 bg-[#1e1e1e] overflow-auto scroll-m-0 ">
          {/* Editor Tabs */}
          {openFiles.length > 0 && (
            <div className="h-9 bg-[#2d2d30] border-b border-[#3e3e42]">
              <EditorTabs
                openFiles={openFiles}
                activeFile={activeFile}
                setActiveFile={setActiveFile}
                setOpenFiles={setOpenFiles}
                fileMeta={fileMeta}
              />
            </div>
          )}
          
          {/* Editor Content */}
          <div className="flex-1 min-h-96 overflow-auto">
            <EditorPane
              activeFile={activeFile}
              openFiles={openFiles}
              setOpenFiles={setOpenFiles}
              socketRef={socketRef}
              sessionInfo={sessionInfo}
              fileMeta={fileMeta}
              setFileMeta={setFileMeta}
            />
          </div>
          
          {/* Terminal Panel */}
          {showTerminal && (
            <div className="h-60 border-t border-[#3e3e42] bg-[#1e1e1e]">
              <Terminal
                terminalOutput={terminalOutput}
                sessionInfo={sessionInfo}
                socketRef={socketRef}
                connected={phase === "ready"}
                onUserCommand={handleUserCommand}
              />
            </div>
          )}
        </div>
      </div>

      {/* Status Bar */}
      <StatusBar
        error={error}
        connected={phase === "ready"}
        sessionInfo={sessionInfo}
      />
    </div>
  );
}