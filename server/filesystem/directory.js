import { sanitizeRel, absPath, escapeBash } from "./utils/pathUtils.js";
import { execCapture } from "./utils/containerUtils.js";

export async function createDirectory(container, relPath) {
  const rel = sanitizeRel(relPath);
  if (!rel) throw new Error("Directory path required");
  const ap = absPath(rel);
  await execCapture(container, `bash -lc 'mkdir -p "${escapeBash(ap)}" || true'`);
  return { path: rel, type: "directory", isDir: true };
}
