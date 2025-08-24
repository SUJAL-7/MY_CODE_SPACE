import path from "path";
import { sanitizeRel, absPath, escapeBash } from "./utils/pathUtils.js";
import { execCapture } from "./utils/containerUtils.js";

export async function createDownloadArchive(container, relPath) {
  const rel = sanitizeRel(relPath);
  const ap = absPath(rel);

  const typ = await execCapture(
    container,
    `bash -lc 'if [ -d "${escapeBash(ap)}" ]; then echo DIR; elif [ -f "${escapeBash(ap)}" ]; then echo FILE; else echo NO; fi'`
  );
  if (typ.includes("NO")) throw new Error("Not found");

  const base = path.posix.basename(ap) || "download";
  const stream = await container.getArchive({ path: ap });
  return { stream, filename: base + ".tar" };
}
