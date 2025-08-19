import PropTypes from "prop-types";
import FileExplorer from "./FileExplorer";
import { FiRefreshCw, FiFolder } from "react-icons/fi";

export default function Sidebar({ tree, onOpenFile, onResyncTree }) {
  return (
    <div className="w-full h-full flex flex-col bg-[#252526] border-r border-[#3e3e42]">
      {/* Sidebar Header */}
      <div className="flex items-center justify-between px-4 h-9 bg-[#2d2d30] border-b border-[#3e3e42]">
        <div className="flex items-center gap-2">
          <FiFolder className="w-4 h-4 text-[#4ec9b0]" />
          <span className="text-sm font-medium text-[#cccccc]">EXPLORER</span>
        </div>
        
        <button
          onClick={onResyncTree}
          className="p-1 text-[#858585] hover:text-[#cccccc] hover:bg-[#3e3e42] rounded transition-colors"
          title="Refresh file tree"
        >
          <FiRefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* File Explorer Content */}
      <div className="flex-1 overflow-hidden">
        <FileExplorer
          tree={tree}
          onOpenFile={onOpenFile}
          onResync={onResyncTree}
        />
      </div>
    </div>
  );
}

Sidebar.propTypes = {
  tree: PropTypes.object,
  onOpenFile: PropTypes.func.isRequired,
  onResyncTree: PropTypes.func.isRequired,
};