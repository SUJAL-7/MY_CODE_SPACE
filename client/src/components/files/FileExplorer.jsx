import React, { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "../../socket/socket";
import Tree from "rc-tree";
import "rc-tree/assets/index.css";
import {
  FaFolder,
  FaFolderOpen,
  FaFile,
  FaSyncAlt,
  FaEye,
  FaEyeSlash,
  FaPlus,
  FaFileAlt,
  FaTrash,
  FaEdit,
} from "react-icons/fa";

const ROOT_PATH = "";
const ROOT_KEY = "__ROOT__";

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function FileExplorer({ session, collapsed, onFileOpen }) {
  const ready = !!session?.ready;

  // Tree nodes
  const [treeData, setTreeData] = useState([
    { key: ROOT_KEY, title: "workspace", path: ROOT_PATH, isLeaf: false }
  ]);
  const [expandedKeys, setExpandedKeys] = useState([ROOT_KEY]);
  const [loadingKeys, setLoadingKeys] = useState(new Set());
  const [errorKeys, setErrorKeys] = useState({});
  const [showHidden, setShowHidden] = useState(false);

  // Selection state
  const [selectedFile, setSelectedFile] = useState(null);

  // Caches
  const dirCache = useRef(new Map());
  const pending = useRef(new Map());

  /* ------------- Socket send helper ------------- */
  const send = useCallback((event, payload, onSuccess, onError) => {
    if (!ready) return;
    const requestId = genId();
    pending.current.set(requestId, { onSuccess, onError });
    socket.emit(event, {
      ...payload,
      requestId,
      sessionId: session.sessionId,
      token: session.token
    });
  }, [ready, session]);

  /* ------------- Helpers ------------- */
  const parentDir = useCallback((p) => {
    if (!p) return "";
    const parts = p.split("/").filter(Boolean);
    parts.pop();
    return parts.join("/");
  }, []);

  const buildChildrenNodes = useCallback((dirPath) => {
    const entries = dirCache.current.get(dirPath) || [];
    return entries
      .filter(e => showHidden || !e.name.startsWith("."))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map(e => ({
        key: e.path,
        title: e.name,
        path: e.path,
        isLeaf: e.type !== "dir"
      }));
  }, [showHidden]);

  const updateTreeWithChildren = useCallback((current, dirPath, children) => {
    const replace = (nodes) =>
      nodes.map(n => {
        const thisPath = n.path ?? (n.key === ROOT_KEY ? ROOT_PATH : n.key);
        if (thisPath === dirPath) {
          return { ...n, children, isLeaf: false };
        }
        if (n.children) return { ...n, children: replace(n.children) };
        return n;
      });
    return replace(current);
  }, []);

  /* ------------- Load directory lazily ------------- */
  const loadDir = useCallback(async (dirPath) => {
    if (!ready) return;
    if (dirCache.current.has(dirPath)) return;
    setLoadingKeys(prev => {
      const n = new Set(prev); n.add(dirPath); return n;
    });
    setErrorKeys(prev => ({ ...prev, [dirPath]: undefined }));

    await new Promise(resolve => {
      send("fs:list", { path: dirPath },
        (res) => {
          dirCache.current.set(dirPath, res.entries || []);
          setTreeData(prev => updateTreeWithChildren(prev, dirPath, buildChildrenNodes(dirPath)));
          setLoadingKeys(prev => {
            const n = new Set(prev); n.delete(dirPath); return n;
          });
          resolve();
        },
        (err) => {
          setErrorKeys(prev => ({ ...prev, [dirPath]: err || "Error" }));
          setLoadingKeys(prev => {
            const n = new Set(prev); n.delete(dirPath); return n;
          });
          resolve();
        }
      );
    });
  }, [ready, send, updateTreeWithChildren, buildChildrenNodes]);

  /* ------------- Reload (invalidate + load) ------------- */
  const reloadDir = useCallback(async (dirPath) => {
    dirCache.current.delete(dirPath);
    setTreeData(prev => {
      const strip = (nodes) => nodes.map(n => {
        const nPath = n.path ?? (n.key === ROOT_KEY ? ROOT_PATH : n.key);
        if (nPath === dirPath) {
          const { children, ...rest } = n;
          return rest;
        }
        if (n.children) return { ...n, children: strip(n.children) };
        return n;
      });
      return strip(prev);
    });
    await loadDir(dirPath);
  }, [loadDir]);

  /* ------------- File operations ------------- */
  const deleteEntry = useCallback((path) => {
    if (!window.confirm(`Delete "${path}"?`)) return;
    const parent = parentDir(path);
    send("fs:delete", { path },
      () => {
        if (selectedFile === path) setSelectedFile(null);
        reloadDir(parent || ROOT_PATH);
      },
      (err) => alert("Delete error: " + err)
    );
  }, [send, selectedFile, parentDir, reloadDir]);

  const renameEntry = useCallback((oldPath) => {
    const base = oldPath.split("/").pop();
    const newName = window.prompt("Rename to:", base);
    if (!newName || newName === base) return;
    const parent = parentDir(oldPath);
    const newPath = parent ? `${parent}/${newName}` : newName;
    send("fs:rename", { from: oldPath, to: newPath },
      () => {
        if (selectedFile === oldPath) setSelectedFile(newPath);
        reloadDir(parent || ROOT_PATH);
      },
      (err) => alert("Rename error: " + err)
    );
  }, [send, selectedFile, parentDir, reloadDir]);

  const createFile = useCallback((dirPath = ROOT_PATH) => {
    const name = window.prompt("New file name:");
    if (!name) return;
    const full = dirPath ? `${dirPath}/${name}` : name;
    send("fs:write", { path: full, content: "" },
      () => {
        reloadDir(dirPath);
      },
      (err) => alert("Create file error: " + err)
    );
  }, [send, reloadDir]);

  const createFolder = useCallback((dirPath = ROOT_PATH) => {
    const name = window.prompt("New folder name:");
    if (!name) return;
    const full = dirPath ? `${dirPath}/${name}` : name;
    send("fs:createDir", { path: full },
      () => reloadDir(dirPath),
      (err) => alert("Create folder error: " + err)
    );
  }, [send, reloadDir]);

  /* ------------- rc-tree handlers ------------- */
  const onExpand = useCallback((keys, info) => {
    setExpandedKeys(keys);
    if (info?.node) {
      const path = info.node.path ?? (info.node.key === ROOT_KEY ? ROOT_PATH : info.node.key);
      if (!info.node.isLeaf && !dirCache.current.has(path)) {
        loadDir(path);
      }
    }
  }, [loadDir]);

  const onSelect = useCallback((keys, info) => {
    const node = info?.node;
    if (!node) return;
    const path = node.path ?? (node.key === ROOT_KEY ? ROOT_PATH : node.key);
    if (node.isLeaf) {
      setSelectedFile(path);
      if (onFileOpen) onFileOpen(path);
    } else {
      setExpandedKeys(prev =>
        prev.includes(node.key) ? prev.filter(k => k !== node.key) : [...prev, node.key]
      );
      if (!dirCache.current.has(path)) loadDir(path);
    }
  }, [onFileOpen, loadDir]);

  /* ------------- Socket response listeners ------------- */
  useEffect(() => {
    function success(msg) {
      const rec = pending.current.get(msg.requestId);
      if (!rec) return;
      pending.current.delete(msg.requestId);
      rec.onSuccess?.(msg);
    }
    function failure(msg) {
      const rec = pending.current.get(msg.requestId);
      if (!rec) return;
      pending.current.delete(msg.requestId);
      rec.onError?.(msg.message || "Error");
    }

    const evs = [
      "fs:listResult", "fs:readResult", "fs:writeResult", "fs:createDirResult",
      "fs:deleteResult", "fs:renameResult", "fs:error"
    ];
    evs.forEach(ev => socket.on(ev, ev === "fs:error" ? failure : success));

    socket.on("fs:delta", (delta) => {
      if (!delta) return;
      const p = delta.change === "rename"
        ? parentDir(delta.to) || parentDir(delta.from)
        : parentDir(delta.path);
      const target = p || ROOT_PATH;
      reloadDir(target);
      if (delta.change === "delete" && selectedFile === delta.path) {
        setSelectedFile(null);
      }
      if (delta.change === "rename" && selectedFile === delta.from) {
        setSelectedFile(delta.to);
      }
    });

    return () => {
      evs.forEach(ev => socket.off(ev));
      socket.off("fs:delta");
    };
  }, [parentDir, reloadDir, selectedFile]);

  /* ------------- Initial root load & showHidden toggle ------------- */
  useEffect(() => {
    if (!ready) return;
    dirCache.current.clear();
    setTreeData([{ key: ROOT_KEY, title: "workspace", path: ROOT_PATH, isLeaf: false }]);
    loadDir(ROOT_PATH);
  }, [ready, showHidden, loadDir]);

  /* ------------- UI ------------- */
  const disabled = !ready;

  // Remove RcTree's default switcher icons (the "+/-" sign) with switcherIcon={null}
  // Hide lines for extra clean look, and make folder selection clear and simple
  return (
    <aside
      className={`flex flex-col h-full bg-[#181A20] border-r border-neutral-800 transition-all
      ${collapsed ? "w-0 opacity-0 pointer-events-none" : "w-[300px] md:w-[340px]"} shadow-xl`}
      style={{ boxShadow: "2px 0 8px 0 #21212c19" }}
    >
      <header className="flex items-center gap-2 px-4 py-2 bg-[#21222c] border-b border-neutral-800 text-xs text-neutral-300">
        <span className="uppercase tracking-wide font-bold text-neutral-400 flex items-center gap-1">
          <FaFolderOpen className="text-indigo-400" /> Explorer
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            title="Refresh"
            onClick={() => {
              dirCache.current.clear();
              setTreeData([{ key: ROOT_KEY, title: "workspace", path: ROOT_PATH, isLeaf: false }]);
              setExpandedKeys([ROOT_KEY]);
              loadDir(ROOT_PATH);
            }}
            className="icon-btn"
            disabled={disabled}
            aria-label="Refresh"
          >
            <FaSyncAlt />
          </button>
          <button
            title={showHidden ? "Hide Hidden Files" : "Show Hidden Files"}
            onClick={() => setShowHidden(s => !s)}
            className={`icon-btn ${showHidden ? "text-indigo-400" : ""}`}
            disabled={disabled}
            aria-label="Toggle hidden files"
          >
            {showHidden ? <FaEyeSlash /> : <FaEye />}
          </button>
          <button
            title="New Folder"
            onClick={() => createFolder(selectedFile ? parentDir(selectedFile) : ROOT_PATH)}
            className="icon-btn"
            disabled={disabled}
            aria-label="New folder"
          >
            <FaFolder />
            <FaPlus className="ml-[-6px] text-[10px]" />
          </button>
          <button
            title="New File"
            onClick={() => createFile(selectedFile ? parentDir(selectedFile) : ROOT_PATH)}
            className="icon-btn"
            disabled={disabled}
            aria-label="New file"
          >
            <FaFileAlt />
            <FaPlus className="ml-[-6px] text-[10px]" />
          </button>
        </div>
      </header>

      <section className="flex-1 min-h-0 overflow-auto text-[13px] font-mono bg-[#181A20] px-1 py-2">
        <Tree
          treeData={treeData}
          expandedKeys={expandedKeys}
          onExpand={onExpand}
          selectedKeys={selectedFile ? [selectedFile] : []}
          onSelect={onSelect}
          showIcon={false}
          height={400}
          itemHeight={26}
          switcherIcon={null} // <--- Remove the "+/-" signs
          showLine={false}   // <--- Hide connecting lines
          loadData={(node) => {
            const path = node.path ?? (node.key === ROOT_KEY ? ROOT_PATH : node.key);
            if (node.isLeaf) return Promise.resolve();
            if (dirCache.current.has(path)) return Promise.resolve();
            return loadDir(path);
          }}
          titleRender={(node) => {
            const path = node.path ?? (node.key === ROOT_KEY ? ROOT_PATH : node.key);
            const loading = loadingKeys.has(path);
            const err = errorKeys[path];
            const isDir = !node.isLeaf;
            const selected = selectedFile === path;
            return (
              <div
                className={`flex items-center gap-2 w-full px-2 py-[3px] rounded transition
                  ${selected ? "bg-gradient-to-r from-indigo-900/50 to-indigo-500/10 ring-1 ring-indigo-500" : "hover:bg-[#23253d]/60"}
                  ${isDir ? "font-semibold" : ""}`}
                tabIndex={0}
                style={{
                  outline: selected ? "2px solid #6366f1" : "none",
                  cursor: isDir ? "pointer" : "pointer"
                }}
              >
                <span className="mr-1">
                  {isDir ? (
                    expandedKeys.includes(node.key)
                      ? <FaFolderOpen className="text-yellow-400" />
                      : <FaFolder className="text-yellow-700" />
                  ) : (
                    <FaFile className="text-neutral-400" />
                  )}
                </span>
                <span className={isDir ? "font-semibold text-neutral-200" : "text-neutral-300"}>
                  {node.title}
                </span>
                {loading && <span className="text-neutral-400 text-[10px] ml-2 animate-pulse">⏳</span>}
                {err && (
                  <span className="text-red-400 text-[11px] ml-2" title={err}>
                    !
                  </span>
                )}
                <span className="ml-auto flex gap-1">
                  {!isDir && selected && (
                    <>
                      <button
                        className="icon-btn text-[11px]"
                        title="Rename"
                        onClick={e => { e.stopPropagation(); renameEntry(path); }}
                        aria-label="Rename"
                      >
                        <FaEdit />
                      </button>
                      <button
                        className="icon-btn text-red-400 text-[11px]"
                        title="Delete"
                        onClick={e => { e.stopPropagation(); deleteEntry(path); }}
                        aria-label="Delete"
                      >
                        <FaTrash />
                      </button>
                    </>
                  )}
                </span>
              </div>
            );
          }}
        />
      </section>

      <footer className="min-h-[38px] px-3 flex items-center bg-[#181A20] border-t border-neutral-800 text-xs text-neutral-500">
        <div className="truncate">
          {selectedFile
            ? <span className="text-indigo-400"><FaFile className="inline-block mr-1" /> {selectedFile}</span>
            : <span className="opacity-60">Select a file to open</span>
          }
        </div>
      </footer>
    </aside>
  );
}

/*
.icon-btn {
  @apply p-2 rounded hover:bg-neutral-700 transition text-neutral-400 hover:text-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400;
  font-size: 1rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
*/