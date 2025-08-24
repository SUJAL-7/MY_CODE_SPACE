import { sanitizeRel, absPath, escapeBash, escapeSingle } from "./utils/pathUtils.js";
import { execCapture } from "./utils/containerUtils.js";

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

  const raw = await execCapture(container, `bash -lc '${escapeSingle(script)}'`);

  const entries = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("__FSE__|")) continue;
    const parts = trimmed.split("|");
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
