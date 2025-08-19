import PropTypes from "prop-types";
import { FiX, FiAlertCircle, FiSave, FiEdit3, FiCircle } from "react-icons/fi";

export default function EditorTabs({
  openFiles,
  activeFile,
  setActiveFile,
  setOpenFiles,
  fileMeta = {}
}) {
  if (!openFiles.length) {
    return (
      <div className="flex items-center h-9 px-4 bg-[#2d2d30] text-sm text-[#858585] select-none border-b border-[#3e3e42]">
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
    <div className="flex h-9 bg-[#2d2d30] border-b border-[#3e3e42] overflow-x-auto scrollbar-thin scrollbar-thumb-[#424242] scrollbar-track-[#2d2d30]">
      {openFiles.map((path) => {
        const meta = fileMeta[path] || {};
        const base = path.split("/").pop();

        // Status indicator with icon and color
        let indicator = null;
        if (meta.saving)
          indicator = <FiSave className="text-[#ffcc66] animate-pulse" title="Saving" />;
        else if (meta.error)
          indicator = <FiAlertCircle className="text-[#f48771]" title="Error" />;
        else if (meta.dirty)
          indicator = <FiCircle className="text-[#ffcc66]" title="Unsaved changes" />;

        return (
          <div
            key={path}
            onClick={() => setActiveFile(path)}
            className={`flex items-center px-3 text-sm cursor-pointer select-none border-r border-[#3e3e42] transition-colors group
              ${path === activeFile 
                ? "bg-[#1e1e1e] text-[#cccccc] border-t border-[#4ec9b0]" 
                : "text-[#858585] hover:bg-[#37373d] hover:text-[#cccccc]"
              }`}
            style={{ maxWidth: 240, minWidth: 80 }}
            title={path}
            tabIndex={0}
            onKeyDown={e => { 
              if (e.key === "Enter" || e.key === " ") setActiveFile(path); 
            }}
          >
            {/* File icon */}
            <span className="mr-2 flex-shrink-0">
              <FiEdit3 className={`w-3.5 h-3.5 ${
                path === activeFile ? "text-[#4ec9b0]" : "text-[#858585] group-hover:text-[#cccccc]"
              }`} />
            </span>
            
            {/* File name */}
            <span className="truncate text-[13px] font-medium">{base}</span>
            
            {/* Status indicator */}
            {indicator && (
              <span className="ml-2 flex items-center flex-shrink-0">{indicator}</span>
            )}
            
            {/* Close button */}
            <button
              onClick={(e) => closeFile(path, e)}
              className="ml-2 p-0.5 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity flex-shrink-0"
              style={{ fontSize: 13 }}
              title="Close"
              tabIndex={-1}
            >
              <FiX className={`w-3.5 h-3.5 ${
                path === activeFile ? "text-[#858585] hover:text-[#cccccc]" : "text-[#5a5a5a] hover:text-[#858585]"
              }`} />
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