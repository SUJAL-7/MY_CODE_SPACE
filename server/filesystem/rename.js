import path from "path";
import { sanitizeRel, absPath, escapeBash } from "./utils/pathUtils.js";
import { execCapture } from "./utils/containerUtils.js";

export async function renameEntry(container, fromRelPath, toRelPath) {
  const fromRel = sanitizeRel(fromRelPath);
  const toRel = sanitizeRel(toRelPath);
  if (!fromRel || !toRel) throw new Error("Both paths required");

  const fromAp = absPath(fromRel);
  const toAp = absPath(toRel);
  const toDir = path.posix.dirname(toAp);

  await execCapture(
    container,
    `bash -lc 'mkdir -p "${escapeBash(toDir)}" && mv "${escapeBash(fromAp)}" "${escapeBash(toAp)}"'`
  );
  return { from: fromRel, to: toRel };
}
