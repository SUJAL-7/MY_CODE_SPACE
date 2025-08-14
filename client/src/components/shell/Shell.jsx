import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useLayoutEffect
} from "react";
import Terminal, { ColorMode, TerminalOutput } from "react-terminal-ui";
import { socket } from "../../socket/socket";
import "./shell.css";

function formatPromptPath(cwd) {
  if (!cwd || cwd === ".") return "~";
  return `~/${cwd}`;
}

const AUTO_SCROLL_THRESHOLD_PX = 40;

const Shell = ({ userLogin = "user" }) => {
  const [lines, setLines] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [socketId, setSocketId] = useState(null);
  const [currentDir, setCurrentDir] = useState(".");
  const [inputValue, setInputValue] = useState("");
  const [processing, setProcessing] = useState(false);

  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);

  const scrollRef = useRef(null);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const autoScrollRef = useRef(true); // whether we keep snapping to bottom

  const focusPrompt = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    focusPrompt();
  }, [focusPrompt, workspaceReady]);

  const isAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance < AUTO_SCROLL_THRESHOLD_PX;
  }, []);

  const scrollToBottom = useCallback(
    (smooth = true) => {
      if (!autoScrollRef.current) return;
      endRef.current?.scrollIntoView({
        behavior: smooth ? "smooth" : "auto",
        block: "end"
      });
    },
    []
  );

  useEffect(() => {
    scrollToBottom(lines.length < 80); // smoother for small batches
  }, [lines, scrollToBottom]);

  const handleScroll = () => {
    // If user scrolls away from bottom, pause autoscroll
    autoScrollRef.current = isAtBottom();
  };

  const appendLines = useCallback(
    (items) => setLines((prev) => [...prev, ...items]),
    []
  );

  const addOutputBlock = useCallback(
    (raw, colorClass) => {
      if (raw == null) return;
      const parts = raw.split(/\r?\n/);
      appendLines(
        parts.map((p, i) => (
          <TerminalOutput key={`out-${Date.now()}-${Math.random()}-${i}`}>
            {colorClass ? <span className={colorClass}>{p || " "}</span> : (p || " ")}
          </TerminalOutput>
        ))
      );
    },
    [appendLines]
  );

  const pushExecutedCommand = useCallback(
    (cmd, cwdAtExec) => {
      appendLines([
        <TerminalOutput key={`cmd-${Date.now()}-${Math.random()}`}>
          <span className="text-gray-400">
            [{userLogin}@IDE] {formatPromptPath(cwdAtExec)}${" "}
          </span>
          <span className="text-neutral-200 break-words">{cmd}</span>
        </TerminalOutput>
      ]);
    },
    [appendLines, userLogin]
  );

  const showHelp = useCallback(() => {
    const help = [
      ["Available commands:", "text-green-400"],
      ["  help               Show this help", "text-blue-400"],
      ["  ls [path]          List directory", "text-blue-400"],
      ["  pwd                Show current directory", "text-blue-400"],
      ["  cd [path]          Change directory (sandboxed)", "text-blue-400"],
      ["  cat <file>         Display file contents", "text-blue-400"],
      ["  touch <file>       Create empty file", "text-blue-400"],
      ["  mkdir <dir>        Create directory", "text-blue-400"],
      ["  rm <path>          Remove file or directory", "text-blue-400"],
      ["  run <lang> <file>  Execute file (node|python)", "text-blue-400"],
      ["  clear              Clear screen (client only)", "text-blue-400"],
      ["Notes:", "text-yellow-400"],
      ["  - Scrollable, scrollbar hidden.", "text-gray-400"],
      ["  - Wheel / touch scroll works.", "text-gray-400"],
      ["  - Auto-scroll resumes when you reach bottom.", "text-gray-400"]
    ];
    appendLines(
      help.map(([t, c]) => (
        <TerminalOutput key={`help-${t}`}>
          <span className={c}>{t}</span>
        </TerminalOutput>
      ))
    );
  }, [appendLines]);

  // Socket events
  useEffect(() => {
    const handleConnect = () => {
      setIsConnected(true);
      socket.emit("join-user-workspace", userLogin);
    };
    const handleDisconnect = () => {
      setIsConnected(false);
      setWorkspaceReady(false);
      setSocketId(null);
      setCurrentDir(".");
      addOutputBlock("Disconnected from server", "text-rose-500");
    };
    const handleWorkspaceReady = (data) => {
      setWorkspaceReady(true);
      setSocketId(data.socketId);
      setCurrentDir(".");
      appendLines([
        <TerminalOutput key="welcome-1">
          <span className="text-emerald-400">
            Workspace ready for {data.userLogin}
          </span>
        </TerminalOutput>,
        <TerminalOutput key="welcome-2">
          <span className="text-blue-400">Root: {data.userDir}</span>
        </TerminalOutput>,
        <TerminalOutput key="welcome-3">
          <span className="text-yellow-400">
            Connected: {new Date(data.connectedAt).toLocaleString()}
          </span>
        </TerminalOutput>,
        <TerminalOutput key="welcome-4">
          <span className="text-gray-400">
            Type 'help' for commands. Current dir: {formatPromptPath(".")}
          </span>
        </TerminalOutput>
      ]);
    };
    const handleSuccessOutput = (data) => addOutputBlock(data);
    const handleErrorOutput = (data) => addOutputBlock(data, "text-rose-500");
    const handleFileChanged = (data) =>
      appendLines([
        <TerminalOutput key={`file-${Date.now()}-${Math.random()}`}>
          <span className="text-cyan-400">
            File {data.type}: {data.path}
          </span>
        </TerminalOutput>
      ]);
    const handleGenericError = (err) =>
      addOutputBlock(`Error: ${err?.message || err}`, "text-rose-500");
    const handleCwdUpdate = ({ cwd }) => setCurrentDir(cwd || ".");

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("workspace-ready", handleWorkspaceReady);
    socket.on("output-success", handleSuccessOutput);
    socket.on("output-error", handleErrorOutput);
    socket.on("fileChanged", handleFileChanged);
    socket.on("error", handleGenericError);
    socket.on("cwd-update", handleCwdUpdate);

    if (socket.connected) handleConnect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("workspace-ready", handleWorkspaceReady);
      socket.off("output-success", handleSuccessOutput);
      socket.off("output-error", handleErrorOutput);
      socket.off("fileChanged", handleFileChanged);
      socket.off("error", handleGenericError);
      socket.off("cwd-update", handleCwdUpdate);
    };
  }, [userLogin, appendLines, addOutputBlock]);

  // Execute command
  const executeCommand = useCallback(
    (command) => {
      const trimmed = command.trimEnd();
      pushExecutedCommand(trimmed, currentDir);

      if (!trimmed.length) return;

      historyRef.current.push(trimmed);
      historyIndexRef.current = historyRef.current.length;

      if (trimmed === "clear") {
        setLines([]);
        return;
      }
      if (trimmed === "help") {
        showHelp();
        return;
      }
      if (!workspaceReady) {
        addOutputBlock("Workspace not ready yet...", "text-yellow-400");
        return;
      }

      setProcessing(true);
      socket.emit("input", trimmed);
      setTimeout(() => setProcessing(false), 10);
    },
    [currentDir, pushExecutedCommand, workspaceReady, showHelp, addOutputBlock]
  );

  // Prompt key handling
  const handleKeyDown = (e) => {
    if (processing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      const cmd = inputValue;
      setInputValue("");
      // Ensure we re-enable autoscroll after each command
      autoScrollRef.current = true;
      executeCommand(cmd);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!historyRef.current.length) return;
      if (historyIndexRef.current > 0) historyIndexRef.current -= 1;
      else historyIndexRef.current = 0;
      setInputValue(historyRef.current[historyIndexRef.current]);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!historyRef.current.length) return;
      if (historyIndexRef.current < historyRef.current.length - 1) {
        historyIndexRef.current += 1;
        setInputValue(historyRef.current[historyIndexRef.current]);
      } else {
        historyIndexRef.current = historyRef.current.length;
        setInputValue("");
      }
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      setLines([]);
      setInputValue("");
      autoScrollRef.current = true;
      return;
    }
  };

  const clickTranscript = (e) => {
    if (e.target.closest(".terminal-quick-actions")) return;
    focusPrompt();
  };

  const resumeAutoScroll = () => {
    autoScrollRef.current = true;
    scrollToBottom(false);
    focusPrompt();
  };

  const status = !isConnected
    ? { text: "Disconnected", color: "text-rose-500", border: "border-rose-500", dot: "bg-rose-500" }
    : !workspaceReady
    ? { text: "Initializing...", color: "text-yellow-500", border: "border-yellow-500", dot: "bg-yellow-500" }
    : { text: "Ready", color: "text-emerald-400", border: "border-emerald-400", dot: "bg-emerald-400" };

  return (
    <div className="w-full h-full bg-[#252a33] relative font-mono select-text container">
      {/* Scrollable transcript (scrollbar hidden via CSS) */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onClick={clickTranscript}
        className="terminal-scroll absolute inset-0 pb-16 overflow-y-auto overflow-x-hidden overscroll-contain"
      >
        <Terminal
          name={`Sandbox Terminal (${userLogin})`}
          colorMode={ColorMode.Dark}
        >
          {lines}
          <div ref={endRef} />
        </Terminal>
      </div>

      {/* Live prompt */}
      <div
        className="absolute left-0 right-0 bottom-0 px-3 pb-2 pt-1 bg-[#252a33] border-t border-[#303642] shadow-inner"
        onClick={focusPrompt}
      >
        <div className="flex items-start gap-1 text-sm text-neutral-200 flex-wrap">
          <span className="shrink-0 text-gray-400 break-all">
            [{userLogin}@IDE] {formatPromptPath(currentDir)}$
          </span>
          <input
            ref={inputRef}
            className="flex-1 bg-transparent outline-none border-none text-neutral-100 caret-emerald-400 font-mono placeholder:text-neutral-600 min-w-[140px]"
            type="text"
            spellCheck={false}
            autoComplete="off"
            disabled={!workspaceReady || !isConnected}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              !isConnected
                ? "disconnected"
                : !workspaceReady
                ? "initializing..."
                : ""
            }
            style={{ wordBreak: "break-word" }}
          />
        </div>
        {!autoScrollRef.current && (
          <div
            className="mt-1 text-[10px] text-yellow-400 cursor-pointer"
            onClick={resumeAutoScroll}
          >
            Auto-scroll paused – click to resume
          </div>
        )}
      </div>

      {/* Status badge */}
      <div
        className={`absolute flex flex-row justify-center items-center gap-1 ${status.color} text-xs font-medium top-2 right-2 px-3 py-1 border rounded-full ${status.border}`}
      >
        <div className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
        {status.text}
      </div>

      {/* User badge */}
      <div className="absolute top-2 left-2 px-3 py-1 bg-[#1a1f28] border border-gray-600 rounded-full text-xs font-medium text-cyan-400">
        {userLogin}
        {socketId && <span className="text-gray-500"> ({socketId.slice(0, 6)})</span>}
      </div>

      {/* Current directory badge */}
      <div className="absolute bottom-20 left-2 px-2 py-1 bg-red-900/40 border border-red-500/60 rounded text-xs text-red-300">
        {formatPromptPath(currentDir)}
      </div>

      {/* Quick action buttons */}
      {workspaceReady && (
        <div className="terminal-quick-actions absolute bottom-20 right-2 flex gap-2">
          <button
            onClick={() => executeCommand("ls")}
            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
          >
            ls
          </button>
          <button
            onClick={() => executeCommand("pwd")}
            className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded transition-colors"
          >
            pwd
          </button>
          <button
            onClick={() => executeCommand("help")}
            className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded transition-colors"
          >
            help
          </button>
          <button
            onClick={() => {
              setLines([]);
              setInputValue("");
              autoScrollRef.current = true;
              focusPrompt();
            }}
            className="px-2 py-1 bg-gray-600 hover:bg-gray-700 text-white text-xs rounded transition-colors"
          >
            clear
          </button>
        </div>
      )}
    </div>
  );
};

export default Shell;