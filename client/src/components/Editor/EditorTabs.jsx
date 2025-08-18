// import React from "react";
import PropTypes from "prop-types";

export default function EditorTabs({
  openFiles,
  activeFile,
  setActiveFile,
  setOpenFiles,
  fileMeta = {}
}) {
  if (!openFiles.length) {
    return (
      <div className="flex items-center h-8 px-3 bg-gray-800 text-xs text-gray-400 select-none">
        No files open
      </div>
    );
  }

  const closeFile = (path, e) => {
    e.stopPropagation();
    setOpenFiles((prev) => prev.filter((p) => p !== path));
    if (activeFile === path) {
      // Select nearest neighbor
      const idx = openFiles.indexOf(path);
      const next = openFiles.filter((p) => p !== path);
      const newActive = next[idx - 1] || next[idx] || "";
      setActiveFile(newActive);
    }
  };

  return (
    <div className="flex h-8 bg-gray-800 overflow-x-auto scrollbar-thin">
      {openFiles.map((path) => {
        const meta = fileMeta[path] || {};
        const base = path.split("/").pop();
        let indicator = "";
        if (meta.saving) indicator = "●";
        else if (meta.error) indicator = "✕";
        else if (meta.dirty) indicator = "●";
        return (
          <div
            key={path}
            onClick={() => setActiveFile(path)}
            className={`flex items-center px-3 text-xs cursor-pointer select-none border-r border-gray-700 ${
              path === activeFile ? "bg-gray-900 text-blue-300" : "text-gray-300 hover:bg-gray-700"
            }`}
            style={{ maxWidth: 200 }}
            title={path}
          >
            <span className="truncate">{base}</span>
            {indicator && (
              <span
                className={`ml-1 ${
                  meta.error
                    ? "text-red-500"
                    : meta.saving
                    ? "text-amber-400 animate-pulse"
                    : "text-green-400"
                }`}
              >
                {indicator}
              </span>
            )}
            <button
              onClick={(e) => closeFile(path, e)}
              className="ml-2 text-gray-500 hover:text-gray-300"
              style={{ fontSize: 11 }}
              title="Close"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

EditorTabs.propTypes = {
  openFiles: PropTypes.arrayOf(PropTypes.string).isRequired,
  activeFile: PropTypes.string.isRequired,
  setActiveFile: PropTypes.func.isRequired,
  setOpenFiles: PropTypes.func.isRequired,
  fileMeta: PropTypes.object
};