export function applyTreeOps(root, ops) {
  if (!root) return root;

  const flat = new Map();
  function walk(node) {
    for (const e of node.entries || []) {
      flat.set(e.path, e);
      if (e.isDir) walk(e);
    }
  }
  walk(root);

  const parentOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const ensureDirNode = (n) => {
    if (n.isDir && !Array.isArray(n.entries)) n.entries = [];
    return n;
  };
  function rebuildChildren() {
    const map = new Map();
    for (const node of flat.values()) {
      const parent = parentOf(node.path);
      if (!map.has(parent)) map.set(parent, []);
      map.get(parent).push(node);
    }
    return map;
  }

  let childrenMap = rebuildChildren();

  for (const op of ops) {
    if (op.op === "add" && op.node) {
      const node = ensureDirNode({ ...op.node });
      flat.set(node.path, node);
      childrenMap = rebuildChildren();
    } else if (op.op === "remove" && op.path) {
      for (const k of Array.from(flat.keys())) {
        if (k === op.path || k.startsWith(op.path + "/")) flat.delete(k);
      }
      childrenMap = rebuildChildren();
    } else if (op.op === "update" && op.path) {
      const n = flat.get(op.path);
      if (n) {
        if (typeof op.size === "number") n.size = op.size;
        if (typeof op.mtime === "number") n.mtime = op.mtime;
      }
    } else if (op.op === "rename" && op.from && op.to && op.node) {
      for (const k of Array.from(flat.keys())) {
        if (k === op.from || k.startsWith(op.from + "/")) flat.delete(k);
      }
      flat.set(op.node.path, ensureDirNode({ ...op.node }));
      childrenMap = rebuildChildren();
    } else if (op.op === "refreshDir" && op.path != null) {
      for (const k of Array.from(flat.keys())) {
        const parent = parentOf(k);
        if (parent === op.path) flat.delete(k);
      }
      if (Array.isArray(op.children)) {
        for (const child of op.children) {
          flat.set(child.path, ensureDirNode({ ...child }));
        }
      }
      childrenMap = rebuildChildren();
    }
  }

  function build(path) {
    const entries = (childrenMap.get(path) || [])
      .map(ensureDirNode)
      .sort((a, b) =>
        a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)
      )
      .map(n =>
        n.isDir
          ? {
              name: n.name,
              path: n.path,
              type: n.type || "directory",
              isDir: true,
              size: n.size,
              mtime: n.mtime,
              entries: build(n.path).entries,
            }
          : {
              name: n.name,
              path: n.path,
              type: n.type || "file",
              isDir: false,
              size: n.size,
              mtime: n.mtime,
            }
      );
    return { path, entries };
  }

  const built = build("");
  // Normalize root with directory flags
  return {
    path: "",
    name: "",
    type: "directory",
    isDir: true,
    entries: built.entries,
  };
}