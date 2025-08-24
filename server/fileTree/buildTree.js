// const { WORKSPACE_ROOT, DEDUP_CHARS } = require("./constants");
// const { exec } = require("./exec");
import { WORKSPACE_ROOT, DEDUP_CHARS } from "./constants.js";
import { exec } from "./exec.js";

export async function buildTree(container) {
  const cmd = `
set -e
find ${WORKSPACE_ROOT} -mindepth 1 -printf '%y|%P\\0'
`.trim();

  const out = await exec(container, cmd);

  const sanitize = (s) =>
    s.replace(/[\x00-\x1F\x7F]/g, "")
      .replace(/\\/g, "/")
      .replace(/\/{2,}/g, "/")
      .trim();

  const records = out.split("\0").filter(Boolean).map((r) => sanitize(r));
  const dirs = [];
  const files = [];

  for (const rec of records) {
    const idx = rec.indexOf("|");
    if (idx === -1) continue;
    const typeChar = rec.slice(0, idx);
    let rel = rec.slice(idx + 1);
    if (!rel || rel === ".") continue;
    if (rel.startsWith("/")) rel = rel.slice(1);
    if (!rel) continue;
    if (typeChar === "d") dirs.push(rel);
    else if (typeChar === "f") files.push(rel);
  }

  dirs.sort();
  files.sort();

  const tree = {};
  function ensureDir(parts) {
    let cur = tree;
    for (const part of parts) {
      if (!part) continue;
      if (!(part in cur) || cur[part] === null) cur[part] = {};
      cur = cur[part];
    }
    return cur;
  }

  for (const d of dirs) {
    const parts = d.split("/").filter(Boolean);
    if (parts.length) ensureDir(parts);
  }

  for (const f of files) {
    const parts = f.split("/").filter(Boolean);
    if (!parts.length) continue;
    const dirParts = parts.slice(0, -1);
    const leaf = parts[parts.length - 1];
    const parent = ensureDir(dirParts);
    if (!(leaf in parent)) parent[leaf] = null;
    else if (parent[leaf] && typeof parent[leaf] === "object" && Object.keys(parent[leaf]).length === 0) {
      parent[leaf] = null;
    }
  }

  if (DEDUP_CHARS) {
    dedupLeadingCharSiblings(tree, DEDUP_CHARS);
  }

  return tree;
}

function dedupLeadingCharSiblings(node, chars) {
  if (!node || typeof node !== "object") return;
  const names = Object.keys(node);
  for (const name of names) {
    const val = node[name];
    if (val && typeof val === "object") dedupLeadingCharSiblings(val, chars);
  }
  for (const ch of chars) {
    for (const name of names) {
      if (!name.startsWith(ch)) continue;
      const base = name.slice(1);
      if (!base) continue;
      if (Object.prototype.hasOwnProperty.call(node, base) &&
        Object.prototype.hasOwnProperty.call(node, name)) {
        const prefixed = node[name];
        const baseNode = node[base];
        const prefEmpty = prefixed && typeof prefixed === "object" && Object.keys(prefixed).length === 0;
        const baseEmpty = baseNode && typeof baseNode === "object" && Object.keys(baseNode).length === 0;
        if (prefEmpty && !baseEmpty) {
          delete node[name];
        }
      }
    }
  }
}

