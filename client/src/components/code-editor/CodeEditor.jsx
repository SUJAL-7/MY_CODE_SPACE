import React, { useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";

/**
 * Props:
 *  code, setCode         - controlled content
 *  editorLanguage        - monaco language id (e.g. javascript, python)
 *  openFilePath          - current file path (for tab/status)
 *  onChangeCode          - optional separate callback
 *  enableAutosave        - boolean
 *  onDirtyChange         - callback(dirty:boolean)
 *  onAutosave            - callback(content)
 *  autosaveDelay         - ms (default 800)
 */
const CodeEditor = ({
  code,
  setCode,
  editorLanguage = "plaintext",
  openFilePath,
  onChangeCode,
  enableAutosave = true,
  onDirtyChange,
  onAutosave,
  autosaveDelay = 800
}) => {
  const monacoRef = useRef(null);
  const dirtyRef = useRef(false);
  const autosaveTimer = useRef(null);
  const lastSavedContent = useRef(code);

  useEffect(() => {
    lastSavedContent.current = code;
    dirtyRef.current = false;
    onDirtyChange && onDirtyChange(false);
  }, [openFilePath]); // when file changes, reset dirty tracking

  const setEditorTheme = (monaco) => {
    monaco.editor.defineTheme("customTheme", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#1f1f1f"
      }
    });
  };

  const handleChange = (value) => {
    setCode(value ?? "");
    onChangeCode && onChangeCode(value ?? "");
    if (enableAutosave) {
      if (value !== lastSavedContent.current) {
        if (!dirtyRef.current) {
          dirtyRef.current = true;
          onDirtyChange && onDirtyChange(true);
        }
        clearTimeout(autosaveTimer.current);
        autosaveTimer.current = setTimeout(() => {
          if (onAutosave) {
            onAutosave(value ?? "");
            lastSavedContent.current = value ?? "";
            dirtyRef.current = false;
            onDirtyChange && onDirtyChange(false);
          }
        }, autosaveDelay);
      } else {
        if (dirtyRef.current) {
          dirtyRef.current = false;
          onDirtyChange && onDirtyChange(false);
        }
      }
    }
  };

  return (
    <Editor
      beforeMount={setEditorTheme}
      onMount={(editor, monaco) => {
        monacoRef.current = editor;
      }}
      language={editorLanguage}
      height={"calc(100vh - 40px)"} // adjust for header bar
      theme="customTheme"
      value={code}
      onChange={handleChange}
      options={{
        inlineSuggest: true,
        fontSize: 14,
        formatOnType: true,
        autoClosingBrackets: "always",
        minimap: { enabled: false },
        padding: { top: 10 },
        scrollBeyondLastLine: false,
        smoothScrolling: true
      }}
    />
  );
};

export default CodeEditor;