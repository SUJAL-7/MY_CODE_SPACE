import { sanitizeRel, absPath, escapeBash } from "./utils/pathUtils.js";
import { execCapture } from "./utils/containerUtils.js";

export async function deleteEntry(container, relPath) {
  const rel = sanitizeRel(relPath);
  if (!rel) throw new Error("Path required");
  const ap = absPath(rel);
  await execCapture(container, `bash -lc 'rm -rf "${escapeBash(ap)}" || true'`);
  return { path: rel };
}
