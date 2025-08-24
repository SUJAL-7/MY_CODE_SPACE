export function hashTree(tree) {
  let h = 2166136261 >>> 0;
  (function walk(node, base) {
    const keys = Object.keys(node).sort();
    for (const k of keys) {
      const path = base ? `${base}/${k}` : k;
      const marker = node[k] === null ? ":F" : ":D";
      const line = path + marker;
      for (let i = 0; i < line.length; i++) {
        h ^= line.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      if (node[k] && typeof node[k] === "object") walk(node[k], path);
    }
  })(tree, "");
  return h.toString(36);
}
