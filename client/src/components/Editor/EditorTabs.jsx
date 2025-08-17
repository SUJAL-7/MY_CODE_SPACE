// import React from "react";
import PropTypes from "prop-types";

export default function EditorTabs({ openFiles, activeFile, setActiveFile, setOpenFiles }) {
  const closeTab = (path) => setOpenFiles(openFiles.filter(f => f !== path));
  return (
    <div className="flex bg-gray-800 border-b border-gray-700">
      {openFiles.map(path => (
        <div
          key={path}
          className={`px-4 py-2 cursor-pointer ${activeFile === path ? "bg-gray-900 text-white" : "bg-gray-800 text-gray-400"}`}
          onClick={() => setActiveFile(path)}
        >
          {path.split("/").pop()}
          <span
            className="ml-2 text-red-400 cursor-pointer"
            onClick={e => { e.stopPropagation(); closeTab(path); }}>
            ×
          </span>
        </div>
      ))}
    </div>
  );
}

EditorTabs.propTypes = {
  openFiles: PropTypes.array.isRequired,
  activeFile: PropTypes.string.isRequired,
  setActiveFile: PropTypes.func.isRequired,
  setOpenFiles: PropTypes.func.isRequired,
};
