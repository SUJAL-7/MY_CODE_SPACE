// import React from "react";
import PropTypes from "prop-types";

export default function EditorPane({ activeFile }) {
  if (!activeFile) return (
    <div className="flex-1 bg-gray-900 flex items-center justify-center text-gray-400">
      No file selected
    </div>
  );
  return (
    <div className="flex-1 bg-gray-900 p-4 text-gray-400 flex items-center justify-center">
      <span>Editor coming soon (selected: <b>{activeFile}</b>)</span>
    </div>
  );
}

EditorPane.propTypes = {
  activeFile: PropTypes.string.isRequired,
};