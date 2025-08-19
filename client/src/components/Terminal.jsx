import { useRef, useEffect } from "react";
import PropTypes from "prop-types";
import { Terminal as XTerm } from "xterm";
import { FiTerminal, FiAlertCircle, FiCheckCircle } from "react-icons/fi";
// import { TfiPlug } from "react-icons/tfi";
import "xterm/css/xterm.css";

/**
 * Terminal component using xterm.js with modern IDE styling.
 * Automatically scrolls to the bottom after each output update.
 */
export default function Terminal({
  terminalOutput,
  sessionInfo,
  socketRef,
  connected,
  onUserCommand,
}) {
  const containerRef = useRef(null);
  const xtermRef = useRef(null);
  const lastIdxRef = useRef(0);
  const sessionIdRef = useRef(null);
  const tokenRef = useRef(null);

  // Keep latest creds
  useEffect(() => {
    if (sessionInfo?.sessionId) sessionIdRef.current = sessionInfo.sessionId;
    if (sessionInfo?.token) tokenRef.current = sessionInfo.token;
  }, [sessionInfo]);

  // Init terminal per session
  useEffect(() => {
    if (!sessionInfo?.sessionId || !sessionInfo?.token) return;
    if (xtermRef.current && sessionIdRef.current === sessionInfo.sessionId) return;

    if (xtermRef.current && sessionIdRef.current !== sessionInfo.sessionId) {
      try { xtermRef.current.dispose(); } catch (error) {
        console.log("Error disposing terminal:", error);
      }
      xtermRef.current = null;
      lastIdxRef.current = 0;
    }

    const term = new XTerm({
      theme: {
        background: "#1e1e1e",
        foreground: "#cccccc",
        cursor: "#4ec9b0",
        cursorAccent: "#4ec9b0",
        selection: "#264f78",
        selectionForeground: "#ffffff",
        black: "#000000",
        red: "#f48771",
        green: "#4ec9b0",
        yellow: "#dcdcaa",
        blue: "#9cdcfe",
        magenta: "#c586c0",
        cyan: "#4ec9b0",
        white: "#d4d4d4",
        brightBlack: "#6e7681",
        brightRed: "#f48771",
        brightGreen: "#4ec9b0",
        brightYellow: "#dcdcaa",
        brightBlue: "#9cdcfe",
        brightMagenta: "#c586c0",
        brightCyan: "#4ec9b0",
        brightWhite: "#ffffff"
      },
      fontFamily: "Fira Code, Fira Mono, Consolas, Monaco, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: true,
      scrollback: 10000,
      rendererType: "canvas",
      windowsMode: false,
      convertEol: true,
    });

    term.open(containerRef.current);
    term.focus();

    term.onData((data) => {
      const sId = sessionIdRef.current;
      const tok = tokenRef.current;
      if (socketRef.current && sId && tok) {
        socketRef.current.emit("terminal:input", { sessionId: sId, token: tok, data });
      }
      if (data === "\r" && typeof onUserCommand === "function") {
        onUserCommand();
      }
    });

    xtermRef.current = term;
    sessionIdRef.current = sessionInfo.sessionId;
    tokenRef.current = sessionInfo.token;

    return () => {
      if (xtermRef.current === term) {
        try { term.dispose(); } catch (error) {
          console.log("Error disposing terminal:", error);
        }
        xtermRef.current = null;
      }
    };
  }, [sessionInfo?.sessionId, sessionInfo?.token, socketRef, onUserCommand]);

  // Write output and scroll to bottom
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    for (let i = lastIdxRef.current; i < terminalOutput.length; i++) {
      term.write(terminalOutput[i]);
    }
    lastIdxRef.current = terminalOutput.length;

    // Scroll to the bottom after writing output
    Promise.resolve().then(() => {
      try {
        term.scrollToBottom();
      } catch (e) {
        console.log("Error scrolling to bottom:", e);
      }
    });
  }, [terminalOutput]);

  return (
    <div className="flex flex-col h-60 bg-[#1e1e1e] border-t border-[#3e3e42]">
      {/* Terminal Header */}
      <div
        className="flex items-center justify-between px-4 h-8 select-none bg-[#252526] border-b border-[#3e3e42] cursor-pointer group"
        onClick={() => xtermRef.current && xtermRef.current.focus()}
        tabIndex={0}
        title="Focus terminal"
      >
        <div className="flex items-center gap-2">
          <FiTerminal className="w-3.5 h-3.5 text-[#4ec9b0]" />
          <span className="text-sm font-medium text-[#cccccc] tracking-tight">
            Terminal
          </span>
          <span className="text-xs text-[#858585] font-mono ml-1">
            {(sessionInfo?.user || sessionInfo?.username || "user")}@devspace
          </span>
        </div>
        
        <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded ${
          connected
            ? "bg-[#4ec9b01a] text-[#4ec9b0]"
            : "bg-[#f487711a] text-[#f48771]"
        }`}>
          {connected ? <FiCheckCircle className="w-3 h-3" /> : <FiAlertCircle className="w-3 h-3" />}
          <span className="font-medium">{connected ? "Connected" : "Disconnected"}</span>
        </div>
      </div>
      
      {/* Terminal Content */}
      <div
        ref={containerRef}
        className="flex-1 focus:outline-none h-16 overflow-scroll font-mono"
        tabIndex={0}
        onClick={() => xtermRef.current && xtermRef.current.focus()}
      />
    </div>
  );
}

Terminal.propTypes = {
  terminalOutput: PropTypes.arrayOf(PropTypes.string).isRequired,
  sessionInfo: PropTypes.shape({
    sessionId: PropTypes.string,
    token: PropTypes.string,
    user: PropTypes.string,
    username: PropTypes.string,
  }),
  socketRef: PropTypes.object.isRequired,
  connected: PropTypes.bool.isRequired,
  onUserCommand: PropTypes.func,
};