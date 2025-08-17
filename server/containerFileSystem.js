/**
 * Container-native workspace filesystem operations.
 * All I/O is performed inside the container via docker exec / archive APIs.
 *
 * Restrictions:
 *  - Access is limited to WORKSPACE_PATH (default /workspace) inside the container.
 *  - Paths from clients are treated as relative ("" => workspace root).
 *  - No parent traversal is allowed (.. stripped).
 *
 * Provides:
 *  - listDirectory(container, relPath)
 *  - readFile(container, relPath)
 *  - writeFile(container, relPath, content)
 *  - createDirectory(container, relPath)
 *  - deleteEntry(container, relPath)
 *  - renameEntry(container, fromRel, toRel)
 *  - createDownloadArchive(container, relPath) (returns a tar stream & filename)
 *
 * Notes:
 *  - For readFile <= MAX_INLINE_READ bytes, we use base64 via exec for speed.
 *  - For larger reads / downloads, use getArchive (tar).
 */

import path from "path";
import tar from "tar-stream";

const WORKSPACE_PATH = process.env.WORKSPACE_PATH || "/workspace";
const MAX_INLINE_READ = 256 * 1024; // 256 KB

function sanitizeRel(p) {
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

function absPath(rel) {
  return rel ? path.posix.join(WORKSPACE_PATH, rel) : WORKSPACE_PATH;
}

async function execCapture(container, cmd) {
  const exec = await container.exec({
    Cmd: ["bash", "-lc", cmd],
    AttachStdout: true,
    AttachStderr: true,
    Tty: false
  });
  return new Promise((resolve, reject) => {
    exec.start((err, stream) => {
      if (err) return reject(err);
      let out = "";
      stream.on("data", d => { out += d.toString("utf8"); });
      stream.on("error", reject);
      stream.on("end", () => resolve(out));
    });
  });
}

export async function listDirectory(container, relPath = "") {
  const rel = sanitizeRel(relPath);
  const ap = absPath(rel);
  // Verify directory
  const verify = await execCapture(container, `bash -lc 'test -d "${escapeBash(ap)}" && echo __OK__ || echo __NO__'`);
  if (!verify.includes("__OK__")) throw new Error("Directory not found");

  // Use a single ls + stat style output: type|size|mtime|name
  // hidden included
  const script = `
set -e
shopt -s dotglob nullglob
for f in "${escapeBash(ap)}"/* "${escapeBash(ap)}"/.*; do
  [ "$(basename "$f")" = "." ] && continue
  [ "$(basename "$f")" = ".." ] && continue
  [ ! -e "$f" ] && continue
  if [ -d "$f" ]; then
    printf "dir|0|%s|%s\\n" "$(stat -c %Y "$f" 2>/dev/null || echo 0)" "$(basename "$f")"
  else
    printf "file|%s|%s|%s\\n" "$(stat -c %s "$f" 2>/dev/null || echo 0)" "$(stat -c %Y "$f" 2>/dev/null || echo 0)" "$(basename "$f")"
  fi
done
`.trim();

  const raw = await execCapture(container, `bash -lc '${escapeSingle(script)}'`);
  const entries = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("|");
    if (parts.length !== 4) continue;
    const [type, sizeStr, mtimeStr, name] = parts;
    if (!name) continue;
    entries.push({
      name,
      type,
      size: Number(sizeStr) || 0,
      mtime: Number(mtimeStr) * 1000,
      path: rel ? `${rel}/${name}` : name
    });
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { path: rel, entries };
}

export async function readFile(container, relPath) {
  const rel = sanitizeRel(relPath);
  if (!rel) throw new Error("File path required");
  const ap = absPath(rel);
  // Check file
  const check = await execCapture(container, `bash -lc 'test -f "${escapeBash(ap)}" && echo __F__ || echo __NO__'`);
  if (!check.includes("__F__")) throw new Error("Not a file");
  // Size
  const sizeOut = await execCapture(container, `bash -lc 'stat -c %s "${escapeBash(ap)}" 2>/dev/null || echo 0'`);
  const size = Number(sizeOut.trim()) || 0;
  if (size > MAX_INLINE_READ) {
    // Partial read
    const headCmd = `dd if="${escapeBash(ap)}" bs=1 count=${MAX_INLINE_READ} 2>/dev/null | base64 -w0`;
    const b64 = await execCapture(container, `bash -lc '${headCmd}'`);
    const buf = Buffer.from(b64, "base64");
    return {
      path: rel,
      truncated: true,
      size,
      content: buf.toString("utf8")
    };
  } else {
    const b64 = await execCapture(container, `bash -lc 'base64 -w0 "${escapeBash(ap)}"'`);
    const buf = Buffer.from(b64, "base64");
    return {
      path: rel,
      truncated: false,
      size,
      content: buf.toString("utf8")
    };
  }
}

export async function writeFile(container, relPath, content) {
  const rel = sanitizeRel(relPath);
  if (!rel) throw new Error("File path required");
  const ap = absPath(rel);
  // Ensure parent dir
  const parent = path.posix.dirname(ap);
  await execCapture(container, `bash -lc 'mkdir -p "${escapeBash(parent)}"'`);
  // Create tar with file
  const pack = tar.pack();
  const chunks = [];
  pack.entry({ name: path.posix.basename(ap), mode: 0o644, size: Buffer.byteLength(content) }, content);
  pack.finalize();

  // Wrap into directory-level archive to put at parent
  await container.putArchive(pack, { path: parent });

  // Stat after write
  const sizeOut = await execCapture(container, `bash -lc 'stat -c %s "${escapeBash(ap)}" 2>/dev/null || echo 0'`);
  const mtimeOut = await execCapture(container, `bash -lc 'stat -c %Y "${escapeBash(ap)}" 2>/dev/null || echo 0'`);
  return { path: rel, size: Number(sizeOut.trim()) || 0, mtime: (Number(mtimeOut.trim()) || 0) * 1000 };
}

export async function createDirectory(container, relPath) {
  const rel = sanitizeRel(relPath);
  if (!rel) throw new Error("Directory path required");
  const ap = absPath(rel);
  await execCapture(container, `bash -lc 'mkdir -p "${escapeBash(ap)}" || true'`);
  return { path: rel };
}

export async function deleteEntry(container, relPath) {
  const rel = sanitizeRel(relPath);
  if (!rel) throw new Error("Path required");
  const ap = absPath(rel);
  await execCapture(container, `bash -lc 'rm -rf "${escapeBash(ap)}" || true'`);
  return { path: rel };
}

export async function renameEntry(container, fromRelPath, toRelPath) {
  const fromRel = sanitizeRel(fromRelPath);
  const toRel = sanitizeRel(toRelPath);
  if (!fromRel || !toRel) throw new Error("Both paths required");
  const fromAp = absPath(fromRel);
  const toAp = absPath(toRel);
  const toDir = path.posix.dirname(toAp);
  await execCapture(container, `bash -lc 'mkdir -p "${escapeBash(toDir)}" && mv "${escapeBash(fromAp)}" "${escapeBash(toAp)}"'`);
  return { from: fromRel, to: toRel };
}

export async function createDownloadArchive(container, relPath) {
  const rel = sanitizeRel(relPath);
  const ap = absPath(rel);
  // Determine if path exists
  const typ = await execCapture(container, `bash -lc 'if [ -d "${escapeBash(ap)}" ]; then echo DIR; elif [ -f "${escapeBash(ap)}" ]; then echo FILE; else echo NO; fi'`);
  if (typ.includes("NO")) throw new Error("Not found");
  const base = path.posix.basename(ap) || "download";
  const stream = await container.getArchive({ path: ap });
  return { stream, filename: base + ".tar" };
}

/* ---------------- Helpers ---------------- */
function escapeBash(p) {
  return p.replace(/(["`$\\])/g, "\\$1");
}
function escapeSingle(s) {
  return s.replace(/'/g, "'\"'\"'");
}