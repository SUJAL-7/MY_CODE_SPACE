const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const { spawn } = require("child_process");
const cors = require("cors");
const { codeRunner } = require("./services/codeRunnerServices"); // If unused you may remove
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

/**
 * sessions: Map<socketId, { username, rootDir, cwd, createdAt }>
 */
const sessions = new Map();

const WORKSPACES_BASE = path.join(__dirname, "user_workspaces");
ensureDirSync(WORKSPACES_BASE);

// ---------- Utility Helpers ----------

function ensureDirSync(p) {
  if (!fsSync.existsSync(p)) fsSync.mkdirSync(p, { recursive: true });
}

async function ensureDir(p) {
  try { await fs.access(p); } catch { await fs.mkdir(p, { recursive: true }); }
}

function sanitizeUsername(name = "user") {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "user";
}

function normalizeCommandInput(raw) {
  // Example normalization (keep simple)
  return raw.replace(/^\s*cd\.\.(?=$|\s|\/)/, "cd ..").trim();
}

/**
 * Safe path resolution within workspace root.
 * Accepts absolute-like inputs by stripping leading / and treating relative to root.
 */
function safeResolve(root, currentRel, targetRel) {
  const raw = targetRel && targetRel.length ? targetRel : ".";
  let candidate;
  if (path.isAbsolute(raw)) {
    candidate = path.join(root, raw.replace(/^\/+/, ""));
  } else {
    candidate = path.join(root, currentRel, raw);
  }
  const resolved = path.resolve(candidate);
  if (!resolved.startsWith(root)) {
    return null;
  }
  return resolved;
}

function relativeDisplay(root, abs) {
  return path.relative(root, abs) || ".";
}

function buildPrompt(session) {
  return `[${session.username}@IDE] ${session.cwd}$ `;
}

/**
 * Produce Unix-like rwxrwxrwx string (simplified) + file type.
 */
function fileModeString(stat) {
  const mode = stat.mode;
  const isDir = stat.isDirectory();
  const type = isDir ? "d" : "-";
  const triplet = (bits) =>
    (bits & 4 ? "r" : "-") + (bits & 2 ? "w" : "-") + (bits & 1 ? "x" : "-");
  const owner = triplet((mode >> 6) & 0o7);
  const group = triplet((mode >> 3) & 0o7);
  const other = triplet(mode & 0o7);
  return type + owner + group + other;
}

/**
 * Argument parser with flag clustering.
 * Supports:
 *   command [-abc] [--long] -- path-starting-with-dash
 * End of flags marker: --
 */
function parseCommandLine(rawLine) {
  const tokens = rawLine.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { command: "", flags: new Set(), positional: [] };

  const command = tokens.shift();
  const flags = new Set();
  const positional = [];
  let endOfFlags = false;

  for (const token of tokens) {
    if (!endOfFlags && token === "--") {
      endOfFlags = true;
      continue;
    }
    if (!endOfFlags && token.startsWith("--") && token.length > 2) {
      // whole long flag
      flags.add(token.slice(2));
    } else if (!endOfFlags && token.startsWith("-") && token.length > 1) {
      // cluster of short flags
      const cluster = token.slice(1).split("");
      cluster.forEach(f => flags.add(f));
    } else {
      positional.push(token);
    }
  }
  return { command, flags, positional };
}

/**
 * Directory listing (simple)
 */
async function listDirectorySimple(absPath, root) {
  const entries = await fs.readdir(absPath, { withFileTypes: true });
  return entries
    .map(e => {
      const name = e.name + (e.isDirectory() ? "/" : "");
      return name;
    })
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Directory or file info in long format.
 */
async function listLong(absPath, root) {
  const lines = [];
  const stat = await fs.stat(absPath);
  if (stat.isDirectory()) {
    const entries = await fs.readdir(absPath, { withFileTypes: true });
    for (const dirent of entries) {
      const entryAbs = path.join(absPath, dirent.name);
      const s = await fs.stat(entryAbs);
      lines.push(formatLongEntry(entryAbs, s, dirent.isDirectory(), root));
    }
  } else {
    lines.push(formatLongEntry(absPath, stat, stat.isDirectory(), root));
  }
  return lines.sort((a, b) => a.localeCompare(b));
}

function formatLongEntry(abs, stat, isDir, root) {
  const mode = fileModeString(stat);
  const size = String(stat.size).padStart(8, " ");
  const mtime = new Date(stat.mtime).toISOString().replace("T", " ").slice(0, 19);
  let name = path.basename(abs);
  if (isDir) name += "/";
  return `${mode} ${size} ${mtime} ${name}`;
}

/**
 * Remove path (file or directory recursively).
 */
async function removePath(absPath, { recursive = false, force = false, rootDir }) {
  try {
    const stat = await fs.stat(absPath).catch(err => {
      if (force && err.code === "ENOENT") return null;
      throw err;
    });
    if (!stat) return { ok: true, msg: "missing (ignored)" };
    if (absPath === rootDir) {
      return { ok: false, msg: "refusing to remove workspace root" };
    }
    if (stat.isDirectory()) {
      if (!recursive) return { ok: false, msg: "is a directory (use -r)" };
      if (fs.rm) {
        await fs.rm(absPath, { recursive: true, force: true });
      } else {
        await removeDirRecursiveLegacy(absPath);
      }
      return { ok: true, msg: "removed directory" };
    } else {
      await fs.unlink(absPath);
      return { ok: true, msg: "removed file" };
    }
  } catch (e) {
    if (force) return { ok: true, msg: `ignored error (${e.message})` };
    return { ok: false, msg: e.message };
  }
}

async function removeDirRecursiveLegacy(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeDirRecursiveLegacy(full);
    } else {
      await fs.unlink(full).catch(() => {});
    }
  }
  await fs.rmdir(dir).catch(() => {});
}

/**
 * Read file safely (utf8)
 */
async function readFileSafe(absPath) {
  return fs.readFile(absPath, "utf8");
}

/**
 * Write file (creating dirs)
 */
async function writeFileSafe(absPath, content = "") {
  await ensureDir(path.dirname(absPath));
  await fs.writeFile(absPath, content, "utf8");
}

// ---------- Pseudo Shell Command Handler ----------
async function handlePseudoShellCommand(socket, session, input) {
  const raw = input || "";
  const normalized = normalizeCommandInput(raw);
  if (!normalized) return;

  // Parse line
  const { command: cmd, flags, positional } = parseCommandLine(normalized);

  const send = (type, msg) => {
    // Ensure trailing newline for consistency with typical terminal output
    if (!msg.endsWith("\n")) msg += "\n";
    socket.emit(type, msg);
  };

  const emitCwd = () => {
    socket.emit("cwd-update", { cwd: session.cwd });
  };

  switch (cmd) {
    case "":
      return;

    case "help":
      send("output-success",
`Available commands (sandboxed):
  help                       Show this help
  ls [-l] [-a] [path]        List directory (long or include dotfiles)
  pwd                        Show current directory
  cd <path>                  Change directory (restricted)
  cat <file>                 Show file contents
  touch <file>               Create empty file
  mkdir <dir>                Create directory
  rm [-r] [-f] <path...>     Remove file(s) / dir(s)
  run <lang> <file>          Execute file (node|python|py|js)
  clear                      (Client side – not processed here)
Notes:
  - Use -- to stop flag parsing (e.g. rm -- -filename).
  - Paths are restricted to your workspace.
  - Parent traversal outside root is blocked.
`);
      break;

    case "pwd": {
      send("output-success", relativeDisplay(session.rootDir, path.join(session.rootDir, session.cwd)));
      emitCwd();
      break;
    }

    case "ls": {
      const targetRel = positional[0] || ".";
      const abs = safeResolve(session.rootDir, session.cwd, targetRel);
      if (!abs) return send("output-error", "Access denied");
      try {
        const stat = await fs.stat(abs);
        const showAll = flags.has("a") || flags.has("all");
        const longFmt = flags.has("l") || flags.has("long");

        if (!longFmt) {
          if (!stat.isDirectory()) {
            // Just show filename (like simple ls)
            const base = path.basename(abs);
            send("output-success", stat.isDirectory() ? base + "/" : base);
          } else {
            const names = await fs.readdir(abs, { withFileTypes: true });
            const filtered = names.filter(d => showAll || !d.name.startsWith("."));
            const out = filtered
              .map(d => d.name + (d.isDirectory() ? "/" : ""))
              .sort((a, b) => a.localeCompare(b));
            send("output-success", out.join("\n"));
          }
        } else {
          // Long format
            if (!stat.isDirectory()) {
            const lines = await listLong(abs, session.rootDir);
            send("output-success", lines.join("\n"));
          } else {
            const entries = await fs.readdir(abs, { withFileTypes: true });
            const filtered = entries.filter(d => showAll || !d.name.startsWith("."));
            const lines = [];
            for (const dirent of filtered) {
              const entryAbs = path.join(abs, dirent.name);
              const s = await fs.stat(entryAbs);
              lines.push(formatLongEntry(entryAbs, s, dirent.isDirectory(), session.rootDir));
            }
            lines.sort((a, b) => a.localeCompare(b));
            send("output-success", lines.join("\n"));
          }
        }
      } catch {
        send("output-error", "Not found");
      }
      break;
    }

    case "cd": {
      if (!positional.length) positional.push(".");
      const targetRel = positional[0];
      const abs = safeResolve(session.rootDir, session.cwd, targetRel);
      if (!abs) {
        send("output-error", "Access denied");
        break;
      }
      try {
        const stat = await fs.stat(abs);
        if (!stat.isDirectory()) {
          send("output-error", "Not a directory");
          break;
        }
        session.cwd = path.relative(session.rootDir, abs) || ".";
        emitCwd();
        send("output-success", ""); // empty line like many shells
      } catch {
        send("output-error", "Directory not found");
      }
      break;
    }

    case "cat": {
      if (!positional[0]) {
        send("output-error", "File required");
        break;
      }
      const abs = safeResolve(session.rootDir, session.cwd, positional[0]);
      if (!abs) {
        send("output-error", "Access denied");
        break;
      }
      try {
        const stat = await fs.stat(abs);
        if (stat.isDirectory()) {
          send("output-error", "Is a directory");
          break;
        }
        const data = await readFileSafe(abs);
        // cat typically outputs without forcing extra newline; keep data as-is
        socket.emit("output-success", data.endsWith("\n") ? data : data + "\n");
      } catch {
        send("output-error", "Cannot read file");
      }
      break;
    }

    case "touch": {
      if (!positional[0]) {
        send("output-error", "Filename required");
        break;
      }
      const abs = safeResolve(session.rootDir, session.cwd, positional[0]);
      if (!abs) {
        send("output-error", "Access denied");
        break;
      }
      try {
        await writeFileSafe(abs, "");
        send("output-success", `Created ${relativeDisplay(session.rootDir, abs)}`);
      } catch {
        send("output-error", "Failed to create file");
      }
      break;
    }

    case "mkdir": {
      if (!positional[0]) {
        send("output-error", "Directory name required");
        break;
      }
      const abs = safeResolve(session.rootDir, session.cwd, positional[0]);
      if (!abs) {
        send("output-error", "Access denied");
        break;
      }
      try {
        await ensureDir(abs);
        send("output-success", `Created directory ${relativeDisplay(session.rootDir, abs)}`);
      } catch {
        send("output-error", "Failed to create directory");
      }
      break;
    }

    case "rm": {
      if (!positional.length) {
        send("output-error", "Path required");
        break;
      }
      const recursive = flags.has("r") || flags.has("R");
      const force = flags.has("f");
      const results = [];
      for (const target of positional) {
        const abs = safeResolve(session.rootDir, session.cwd, target);
        if (!abs) {
          results.push(`rm: ${target}: access denied`);
          if (!force) break;
          continue;
        }
        const { ok, msg } = await removePath(abs, { recursive, force, rootDir: session.rootDir });
        const rel = relativeDisplay(session.rootDir, abs);
        if (!ok && !force) {
          results.push(`rm: ${rel}: ${msg}`);
          break;
        } else {
          results.push(`rm: ${rel}: ${msg}`);
        }
      }
      send(results.some(r => r.includes("access denied") || r.includes("refusing") || r.includes("error") || r.includes("ENOENT")) ? "output-error" : "output-success", results.join("\n"));
      break;
    }

    case "run": {
      if (positional.length < 2) {
        send("output-error", "Usage: run <language> <file>");
        break;
      }
      const language = positional[0].toLowerCase();
      const fileRel = positional.slice(1).join(" ");
      const abs = safeResolve(session.rootDir, session.cwd, fileRel);
      if (!abs) {
        send("output-error", "Access denied");
        break;
      }
      try {
        const stat = await fs.stat(abs);
        if (stat.isDirectory()) {
          send("output-error", "Cannot run a directory");
          break;
        }
      } catch {
        send("output-error", "File not found");
        break;
      }

      try {
        let cmd, cmdArgs;
        if (["node", "js", "javascript"].includes(language)) {
          cmd = "node"; cmdArgs = [abs];
        } else if (["python", "py", "python3"].includes(language)) {
          cmd = "python3"; cmdArgs = [abs];
        } else {
          send("output-error", "Unsupported language");
          break;
        }

        const proc = spawn(cmd, cmdArgs, {
          cwd: path.dirname(abs),
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 15_000
        });

        proc.stdout.on("data", d => socket.emit("output-success", d.toString()));
        proc.stderr.on("data", d => socket.emit("output-error", d.toString()));
        proc.on("close", codeExit => {
          send("output-success", `[process exited with code ${codeExit}]`);
        });
      } catch (e) {
        send("output-error", `Execution failed: ${e.message}`);
      }
      break;
    }

    case "clear":
      // Client usually clears screen locally; send blank line
      send("output-success", "");
      break;

    default:
      send("output-error", `Unknown or disallowed command: ${cmd}\nType 'help' for help.`);
  }
}

// ---------- Socket Handling ----------
io.on("connection", async (socket) => {
  socket.on("join-user-workspace", async (usernameRaw) => {
    const username = sanitizeUsername(usernameRaw || "user");
    const workspaceId = uuidv4().slice(0, 12);
    const rootDir = path.join(WORKSPACES_BASE, `${username}_${workspaceId}`);
    await ensureDir(rootDir);

    // Seed minimal files (ignore errors)
    try {
      await Promise.all([
        fs.writeFile(path.join(rootDir, "README.md"),
`# Workspace
User: ${username}
Session: ${workspaceId}
Created: ${new Date().toISOString()}
`),
        fs.writeFile(path.join(rootDir, "hello.js"), `console.log("Hello from ${username}'s workspace");\n`)
      ]);
    } catch {}

    sessions.set(socket.id, {
      username,
      rootDir,
      cwd: ".",
      createdAt: new Date()
    });

    socket.emit("workspace-ready", {
      userLogin: username,
      userDir: rootDir,
      socketId: socket.id,
      connectedAt: new Date()
    });

    socket.emit("cwd-update", { cwd: "." });

    socket.emit("output-success",
`Welcome ${username}!
Type 'help' to see available commands.
Your workspace root is locked to: ${rootDir}
`);
  });

  socket.on("input", (rawCommand) => {
    const session = sessions.get(socket.id);
    if (!session) {
      socket.emit("output-error", "Workspace not initialized. Reconnect.\n");
      return;
    }
    handlePseudoShellCommand(socket, session, rawCommand);
  });

  socket.on("disconnect", async () => {
    const session = sessions.get(socket.id);
    if (session) {
      try {
        await fs.rm(session.rootDir, { recursive: true, force: true });
      } catch {}
      sessions.delete(socket.id);
    }
  });
});

// ---------- REST: list files for a given socket ----------
app.get("/api/socket/:socketId/files", async (req, res) => {
  const sess = sessions.get(req.params.socketId);
  if (!sess) return res.status(404).json({ error: "Session not found" });
  const tree = await buildTree(sess.rootDir, sess.rootDir);
  res.json({ files: tree });
});

async function buildTree(dir, base) {
  const out = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full);
    if (e.isDirectory()) {
      out.push({
        name: e.name,
        path: rel,
        type: "directory",
        children: await buildTree(full, base)
      });
    } else {
      let stat;
      try { stat = await fs.stat(full); } catch { continue; }
      out.push({
        name: e.name,
        path: rel,
        type: "file",
        size: stat.size,
        modified: stat.mtime
      });
    }
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

// ---------- Health ----------
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    activeSessions: sessions.size,
    timestamp: new Date().toISOString()
  });
});

// ---------- Startup ----------
server.listen(8080, () => {
  console.log("Secure pseudo-shell IDE server on 8080");
  console.log("Workspaces root:", WORKSPACES_BASE);
});

// ---------- Graceful Shutdown ----------
process.on("SIGTERM", async () => {
  for (const [, sess] of sessions) {
    try { await fs.rm(sess.rootDir, { recursive: true, force: true }); } catch {}
  }
  process.exit(0);
});