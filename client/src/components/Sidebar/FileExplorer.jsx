import PropTypes from "prop-types";
import { useState, useCallback, useEffect } from "react";

// tree: { nameOrDir: null | { ... } }
export default function FileExplorer({ tree, onOpenFile, onResync }) {
  const [expanded, setExpanded] = useState(new Set([""]));

  const toggle = useCallback((p) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  }, []);

  // Prune expansion entries that no longer exist after a new snapshot
  useEffect(() => {
    if (!tree) return;
    const valid = new Set();
    function walk(node, base) {
      valid.add(base);
      for (const k of Object.keys(node)) {
        const val = node[k];
        const rel = base ? `${base}/${k}` : k;
        if (val && typeof val === "object") walk(val, rel);
        else valid.add(rel);
      }
    }
    walk(tree, "");
    setExpanded(prev => {
      let changed = false;
      const out = new Set();
      for (const p of prev) {
        if (valid.has(p)) out.add(p);
        else changed = true;
      }
      return changed ? out : prev;
    });
  }, [tree]);

  function renderDir(obj, basePath) {
    const entries = Object.keys(obj).sort((a, b) => {
      const aDir = obj[a] && typeof obj[a] === "object";
      const bDir = obj[b] && typeof obj[b] === "object";
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.localeCompare(b);
    });

    return (
      <ul className={basePath ? "pl-4" : ""}>
        {entries.map(name => {
          const val = obj[name];
          const rel = basePath ? `${basePath}/${name}` : name;
          const isDir = val && typeof val === "object";
          const open = expanded.has(rel);
          return (
            <li key={rel}>
              {isDir ? (
                <div className="flex items-center gap-1 py-[1px]">
                  <button
                    className="w-4 text-xs text-gray-300 hover:text-white"
                    onClick={() => toggle(rel)}
                  >
                    {open ? "▼" : "▶"}
                  </button>
                  <span
                    className="cursor-pointer text-gray-200 hover:text-white"
                    onClick={() => toggle(rel)}
                  >
                    {name}/
                  </span>
                </div>
              ) : (
                <button
                  onClick={() => onOpenFile(rel)}
                  className="text-blue-400 hover:underline text-left py-[1px]"
                >
                  {name}
                </button>
              )}
              {isDir && open && renderDir(val, rel)}
            </li>
          );
        })}
        {entries.length === 0 && basePath && (
          <li className="text-gray-500 italic">(empty)</li>
        )}
      </ul>
    );
  }

  if (!tree) {
    return (
      <div className="p-2 text-xs text-gray-400">
        Loading...
        <button
          className="ml-2 px-2 py-0.5 bg-gray-700 rounded text-xs"
          onClick={onResync}
        >
          Resync
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-auto flex-1 text-xs p-2 select-none">
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-gray-300">Files</span>
        <button
          className="px-2 py-0.5 bg-gray-700 rounded text-[10px] hover:bg-gray-600"
          onClick={onResync}
          title="Force full rescan"
        >
          Resync
        </button>
      </div>
      {renderDir(tree, "")}
    </div>
  );
}

FileExplorer.propTypes = {
  tree: PropTypes.object,
  onOpenFile: PropTypes.func.isRequired,
  onResync: PropTypes.func.isRequired,
};