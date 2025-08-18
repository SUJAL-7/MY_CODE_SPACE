import { useRef, useEffect } from "react";
import { Terminal as XTerm } from "xterm";
import PropTypes from "prop-types";
import "xterm/css/xterm.css";

export default function Terminal({
  terminalOutput,
  sessionInfo,
  socketRef,
  connected,
  onUserCommand, // NEW: callback when user presses Enter
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
      try { xtermRef.current.dispose(); } catch (error) { console.error("Error disposing terminal:", error); }
      xtermRef.current = null;
      lastIdxRef.current = 0;
    }

    const term = new XTerm({
      theme: { background: "#222426", foreground: "#CCCCCC", cursor: "#FFA500" },
      fontFamily: "Ubuntu Mono, Menlo, monospace",
      fontSize: 16,
      cursorBlink: true,
      scrollback: 8000,
    });

    term.open(containerRef.current);
    term.focus();

    term.onData((data) => {
      const sId = sessionIdRef.current;
      const tok = tokenRef.current;
      if (socketRef.current && sId && tok) {
        socketRef.current.emit("terminal:input", { sessionId: sId, token: tok, data });
      }
      // Detect Enter (carriage return) to signal a user command boundary.
      if (data === "\r" && typeof onUserCommand === "function") {
        onUserCommand();
      }
    });

    xtermRef.current = term;
    sessionIdRef.current = sessionInfo.sessionId;
    tokenRef.current = sessionInfo.token;

    return () => {
      if (xtermRef.current === term) {
        try { term.dispose(); } catch (error) { console.error("Error disposing terminal:", error); }
        xtermRef.current = null;
      }
    };
  }, [sessionInfo?.sessionId, sessionInfo?.token, socketRef, onUserCommand]);

  // Append output
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    for (let i = lastIdxRef.current; i < terminalOutput.length; i++) {
      term.write(terminalOutput[i]);
    }
    lastIdxRef.current = terminalOutput.length;
  }, [terminalOutput]);

  return (
    <div style={{
      height: "30%",
      display: "flex",
      flexDirection: "column",
      background: "#222426",
      borderTop: "2px solid #333",
      fontFamily: "Ubuntu Mono, Menlo, monospace",
    }}>
      <div
        style={{
          height: 28,
          background: "#2C001E",
          display: "flex",
          alignItems: "center",
          paddingLeft: 12,
          fontSize: 13,
          fontWeight: 600,
          color: "#ccc",
          borderBottom: "1px solid #333",
          userSelect: "none",
        }}
        onClick={() => xtermRef.current && xtermRef.current.focus()}
      >
        {(sessionInfo?.user || sessionInfo?.username || "user")}@devspace {connected ? "" : "(disconnected)"}
      </div>
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: "scroll" }}
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
