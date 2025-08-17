import React, { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import { SearchAddon } from "xterm-addon-search";
import "xterm/css/xterm.css";
import { socket } from "../../socket/socket";

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/**
 * Pure terminal component (no embedded file explorer).
 * Emits session info upward via onSessionInfo once ready / changes.
 */
export default function TerminalView({ username, onSessionInfo }) {
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const searchRef = useRef(null);
  const containerRef = useRef(null);

  const sessionRef = useRef({ sessionId: null, token: null, ready: false });
  const [status, setStatus] = useState("connecting");
  const [errorMsg, setErrorMsg] = useState("");

  const statsSubscribedRef = useRef(false);
  const pendingSizeRef = useRef({ cols: 80, rows: 24 });

  // Initialize terminal
  useEffect(() => {
    const term = new Terminal({
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      scrollback: 5000,
      cursorBlink: true,
      convertEol: false,
      allowProposedApi: true,
      theme: { background: "#1e1e1e", foreground: "#cccccc", cursor: "#ffffff" }
    });
    const fit = new FitAddon();
    const links = new WebLinksAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.loadAddon(search);
    term.open(containerRef.current);
    fit.fit();
    term.write("Connecting...\r\n");
    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;
    return () => term.dispose();
  }, []);

  // Request workspace
  useEffect(() => {
    const effective = (username || "user").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 32) || "user";
    socket.emit("workspace:init", { username: effective });
  }, [username]);

  function emitWithSession(event, payload) {
    const { sessionId, token, ready } = sessionRef.current;
    if (!ready) return;
    socket.emit(event, { ...payload, sessionId, token });
  }

  // Socket listeners
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const propagate = (info) => {
      onSessionInfo?.(info);
    };

    const onReady = info => {
      sessionRef.current = { sessionId: info.sessionId, token: info.token, ready: true };
      setStatus("ready");
      propagate({
        sessionId: info.sessionId,
        token: info.token,
        ready: true,
        baseImage: info.baseImage
      });
      // Resize once ready
      emitWithSession("terminal:resize", pendingSizeRef.current);
      if (!statsSubscribedRef.current) {
        emitWithSession("stats:subscribe", {});
        statsSubscribedRef.current = true;
      }
    };

    const onData = d => {
      term.write(d.replace(/\uFFFD/g, ""));
    };

    const onError = msg => {
      setStatus("error");
      setErrorMsg(msg);
      term.write(`\r\n[workspace error] ${msg}\r\n`);
      sessionRef.current.ready = false;
      propagate({ ...sessionRef.current });
    };

    const onExit = ({ code }) => {
      term.write(`\r\n[session exited code=${code}]\r\n`);
      setStatus("exited");
      sessionRef.current.ready = false;
      propagate({ ...sessionRef.current });
    };

    const onDisconnect = reason => {
      if (status !== "error" && status !== "exited") {
        term.write(`\r\n[disconnected: ${reason}]\r\n`);
        setStatus("disconnected");
      }
      sessionRef.current.ready = false;
      propagate({ ...sessionRef.current });
    };

    socket.on("workspace:ready", onReady);
    socket.on("terminal:data", onData);
    socket.on("workspace:error", onError);
    socket.on("terminal:exit", onExit);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("workspace:ready", onReady);
      socket.off("terminal:data", onData);
      socket.off("workspace:error", onError);
      socket.off("terminal:exit", onExit);
      socket.off("disconnect", onDisconnect);
    };
  }, [status, onSessionInfo]);

  // Terminal input
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const disp = term.onData(data => {
      if (sessionRef.current.ready) {
        emitWithSession("terminal:input", { data });
      }
    });
    return () => disp.dispose();
  }, []);

  // Resize handling
  const refit = useCallback(
    debounce(() => {
      if (!termRef.current || !fitRef.current) return;
      try {
        fitRef.current.fit();
        const dims = { cols: termRef.current.cols, rows: termRef.current.rows };
        pendingSizeRef.current = dims;
        emitWithSession("terminal:resize", dims);
      } catch (error) {
        console.error("Resize error:", error);
      }
    }, 100),
    []
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(refit);
    ro.observe(containerRef.current);
    window.addEventListener("resize", refit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", refit);
    };
  }, [refit]);

  const killSession = () => {
    if (!sessionRef.current.ready) return;
    emitWithSession("terminal:kill", {});
  };

  const resetSession = () => {
    window.location.reload();
  };

  return (
    <div className="flex flex-col w-full h-full bg-[#1e1e1e]">
      <div className="flex items-center gap-2 px-2 py-1 bg-[#222] border-b border-neutral-700 text-xs text-neutral-200">
        <span className="font-mono">Terminal</span>
        <span className="px-2 py-[2px] rounded bg-neutral-600">{status.toUpperCase()}</span>
        <div className="ml-auto flex gap-1">
          {status === "ready" && (
            <>
              <button
                onClick={() => termRef.current?.clear()}
                className="px-2 py-[3px] bg-neutral-600 hover:bg-neutral-500 rounded text-[11px]"
              >
                Clear
              </button>
              <button
                onClick={killSession}
                className="px-2 py-[3px] bg-red-600 hover:bg-red-700 rounded text-[11px]"
              >
                Kill
              </button>
            </>
          )}
          <button
            onClick={resetSession}
            className="px-2 py-[3px] bg-neutral-700 hover:bg-neutral-600 rounded text-[11px]"
          >
            Reset
          </button>
        </div>
      </div>
      {errorMsg && (
        <div className="px-3 py-2 bg-[#2a1f1f] text-red-400 border-b border-red-700 text-xs font-mono">
          ERROR: {errorMsg}
        </div>
      )}
      <div ref={containerRef} className="flex-1 overflow-hidden" />
    </div>
  );
}