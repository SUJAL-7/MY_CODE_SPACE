import React, { useCallback, useEffect, useState } from "react";
import { socket } from "../../socket/socket";
import "./file-explorer.css";

function sortNodes(nodes = []) {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

const FileNode = ({ node, depth, onOpenFile }) => {
  const [open, setOpen] = useState(depth < 1); // expand root level
  const isDir = node.type === "directory";

  const handleClick = (e) => {
    e.stopPropagation();
    if (isDir) {
      setOpen(o => !o);
    } else {
      onOpenFile(node);
    }
  };

  return (
    <div className="fe-node">
      <div
        className={`fe-row ${isDir ? "fe-dir" : "fe-file"}`}
        style={{ paddingLeft: depth * 12 }}
        onClick={handleClick}
        title={node.path}
      >
        <span className="fe-icon">
          {isDir ? (open ? "📂" : "📁") : "📄"}
        </span>
        <span className="fe-name">{node.name}</span>
      </div>
      {isDir && open && node.children?.length > 0 && (
        <div className="fe-children">
          {sortNodes(node.children).map(child => (
            <FileNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FileExplorer = ({
  workspaceReady,
  onOpenFilePath,
  onOpenFileContent
}) => {
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(false);

  const requestTree = useCallback(() => {
    if (!workspaceReady) return;
    socket.emit("request-tree");
  }, [workspaceReady]);

  useEffect(() => {
    const handleTree = (payload) => {
      setTree(payload.tree || []);
    };
    socket.on("tree-update", handleTree);
    return () => {
      socket.off("tree-update", handleTree);
    };
  }, []);

  useEffect(() => {
    if (workspaceReady) requestTree();
  }, [workspaceReady, requestTree]);

  const openFile = (node) => {
    if (node.type !== "file") return;
    setLoading(true);
    socket.emit("read-file", node.path, (resp) => {
      setLoading(false);
      if (resp?.error) {
        console.error(resp.error);
        return;
      }
      onOpenFilePath(node.path);
      onOpenFileContent(resp.content ?? "");
    });
  };

  return (
    <div className="file-explorer-container">
      <div className="fe-header">
        <span className="font-semibold text-[10px] tracking-wide text-neutral-300">
          WORKSPACE
        </span>
        <button
          className="fe-refresh"
          onClick={requestTree}
          title="Refresh Tree"
        >
          ⟳
        </button>
      </div>
      <div className="fe-body">
        {tree.length === 0 && (
          <div className="fe-empty">
            {workspaceReady ? "No files yet." : "Initializing..."}
          </div>
        )}
        {tree.map(n => (
          <FileNode
            key={n.path}
            node={n}
            depth={0}
            onOpenFile={openFile}
          />
        ))}
      </div>
      {loading && (
        <div className="fe-loading-overlay">
          <div className="fe-loading-spinner" />
        </div>
      )}
    </div>
  );
};

export default FileExplorer;