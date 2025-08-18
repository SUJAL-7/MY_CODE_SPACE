import {
  useEffect,
  useRef,
  useCallback,
  useState
} from "react";
import Editor from "@monaco-editor/react";
import PropTypes from 'prop-types';

const AUTO_SAVE_DELAY = 1500; // ms

export default function EditorPane({
  activeFile,
  openFiles,
  setOpenFiles,
  socketRef,
  sessionInfo,
  fileMeta,
  setFileMeta
}) {
  const buffersRef = useRef(new Map());
  // buffer: { path, content, lastSavedContent, modelLanguage }

  const saveTimersRef = useRef(new Map()); // path -> timer id
  const pendingReadsRef = useRef(new Map()); // requestId -> path

  const socket = socketRef.current;
  const sessionId = sessionInfo?.sessionId;
  const token = sessionInfo?.token;

  // Track current editor file state (for value binding)
  const [editorValue, setEditorValue] = useState("");
  const [editorLanguage, setEditorLanguage] = useState("plaintext");
  const lastActiveFileRef = useRef("");

  /* ---------------- Helpers ---------------- */

  const updateFileMeta = useCallback((path, patch) => {
    setFileMeta((prev) => {
      const old = prev[path] || {};
      const next = { ...old, ...patch };
      return { ...prev, [path]: next };
    });
  }, [setFileMeta]);

  const ensureBufferLoaded = useCallback(
    (path) => {
      if (!path || !sessionId || !token || !socket) return;
      const existing = buffersRef.current.get(path);
      if (existing && existing.content != null) {
        return;
      }
      // Issue read
      const requestId = `read-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      pendingReadsRef.current.set(requestId, path);
      socket.emit("fs:read", {
        sessionId,
        token,
        path,
        requestId
      });
      updateFileMeta(path, { loading: true });
    },
    [sessionId, token, socket, updateFileMeta]
  );

  const guessLanguage = (p) => {
    if (!p) return "plaintext";
    const ext = p.split(".").pop().toLowerCase();
    switch (ext) {
      case "js":
      case "mjs":
      case "cjs":
        return "javascript";
      case "ts":
      case "tsx":
        return "typescript";
      case "json":
        return "json";
      case "md":
        return "markdown";
      case "css":
        return "css";
      case "html":
      case "htm":
        return "html";
      case "sh":
      case "bash":
        return "shell";
      case "py":
        return "python";
      case "java":
        return "java";
      case "c":
      case "h":
      case "cpp":
      case "cc":
      case "hpp":
        return "cpp";
      default:
        return "plaintext";
    }
  };

  const scheduleAutoSave = useCallback((path) => {
    if (!AUTO_SAVE_DELAY) return;
    const existing = saveTimersRef.current.get(path);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      saveTimersRef.current.delete(path);
      performSave(path);
    }, AUTO_SAVE_DELAY);
    saveTimersRef.current.set(path, t);
  }, []);

  const performSave = useCallback((path) => {
    if (!socket || !sessionId || !token) return;
    const buf = buffersRef.current.get(path);
    if (!buf) return;
    if (buf.lastSavedContent === buf.content) {
      updateFileMeta(path, { dirty: false, saving: false });
      return;
    }
    updateFileMeta(path, { saving: true, error: undefined });
    const requestId = `write-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    socket.emit("fs:write", {
      sessionId,
      token,
      path,
      content: buf.content,
      requestId
    });
  }, [socket, sessionId, token, updateFileMeta]);

  const closeFile = useCallback((path) => {
    // Remove from openFiles
    setOpenFiles((prev) => prev.filter((p) => p !== path));
    // cancel timers
    const t = saveTimersRef.current.get(path);
    if (t) {
      clearTimeout(t);
      saveTimersRef.current.delete(path);
    }
    // Keep bufferRef for possible reopen (or prune if you want)
  }, [setOpenFiles]);

  /* ---------------- Socket Listeners (read/write) ---------------- */

  useEffect(() => {
    if (!socket) return;

    const onReadResult = (msg) => {
      const { requestId, path, content } = msg;
      const mapped = pendingReadsRef.current.get(requestId);
      if (!mapped || mapped !== path) return;
      pendingReadsRef.current.delete(requestId);

      const lang = guessLanguage(path);
      const existing = buffersRef.current.get(path) || {};
      const next = {
        ...existing,
        path,
        content,
        lastSavedContent: content,
        modelLanguage: lang
      };
      buffersRef.current.set(path, next);
      updateFileMeta(path, {
        loading: false,
        dirty: false,
        saving: false,
        error: undefined
      });

      // If this is still active file, update editor view
      if (activeFile === path) {
        setEditorValue(content);
        setEditorLanguage(lang);
      }
    };

    const onFsError = (err) => {
      if (err.op === "read") {
        if (pendingReadsRef.current.has(err.requestId)) {
          const path = pendingReadsRef.current.get(err.requestId);
          pendingReadsRef.current.delete(err.requestId);
          updateFileMeta(path, {
            loading: false,
            error: err.message || "Read failed"
          });
        }
      } else if (err.op === "write") {
        // We rely on path field in error if available
        const path = err.path;
        if (path) {
          updateFileMeta(path, {
            saving: false,
            error: err.message || "Save failed"
          });
        }
      }
    };

    const onWriteResult = (msg) => {
      const { path } = msg;
      const buf = buffersRef.current.get(path);
      if (!buf) return;
      // mark saved
      buf.lastSavedContent = buf.content;
      updateFileMeta(path, { saving: false, dirty: false, error: undefined });
    };

    socket.on("fs:readResult", onReadResult);
    socket.on("fs:writeResult", onWriteResult);
    socket.on("fs:error", onFsError);

    return () => {
      socket.off("fs:readResult", onReadResult);
      socket.off("fs:writeResult", onWriteResult);
      socket.off("fs:error", onFsError);
    };
  }, [socket, activeFile, updateFileMeta]);

  /* ---------------- Load buffer when activeFile changes ---------------- */

  useEffect(() => {
    if (!activeFile) {
      setEditorValue("");
      return;
    }
    ensureBufferLoaded(activeFile);
    const buf = buffersRef.current.get(activeFile);
    if (buf && buf.content != null) {
      setEditorValue(buf.content);
      setEditorLanguage(buf.modelLanguage || guessLanguage(activeFile));
    } else {
      // show loading placeholder
      setEditorValue("// Loading...");
      setEditorLanguage(guessLanguage(activeFile));
    }
    lastActiveFileRef.current = activeFile;
  }, [activeFile, ensureBufferLoaded]);

  /* ---------------- Editor change handling ---------------- */

  const handleChange = useCallback((val) => {
    const path = activeFile;
    if (!path) return;
    const buf = buffersRef.current.get(path) || {
      path,
      content: "",
      lastSavedContent: "",
      modelLanguage: guessLanguage(path)
    };
    buf.content = val;
    buffersRef.current.set(path, buf);
    const dirty = buf.content !== buf.lastSavedContent;
    updateFileMeta(path, { dirty });
    scheduleAutoSave(path);
  }, [activeFile, scheduleAutoSave, updateFileMeta]);

  /* ---------------- Manual Save (Ctrl/Cmd+S) ---------------- */

  useEffect(() => {
    const key = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        if (activeFile) {
          e.preventDefault();
          performSave(activeFile);
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [activeFile, performSave]);

  /* ---------------- Clean up timers on unmount ---------------- */

  useEffect(() => {
    return () => {
      for (const [, t] of saveTimersRef.current.entries()) clearTimeout(t);
      saveTimersRef.current.clear();
    };
  }, []);

  /* ---------------- Render ---------------- */

  if (!openFiles.length) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500 bg-gray-900">
        Open a file from the sidebar.
      </div>
    );
  }

  const meta = activeFile ? fileMeta[activeFile] : null;

  return (
    <div className="flex flex-1 min-h-0 min-w-0 relative">
      {!activeFile && (
        <div className="m-auto text-gray-500 text-sm">No file selected</div>
      )}
      {activeFile && (
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          <div className="h-6 flex items-center px-3 text-xs bg-gray-800 border-b border-gray-700 select-none">
            <span className="truncate max-w-[60%]">{activeFile}</span>
            <span className="ml-3">
              {meta?.saving
                ? "Saving..."
                : meta?.error
                ? `Error: ${meta.error}`
                : meta?.dirty
                ? "Unsaved"
                : "Saved"}
            </span>
            <button
              onClick={() => performSave(activeFile)}
              className="ml-auto px-2 py-0.5 text-xs bg-blue-600 hover:bg-blue-500 rounded"
              disabled={meta?.saving || !meta?.dirty}
            >
              Save
            </button>
            <button
              onClick={() => closeFile(activeFile)}
              className="ml-2 px-2 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 rounded"
            >
              Close
            </button>
          </div>
          <div className="flex-1 min-h-0 min-w-0">
            <Editor
              key={activeFile} // ensures model path change
              path={activeFile}
              theme="vs-dark"
              language={editorLanguage}
              value={editorValue}
              onChange={handleChange}
              options={{
                fontSize: 14,
                minimap: { enabled: false },
                automaticLayout: true,
                scrollBeyondLastLine: false,
                tabSize: 2,
                wordWrap: "on",
              }}
              loading={<div className="p-4 text-xs text-gray-500">Loading editor...</div>}
            />
          </div>
        </div>
      )}
    </div>
  );
}


EditorPane.propTypes = {
  openFiles: PropTypes.arrayOf(PropTypes.string).isRequired,
  activeFile: PropTypes.string.isRequired,
  setOpenFiles: PropTypes.func.isRequired,
  socketRef: PropTypes.shape({
    current: PropTypes.shape({
      on: PropTypes.func.isRequired,
      off: PropTypes.func.isRequired,
      emit: PropTypes.func.isRequired,
    }).isRequired,
  }).isRequired,
  sessionInfo: PropTypes.shape({
    sessionId: PropTypes.string,
    token: PropTypes.string,
  }),
  fileMeta: PropTypes.object.isRequired,
  setFileMeta: PropTypes.func.isRequired,
};