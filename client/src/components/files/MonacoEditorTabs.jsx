import React, { useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import { X, Save, RotateCcw } from "lucide-react";

export default function EditorTabs({
  tabs,
  active,
  onSelect,
  onClose,
  onChangeContent,
  onSave,
  onReload
}) {
  const activeTab = tabs.find(t => t.path === active);

  // Basic language inference
  function languageFor(name) {
    if (!name) return "plaintext";
    const ext = name.split(".").pop().toLowerCase();
    const map = {
      js: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      ts: "typescript",
      tsx: "typescript",
      json: "json",
      md: "markdown",
      css: "css",
      scss: "scss",
      html: "html",
      sh: "shell",
      py: "python",
      rs: "rust",
      go: "go",
      java: "java",
      yml: "yaml",
      yaml: "yaml"
    };
    return map[ext] || "plaintext";
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab strip */}
      <div className="flex items-stretch bg-[#252525] border-b border-neutral-700 overflow-x-auto">
        {tabs.map(t => {
          const activeCls = t.path === active;
          return (
            <div
              key={t.path}
              className={`flex items-center gap-2 px-3 h-8 text-[11px] cursor-pointer select-none border-r border-neutral-700
                ${activeCls ? "bg-[#1e1e1e] text-neutral-100" : "bg-[#2d2d2d] text-neutral-400 hover:text-neutral-200"}`}
              onClick={() => onSelect(t.path)}
            >
              <span className="truncate max-w-[120px]">
                {t.title}{t.dirty ? "*" : ""}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onClose(t.path); }}
                className="text-neutral-500 hover:text-neutral-300"
                title="Close"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        {!tabs.length && (
          <div className="px-3 h-8 flex items-center text-[11px] text-neutral-500">
            No file open
          </div>
        )}
      </div>
      {/* Editor pane */}
      <div className="flex-1 relative">
        {activeTab ? (
          <Editor
            path={activeTab.path}
            value={activeTab.content}
            language={languageFor(activeTab.title)}
            theme="vs-dark"
            options={{
              fontSize: 13,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              wordWrap: "on",
              automaticLayout: true
            }}
            onChange={(val) => onChangeContent(activeTab.path, val ?? "")}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-neutral-600 text-[12px]">
            Open a file to start editing
          </div>
        )}
        {activeTab && (
          <div className="absolute right-2 top-2 flex gap-2">
            <button
              title="Reload from disk"
              className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 rounded text-[11px]"
              onClick={() => {
                if (activeTab.dirty && !confirm("Discard unsaved changes?")) return;
                onReload(activeTab.path);
              }}
            >
              <RotateCcw size={14} />
            </button>
            <button
              disabled={!activeTab.dirty}
              title="Save"
              className={`px-2 py-1 rounded text-[11px] ${activeTab.dirty ? "bg-green-600 hover:bg-green-500" : "bg-neutral-700 text-neutral-400"}`}
              onClick={() => onSave(activeTab.path)}
            >
              <Save size={14} />
            </button>
          </div>
        )}
        {activeTab && (
          <div className="absolute bottom-0 left-0 right-0 h-5 px-3 flex items-center justify-between text-[10px] bg-[#252525] border-t border-neutral-700 text-neutral-500">
            <span>{activeTab.dirty ? "Unsaved changes" : "Saved"}</span>
            <span>
              {activeTab.size} bytes {activeTab.truncated && "(truncated view)"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}