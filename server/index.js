const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { spawn } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { codeRunner } = require("./services/codeRunnerServices");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());

// Base directory for user folders
const USER_BASE_DIR = path.join(__dirname, "user_folders");

// Ensure base directory exists
if (!fs.existsSync(USER_BASE_DIR)) {
  fs.mkdirSync(USER_BASE_DIR, { recursive: true });
}

// Store active user sessions
const activeShells = new Map();

// Create a custom shell wrapper that intercepts and validates all commands
function createShellWrapper(userId) {
  const userDir = path.join(USER_BASE_DIR, userId);
  const wrapperPath = path.join(userDir, ".shell_wrapper.js");
  
  // Create the wrapper script content
  const wrapperContent = `
#!/usr/bin/env node
const readline = require('readline');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// User's confined directory
const USER_DIR = "${userDir.replace(/\\/g, "\\\\")}";

// Commands that are completely forbidden
const FORBIDDEN_COMMANDS = [
  'sudo', 'su', 'chmod', 'chown', 'ssh', 'scp', 'ftp', 'wget', 'curl',
  'telnet', 'nc', 'netcat', 'ping', 'traceroute', 'dig', 'nslookup', 
  'ifconfig', 'ipconfig', 'netstat'
];

// Commands that can only operate within the user directory
const PATH_RESTRICTED_COMMANDS = [
  'cat', 'ls', 'dir', 'cd', 'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch',
  'echo', 'more', 'less', 'head', 'tail', 'grep', 'find', 'sed', 'awk',
  'nano', 'vi', 'vim', 'emacs', 'code', 'open', 'xdg-open', 'start'
];

// Start the real shell
const shell = spawn('${os.platform() === "win32" ? "powershell.exe" : "bash"}', [], {
  cwd: USER_DIR,
  stdio: ['pipe', 'pipe', 'pipe']
});

// Set up the readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '${userId}@sandbox:~$ '
});

// Output the initial prompt
rl.prompt();

// Display welcome message
console.log('\\n=== SANDBOX ENVIRONMENT ===');
console.log(\`You are restricted to the directory: \${USER_DIR}\`);
console.log('Some commands are restricted for security.\\n');

// Handle shell output
shell.stdout.on('data', (data) => {
  process.stdout.write(data);
  rl.prompt();
});

shell.stderr.on('data', (data) => {
  process.stderr.write(data);
  rl.prompt();
});

// Function to validate if a path is within the user directory
function isPathWithinUserDir(testPath) {
  // Resolve to absolute path
  const absPath = path.resolve(USER_DIR, testPath);
  return absPath.startsWith(USER_DIR);
}

// Function to validate a command
function validateCommand(command) {
  // Split the command by spaces to get the main command and arguments
  const parts = command.trim().split(/\\s+/);
  const mainCommand = parts[0].toLowerCase();
  
  // Check if command is forbidden
  if (FORBIDDEN_COMMANDS.includes(mainCommand)) {
    return {
      valid: false,
      message: \`Command '\${mainCommand}' is not allowed in this sandbox environment.\`
    };
  }
  
  // For path-restricted commands, validate all arguments that could be paths
  if (PATH_RESTRICTED_COMMANDS.includes(mainCommand)) {
    // Extract potential path arguments (skip the command itself)
    for (let i = 1; i < parts.length; i++) {
      const arg = parts[i];
      
      // Skip arguments that are flags
      if (arg.startsWith('-')) continue;
      
      // Skip arguments that are environment variables or special symbols
      if (arg.startsWith('$') || arg === '>' || arg === '>>' || arg === '|' || arg === '&') continue;
      
      // If the argument contains file path patterns, ensure they're within the user dir
      if (!isPathWithinUserDir(arg) && 
          // Don't block paths that are clearly not file paths
          !(arg.startsWith('--') || arg.match(/^[a-zA-Z0-9_-]+$/))) {
        return {
          valid: false,
          message: \`Access denied: You can only access files within your sandbox directory.\`
        };
      }
    }
  }
  
  // Handle shell escapes and command sequences
  if (command.includes('$(') || command.includes('\`') || 
      command.includes(';') || command.includes('&&') || 
      command.includes('||') || command.includes('|')) {
    
    // This is a simplified check - a production system would need more sophisticated parsing
    return {
      valid: false,
      message: \`Command sequences and shell escapes are not allowed in this sandbox.\`
    };
  }
  
  return { valid: true };
}

// Handle user input
rl.on('line', (line) => {
  const command = line.trim();
  
  // Handle exit command
  if (command === 'exit' || command === 'quit') {
    shell.kill();
    process.exit(0);
    return;
  }
  
  // Special command to show current directory
  if (command === 'pwd') {
    console.log(USER_DIR);
    rl.prompt();
    return;
  }
  
  // Skip empty commands
  if (!command) {
    rl.prompt();
    return;
  }
  
  // Validate the command
  const validation = validateCommand(command);
  if (!validation.valid) {
    console.log(\`\\x1b[31m\${validation.message}\\x1b[0m\`);
    rl.prompt();
    return;
  }
  
  // Execute the command
  shell.stdin.write(command + '\\n');
});

// Handle shell exit
shell.on('exit', () => {
  console.log('Shell exited');
  process.exit();
});

// Handle SIGINT (Ctrl+C)
rl.on('SIGINT', () => {
  shell.kill('SIGINT');
  rl.prompt();
});
  `;
  
  fs.writeFileSync(wrapperPath, wrapperContent);
  fs.chmodSync(wrapperPath, '755');
  
  return wrapperPath;
}

io.on("connection", (socket) => {
  console.log("Client connected");
  
  // Get user ID from socket (from query or headers)
  const userId = socket.handshake.query.userId || 
                 socket.handshake.headers.userId || 
                 `user_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}`;
  
  console.log(`User connected: ${userId}`);
  
  // Create user directory if it doesn't exist
  const userDir = path.join(USER_BASE_DIR, userId);
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
    
    // Create a welcome file in the user's directory
    fs.writeFileSync(
      path.join(userDir, "welcome.txt"), 
      `Welcome ${userId}! This is your private workspace.`
    );
  }
  
  // Create the shell wrapper script
  const wrapperPath = createShellWrapper(userId);
  
  // Start the shell process using our wrapper
  const shellProcess = spawn('node', [wrapperPath], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  
  // Store the shell process for this user
  activeShells.set(userId, shellProcess);

  shellProcess.stdout.on("data", (data) => {
    console.log(`[${userId}] stdout: ${data.toString().trim()}`);
    socket.emit("output-success", data.toString());
  });

  shellProcess.stderr.on("data", (data) => {
    console.log(`[${userId}] stderr: ${data.toString().trim()}`);
    socket.emit("output-error", data.toString());
  });

  socket.on("input", (data) => {
    shellProcess.stdin.write(data + "\n");
  });

  socket.on("disconnect", () => {
    shellProcess.kill();
    activeShells.delete(userId);
    console.log(`Client ${userId} disconnected`);
  });
});

app.post("/run/:language", (req, res) => {
  try {
    let code = req.body.code;
    const language = req.params.language;
    const userId = req.headers.userid || req.query.userId || `user_${Date.now().toString(36)}`;
    
    // Create user directory if it doesn't exist
    const userDir = path.join(USER_BASE_DIR, userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    
    // Save the code to the user's directory
    const filename = `${Date.now()}_code.${language}`;
    fs.writeFileSync(path.join(userDir, filename), code);
    
    // Get the user's shell process if it exists
    let shellProcess = activeShells.get(userId);
    
    if (!shellProcess) {
      // User is not connected via socket, create a temporary shell wrapper
      const wrapperPath = createShellWrapper(userId);
      shellProcess = spawn('node', [wrapperPath], {
        stdio: ["pipe", "pipe", "pipe"]
      });
      
      // Clean up the temporary shell after some time
      setTimeout(() => {
        if (shellProcess && !shellProcess.killed) {
          shellProcess.kill();
        }
      }, 30000); // 30 seconds timeout
    }
    
    // Run the code through our code runner, which should respect the sandbox too
    let isExecutedSuccessfully = codeRunner(language, code, shellProcess, userDir);
    
    if (isExecutedSuccessfully) {
      res.status(200).send({ 
        message: "Code running...",
        userDirectory: userId, // Only send the ID, not the full path for security
        filename: filename
      });
    } else {
      res.status(400).send({ message: "Invalid language" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Something went wrong!" });
  }
});

server.listen(8080, () => {
  console.log("Server running on port 8080");
  console.log(`User directories will be created in: ${USER_BASE_DIR}`);
});