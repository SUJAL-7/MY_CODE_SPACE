/**
 * Build JSON tree of workspace (host viewpoint).
 */
import fs from "fs";
import path from "path";

export function buildWorkspaceTree(rootDir, {
  maxDepth = 5,
  maxEntriesPerDir = 200,
  maxTotalNodes = 5000
} = {}) {
  const rootStat = safeStat(rootDir);
  if (!rootStat || !rootStat.isDirectory())
    throw new Error("Workspace root missing or not a directory");
  let total = 0;
  function walk(cur, depth) {
    if (depth > maxDepth) return null;
    if (total >= maxTotalNodes) return null;
    const rel = path.relative(rootDir, cur).replace(/\\/g, "/");
    const node = {
      name: rel === "" ? "." : path.basename(cur),
      path: rel === "" ? "" : rel,
      type: "dir",
      children: []
    };
    let items;
    try {
      items = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return node;
    }
    items.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    let dirCount = 0;
    for (const entry of items) {
      if (dirCount >= maxEntriesPerDir) {
        node.children.push({ name: "...", path: null, type: "truncated" });
        break;
      }
      const full = path.join(cur, entry.name);
      const st = safeStat(full);
      if (!st) continue;
      if (entry.isDirectory()) {
        total++;
        const child = walk(full, depth + 1);
        if (child) node.children.push(child);
      } else {
        total++;
        node.children.push({
          name: entry.name,
            path: path.relative(rootDir, full).replace(/\\/g, "/"),
          type: "file",
          size: st.size,
          mtime: st.mtimeMs
        });
      }
      if (total >= maxTotalNodes) {
        node.children.push({ name: "TREE_LIMIT_REACHED", path: null, type: "limit" });
        break;
      }
      dirCount++;
    }
    return node;
  }
  return walk(rootDir, 0);
}

function safeStat(p) {
  try { return fs.statSync(p); } catch { return null; }
}