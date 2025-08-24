import path from "path";

const WORKSPACE_PATH = process.env.WORKSPACE_PATH || "/workspace";

export function sanitizeRel(p) {
  if (!p) return "";
  let s = p.replace(/\\/g, "/").trim();
  if (s.startsWith("/")) s = s.slice(1);
  const out = [];
  for (const seg of s.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") continue;
    out.push(seg);
  }
  return out.join("/");
}

export function absPath(rel) {
  return rel ? path.posix.join(WORKSPACE_PATH, rel) : WORKSPACE_PATH;
}

export function escapeBash(p) {
  return p.replace(/(["`$\\])/g, "\\$1");
}

export function escapeSingle(s) {
  return s.replace(/'/g, "'\"'\"'");
}
