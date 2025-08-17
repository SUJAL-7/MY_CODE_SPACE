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
    Tty: false,
  });
  return new Promise((resolve, reject) => {
    exec.start((err, stream) => {
      if (err) return reject(err);
      let out = "";
      stream.on("data", (d) => {
        out += d.toString("utf8");
      });
      stream.on("error", reject);
      stream.on("end", () => resolve(out));
    });
  });
}

/**
 * PATCHED listDirectory:
 * Emits lines with sentinel to avoid hidden control chars corrupting the type field.
 * Format: __FSE__|<dir|file>|<size>|<mtime>|<name>
 */
export async function listDirectory(container, relPath = "") {
  const rel = sanitizeRel(relPath);
  const ap = absPath(rel);

  const verify = await execCapture(
    container,
    `bash -lc 'test -d "${escapeBash(ap)}" && echo __OK__ || echo __NO__'`
  );
  if (!verify.includes("__OK__")) throw new Error("Directory not found");

  const script = `
set -e
shopt -s dotglob nullglob
for f in "${escapeBash(ap)}"/* "${escapeBash(ap)}"/.*; do
  b="$(basename "$f")"
  [ "$b" = "." ] && continue
  [ "$b" = ".." ] && continue
  [ ! -e "$f" ] && continue
  if [ -d "$f" ]; then
    printf "__FSE__|dir|0|%s|%s\\n" "$(stat -c %Y "$f" 2>/dev/null || echo 0)" "$b"
  else
    printf "__FSE__|file|%s|%s|%s\\n" "$(stat -c %s "$f" 2>/dev/null || echo 0)" "$(stat -c %Y "$f" 2>/dev/null || echo 0)" "$b"
  fi
done
`.trim();

  const raw = await execCapture(
    container,
    `bash -lc '${escapeSingle(script)}'`
  );

  const entries = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith("__FSE__|")) continue;
    const parts = trimmed.split("|");
    // Expect: [__FSE__, rawType, size, mtime, name]
    if (parts.length !== 5) continue;
    const rawType = parts[1].trim();
    const sizeStr = parts[2].trim();
    const mtimeStr = parts[3].trim();
    const name = parts[4];
    if (!name) continue;

    const normalizedType = rawType === "dir" ? "directory" : "file";
    const entryPath = rel ? `${rel}/${name}` : name;
    entries.push({
      name,
      path: entryPath,
      rawType,
      type: normalizedType,
      isDir: normalizedType === "directory",
      size: Number(sizeStr) || 0,
      mtime: (Number(mtimeStr) || 0) * 1000,
    });
  }

  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { path: rel, entries };
}

// (Leave the rest of your functions unchanged below; include them in the file.)
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
    return {
      path: rel,
      truncated: true,
      size,
      content: buf.toString("utf8"),
    };
  } else {
    const b64 = await execCapture(
      container,
      `bash -lc 'base64 -w0 "${escapeBash(ap)}"'`
    );
    const buf = Buffer.from(b64, "base64");
    return {
      path: rel,
      truncated: false,
      size,
      content: buf.toString("utf8"),
    };
  }
}

export async function writeFile(container, relPath, content) {
  const rel = sanitizeRel(relPath);
  if (!rel) throw new Error("File path required");
  const ap = absPath(rel);
  const parent = path.posix.dirname(ap);
  await execCapture(
    container,
    `bash -lc 'mkdir -p "${escapeBash(parent)}"'`
  );
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

export async function createDirectory(container, relPath) {
  const rel = sanitizeRel(relPath);
  if (!rel) throw new Error("Directory path required");
  const ap = absPath(rel);
  await execCapture(
    container,
    `bash -lc 'mkdir -p "${escapeBash(ap)}" || true'`
  );
  return { path: rel, type: "directory", isDir: true };
}

export async function deleteEntry(container, relPath) {
  const rel = sanitizeRel(relPath);
  if (!rel) throw new Error("Path required");
  const ap = absPath(rel);
  await execCapture(
    container,
    `bash -lc 'rm -rf "${escapeBash(ap)}" || true'`
  );
  return { path: rel };
}

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

/* Helpers */
function escapeBash(p) {
  return p.replace(/(["`$\\])/g, "\\$1");
}
function escapeSingle(s) {
  return s.replace(/'/g, "'\"'\"'");
}