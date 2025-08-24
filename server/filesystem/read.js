import { sanitizeRel, absPath, escapeBash } from "./utils/pathUtils.js";
import { execCapture } from "./utils/containerUtils.js";

const MAX_INLINE_READ = 256 * 1024; // 256 KB

export async function readFile(container, relPath) {
  const rel = sanitizeRel(relPath);
  if (!rel) throw new Error("File path required");
  const ap = absPath(rel);

  const check = await execCapture(
    container,
    `bash -lc 'test -f "${escapeBash(ap)}" && echo __F__ || echo __NO__'`
  );
  if (!check.includes("__F__")) throw new Error("Not a file");

  const sizeOut = await execCapture(
    container,
    `bash -lc 'stat -c %s "${escapeBash(ap)}" 2>/dev/null || echo 0'`
  );
  const size = Number(sizeOut.trim()) || 0;

  if (size > MAX_INLINE_READ) {
    const headCmd = `dd if="${escapeBash(ap)}" bs=1 count=${MAX_INLINE_READ} 2>/dev/null | base64 -w0`;
    const b64 = await execCapture(container, `bash -lc '${headCmd}'`);
    const buf = Buffer.from(b64, "base64");
    return { path: rel, truncated: true, size, content: buf.toString("utf8") };
  } else {
    const b64 = await execCapture(
      container,
      `bash -lc 'base64 -w0 "${escapeBash(ap)}"'`
    );
    const buf = Buffer.from(b64, "base64");
    return { path: rel, truncated: false, size, content: buf.toString("utf8") };
  }
}
