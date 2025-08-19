import PropTypes from "prop-types";
import { useState, useCallback, useEffect } from "react";
import { FiFile, FiRefreshCw, FiChevronRight, FiChevronDown } from "react-icons/fi";

export default function FileExplorer({ tree, onOpenFile, onResync }) {
  const [expanded, setExpanded] = useState(new Set([""]));

  const toggle = useCallback((path) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  // Prune expansion entries that no longer exist after a new snapshot
  useEffect(() => {
    if (!tree) return;
    const valid = new Set();
    function walk(node, basePath) {
      valid.add(basePath);
      for (const key of Object.keys(node)) {
        const value = node[key];
        const relativePath = basePath ? `${basePath}/${key}` : key;
        if (value && typeof value === "object") walk(value, relativePath);
        else valid.add(relativePath);
      }
    }
    walk(tree, "");
    setExpanded((prev) => {
      let changed = false;
      const out = new Set();
      for (const path of prev) {
        if (valid.has(path)) out.add(path);
        else changed = true;
      }
      return changed ? out : prev;
    });
  }, [tree]);

  function renderDirectory(obj, basePath) {
    const entries = Object.keys(obj).sort((a, b) => {
      const aIsDir = obj[a] && typeof obj[a] === "object";
      const bIsDir = obj[b] && typeof obj[b] === "object";
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.localeCompare(b);
    });

    return (
      <ul className={basePath ? "pl-4 ml-1 border-l border-[#404040]" : ""}>
        {entries.map((name) => {
          const value = obj[name];
          const relativePath = basePath ? `${basePath}/${name}` : name;
          const isDirectory = value && typeof value === "object";
          const isExpanded = expanded.has(relativePath);
          
          return (
            <li key={relativePath} className="group">
              {isDirectory ? (
                <div className="flex items-center gap-1 py-1 cursor-pointer hover:bg-[#2a2d2e] rounded pr-1 transition-colors">
                  <button
                    className="w-4 text-[#858585] group-hover:text-[#cccccc] transition-colors focus:outline-none flex items-center justify-center"
                    onClick={() => toggle(relativePath)}
                    aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
                    tabIndex={-1}
                  >
                    {isExpanded ? (
                      <FiChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <FiChevronRight className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <span
                    className="text-[#cccccc] group-hover:text-white truncate flex items-center gap-1.5 text-sm"
                    onClick={() => toggle(relativePath)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") toggle(relativePath);
                    }}
                  >
                    <span className="w-4 h-4 flex items-center justify-center text-[#4ec9b0]">
                      {isExpanded ? "📂" : "📁"}
                    </span>
                    {name}
                  </span>
                </div>
              ) : (
                <button
                  onClick={() => onOpenFile(relativePath)}
                  className="flex items-center gap-2 w-full text-left py-1 pl-5 text-[#cccccc] hover:bg-[#2a2d2e] rounded hover:text-white transition-colors text-sm"
                  title={name}
                >
                  <FiFile className="w-3.5 h-3.5 text-[#9cdcfe] flex-shrink-0" />
                  <span className="truncate">{name}</span>
                </button>
              )}
              {isDirectory && isExpanded && renderDirectory(value, relativePath)}
            </li>
          );
        })}
        {entries.length === 0 && basePath && (
          <li className="text-[#858585] italic pl-6 text-xs">(empty directory)</li>
        )}
      </ul>
    );
  }

  if (!tree) {
    return (
      <div className="p-4 text-[#858585] text-sm flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-[#4ec9b0] border-t-transparent rounded-full animate-spin"></div>
          <span>Loading file structure...</span>
        </div>
        <button
          className="px-3 py-1.5 bg-[#3a3d41] hover:bg-[#45494e] rounded text-xs text-[#cccccc] flex items-center gap-2 transition-colors border border-[#4f5256]"
          onClick={onResync}
        >
          <FiRefreshCw className="w-3 h-3" />
          Resync Files
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-auto flex-1 text-sm select-none p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="font-semibold text-[#cccccc] text-[13px] uppercase tracking-wide">
          WORKSPACE
        </span>
        <button
          className="p-1.5 text-[#858585] hover:text-[#cccccc] hover:bg-[#3a3d41] rounded transition-colors border border-transparent hover:border-[#4f5256]"
          onClick={onResync}
          title="Rescan file system"
        >
          <FiRefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* File Tree */}
      <div className="space-y-0.5">
        {renderDirectory(tree, "")}
      </div>
    </div>
  );
}

FileExplorer.propTypes = {
  tree: PropTypes.object,
  onOpenFile: PropTypes.func.isRequired,
  onResync: PropTypes.func.isRequired,
};