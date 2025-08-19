import {
  useEffect,
  useRef,
  useCallback,
  useState
} from "react";
import Editor from "@monaco-editor/react";
import PropTypes from 'prop-types';
import { FiSave, FiX, FiAlertCircle, FiCheckCircle, FiEdit3 } from "react-icons/fi";

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
  const saveTimersRef = useRef(new Map());
  const pendingReadsRef = useRef(new Map());

  const socket = socketRef.current;
  const sessionId = sessionInfo?.sessionId;
  const token = sessionInfo?.token;

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
      case "go":
        return "go";
      case "rs":
        return "rust";
      case "php":
        return "php";
      case "rb":
        return "ruby";
      case "xml":
        return "xml";
      case "yaml":
      case "yml":
        return "yaml";
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
    setOpenFiles((prev) => prev.filter((p) => p !== path));
    const t = saveTimersRef.current.get(path);
    if (t) {
      clearTimeout(t);
      saveTimersRef.current.delete(path);
    }
  }, [setOpenFiles]);

  /* ---------------- Socket Listeners ---------------- */

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
    setEditorValue(val);
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
      <div className="flex flex-1 items-center justify-center text-sm text-[#858585] bg-[#1e1e1e]">
        Open a file from the sidebar to start editing.
      </div>
    );
  }

  const meta = activeFile ? fileMeta[activeFile] : null;

  return (
    <div className="flex flex-1 min-h-96 min-w-0 relative bg-[#1e1e1e] overflow-y-scroll">
      {!activeFile && (
        <div className="m-auto text-[#858585] text-sm">Select a file to edit</div>
      )}
      {activeFile && (
        <div className="flex flex-col flex-1 min-h-96 min-w-0 overflow-y-auto">
          {/* Editor Header */}
          <div className="h-8 flex items-center px-4 text-xs bg-[#2d2d30] border-b border-[#3e3e42] select-none gap-3">
            <span className="truncate max-w-[50%] text-[#cccccc] flex items-center gap-2">
              <FiEdit3 className="text-[#4ec9b0] w-3.5 h-3.5 flex-shrink-0" /> 
              <span className="truncate font-medium text-[13px]">{activeFile}</span>
            </span>
            
            <span className="flex items-center gap-1.5 text-[11px] font-medium">
              {meta?.saving ? (
                <>
                  <FiSave className="text-[#ffcc66] animate-pulse w-3.5 h-3.5" />
                  <span className="text-[#ffcc66]">Saving...</span>
                </>
              ) : meta?.error ? (
                <>
                  <FiAlertCircle className="text-[#f48771] w-3.5 h-3.5" />
                  <span className="text-[#f48771]">{meta.error}</span>
                </>
              ) : meta?.dirty ? (
                <>
                  <FiSave className="text-[#ffcc66] w-3.5 h-3.5" />
                  <span className="text-[#ffcc66]">Unsaved</span>
                </>
              ) : (
                <>
                  <FiCheckCircle className="text-[#4ec9b0] w-3.5 h-3.5" />
                  <span className="text-[#4ec9b0]">Saved</span>
                </>
              )}
            </span>
            
            <div className="flex-1" />
            
            <button
              onClick={() => performSave(activeFile)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors border ${
                meta?.saving || !meta?.dirty
                  ? "bg-[#3a3d41] text-[#858585] border-[#4f5256] cursor-not-allowed"
                  : "bg-[#0e639c] hover:bg-[#1177bb] text-white border-[#0a4d78]"
              }`}
              disabled={meta?.saving || !meta?.dirty}
              title="Save (Ctrl+S)"
            >
              <FiSave className="w-3 h-3" /> Save
            </button>
            
            <button
              onClick={() => closeFile(activeFile)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded bg-[#3a3d41] hover:bg-[#45494e] text-[#cccccc] border border-[#4f5256] transition-colors"
              title="Close file"
            >
              <FiX className="w-3 h-3" /> Close
            </button>
          </div>
          
          {/* Monaco Editor */}
          <div className="flex-1 min-h-96 min-w-0 overflow-y-scroll">
            <Editor
              key={activeFile}
              path={activeFile}
              theme="vs-dark"
              language={editorLanguage}
              value={editorValue}
              onChange={handleChange}
              options={{
                fontFamily: "'Fira Code', 'Fira Mono', Consolas, 'Courier New', monospace",
                minimap: { enabled: false },
                automaticLayout: true,
                scrollBeyondLastLine: false,
                wordWrap: "on",
                lineNumbers: "on",
                glyphMargin: true,
                folding: true,
                lineDecorationsWidth: 12,
                renderLineHighlight: 'all',
                matchBrackets: 'always',
                autoClosingBrackets: 'always',
                autoIndent: 'full',
                suggestOnTriggerCharacters: true,
                wordBasedSuggestions: true,
                parameterHints: { enabled: true },
                cursorBlinking: 'blink',
                cursorSmoothCaretAnimation: 'on',
                cursorStyle: 'line',
                cursorWidth: 2,
                smoothScrolling: true,
                mouseWheelZoom: true,
                accessibilitySupport: 'on'
              }}
              loading={
                <div className="flex items-center justify-center h-full bg-[#1e1e1e]">
                  <div className="text-[#858585] text-sm flex items-center gap-2">
                    <div className="w-3 h-3 border-2 border-[#4ec9b0] border-t-transparent rounded-full animate-spin"></div>
                    Loading editor...
                  </div>
                </div>
              }
              onMount={(editor, monaco) => {
                // Configure editor theme for better visibility
                monaco.editor.defineTheme('custom-dark', {
                  base: 'vs-dark',
                  inherit: true,
                  rules: [
                    { token: '', foreground: 'cccccc', background: '1e1e1e' },
                    { token: 'comment', foreground: '6A9955' },
                  ],
                  colors: {
                    'editor.background': '#1e1e1e',
                    'editor.foreground': '#cccccc',
                    'editor.lineHighlightBackground': '#2d2d30',
                    'editorCursor.foreground': '#4ec9b0',
                    'editor.selectionBackground': '#264f78',
                    'editor.inactiveSelectionBackground': '#3a3d41',
                  }
                });
                monaco.editor.setTheme('custom-dark');
              }}
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
    current: PropTypes.object,
  }).isRequired,
  sessionInfo: PropTypes.shape({
    sessionId: PropTypes.string,
    token: PropTypes.string,
  }),
  fileMeta: PropTypes.object.isRequired,
  setFileMeta: PropTypes.func.isRequired,
};