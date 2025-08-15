/**
 * File Explorer utilities for DevSpace sessions.
 * Provides safe, workspace-confined filesystem operations.
 */

import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import crypto from "crypto";

const MAX_READ_BYTES = 256 * 1024; // 256 KB inline read cutoff

export function resolveWorkspacePath(workspaceDir, relPath = "") {
  const safeRel = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const abs = path.normalize(path.join(workspaceDir, safeRel));
  if (!abs.startsWith(workspaceDir)) {
    throw new Error("Path outside workspace");
  }
  return abs;
}

export async function listDirectory(workspaceDir, relPath = "") {
  const abs = resolveWorkspacePath(workspaceDir, relPath);
  let stats;
  try { stats = await fs.stat(abs); } catch { throw new Error("Directory not found"); }
  if (!stats.isDirectory()) throw new Error("Not a directory");
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const result = [];
  for (const e of entries) {
    const full = path.join(abs, e.name);
    let st;
    try { st = await fs.stat(full); } catch { continue; }
    result.push({
      name: e.name,
      type: e.isDirectory() ? "dir" : "file",
      size: e.isDirectory() ? 0 : st.size,
      mtime: st.mtimeMs,
      path: path.posix.join(relPath.replace(/\\/g, "/"), e.name)
    });
  }
  // Sort dirs first then files alphabetically
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { path: relPath, entries: result };
}

export async function readFile(workspaceDir, relPath) {
  const abs = resolveWorkspacePath(workspaceDir, relPath);
  let st;
  try { st = await fs.stat(abs); } catch { throw new Error("File not found"); }
  if (!st.isFile()) throw new Error("Not a file");
  if (st.size > MAX_READ_BYTES) {
    // Stream first MAX_READ_BYTES
    const fh = await fs.open(abs, "r");
    const buf = Buffer.alloc(MAX_READ_BYTES);
    await fh.read(buf, 0, MAX_READ_BYTES, 0);
    await fh.close();
    return {
      path: relPath,
      truncated: true,
      size: st.size,
      content: buf.toString("utf8")
    };
  }
  const data = await fs.readFile(abs);
  // naive utf8 assumption; could add binary detection later
  return {
    path: relPath,
    truncated: false,
    size: st.size,
    content: data.toString("utf8")
  };
}

export async function writeFile(workspaceDir, relPath, content, { create = true, overwrite = true } = {}) {
  const abs = resolveWorkspacePath(workspaceDir, relPath);
  const exists = fsSync.existsSync(abs);
  if (!exists && !create) throw new Error("File does not exist");
  if (exists && !overwrite) throw new Error("File exists");
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  const st = await fs.stat(abs);
  return { path: relPath, size: st.size, mtime: st.mtimeMs };
}

export async function createDirectory(workspaceDir, relPath) {
  const abs = resolveWorkspacePath(workspaceDir, relPath);
  if (fsSync.existsSync(abs)) throw new Error("Already exists");
  await fs.mkdir(abs, { recursive: false });
  return { path: relPath };
}

export async function deleteEntry(workspaceDir, relPath) {
  const abs = resolveWorkspacePath(workspaceDir, relPath);
  if (!fsSync.existsSync(abs)) throw new Error("Not found");
  const st = await fs.stat(abs);
  if (st.isDirectory()) {
    // shallow protection? If you want to forbid non-empty directories, check first
    await fs.rm(abs, { recursive: true, force: true });
  } else {
    await fs.unlink(abs);
  }
  return { path: relPath };
}

export async function renameEntry(workspaceDir, fromRel, toRel) {
  const fromAbs = resolveWorkspacePath(workspaceDir, fromRel);
  const toAbs = resolveWorkspacePath(workspaceDir, toRel);
  if (!fsSync.existsSync(fromAbs)) throw new Error("Source not found");
  if (fsSync.existsSync(toAbs)) throw new Error("Destination exists");
  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  await fs.rename(fromAbs, toAbs);
  return { from: fromRel, to: toRel };
}

const downloadTokens = new Map(); // token -> { abs, filename, expires }

export function createDownloadToken(workspaceDir, relPath, lifetimeMs = 60_000) {
  const abs = resolveWorkspacePath(workspaceDir, relPath);
  if (!fsSync.existsSync(abs)) throw new Error("Not found");
  const token = crypto.randomBytes(20).toString("hex");
  downloadTokens.set(token, {
    abs,
    filename: path.basename(abs),
    expires: Date.now() + lifetimeMs
  });
  return token;
}

export function consumeDownloadToken(token) {
  const entry = downloadTokens.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    downloadTokens.delete(token);
    return null;
  }
  downloadTokens.delete(token);
  return entry;
}

// Periodic cleanup (optional)
setInterval(() => {
  const now = Date.now();
  for (const [t, e] of downloadTokens) {
    if (now > e.expires) downloadTokens.delete(t);
  }
}, 30_000);