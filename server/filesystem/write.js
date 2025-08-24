import path from "path";
import tar from "tar-stream";
import { sanitizeRel, absPath, escapeBash } from "./utils/pathUtils.js";
import { execCapture } from "./utils/containerUtils.js";

export async function writeFile(container, relPath, content) {
  const rel = sanitizeRel(relPath);
  if (!rel) throw new Error("File path required");
  const ap = absPath(rel);
  const parent = path.posix.dirname(ap);

  await execCapture(container, `bash -lc 'mkdir -p "${escapeBash(parent)}"'`);

  const pack = tar.pack();
  pack.entry(
    { name: path.posix.basename(ap), mode: 0o644, size: Buffer.byteLength(content) },
    content
  );
  pack.finalize();
  await container.putArchive(pack, { path: parent });

  const sizeOut = await execCapture(
    container,
    `bash -lc 'stat -c %s "${escapeBash(ap)}" 2>/dev/null || echo 0'`
  );
  const mtimeOut = await execCapture(
    container,
    `bash -lc 'stat -c %Y "${escapeBash(ap)}" 2>/dev/null || echo 0'`
  );
  return {
    path: rel,
    size: Number(sizeOut.trim()) || 0,
    mtime: (Number(mtimeOut.trim()) || 0) * 1000,
    type: "file",
    isDir: false,
  };
}
