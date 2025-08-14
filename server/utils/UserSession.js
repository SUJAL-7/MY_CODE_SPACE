const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { validateCommand } = require('../utils/security');
const Logger = require('../utils/logger');
const config = require('../config/config');

class UserSession {
  constructor(userId, userDir, socket = null) {
    this.userId = userId;
    this.userDir = userDir;
    this.socket = socket;
    this.shellProcess = null;
    this.isActive = false;
    this.createdAt = new Date();
    this.lastActivity = new Date();
    this.timeoutId = null;
    
    this.setupTimeout();
    
    Logger.info('User session created', { 
      userId: this.userId, 
      hasSocket: !!this.socket 
    });
  }

  /**
   * Initialize the user session
   */
  async initialize() {
    try {
      // Ensure user directory exists
      if (!fs.existsSync(this.userDir)) {
        fs.mkdirSync(this.userDir, { recursive: true });
        
        // Create a welcome file in the user's directory
        fs.writeFileSync(
          path.join(this.userDir, "welcome.txt"), 
          `Welcome ${this.userId}! This is your private workspace.\nCreated: ${new Date().toISOString()}`
        );
      }

      // Create shell process
      this.createShellProcess();
      this.isActive = true;
      
      Logger.info('User session initialized', { userId: this.userId });
      return true;
    } catch (error) {
      Logger.error('Failed to initialize user session', { 
        userId: this.userId, 
        error: error.message 
      });
      return false;
    }
  }

  /**
   * Create and configure shell process
   */
  createShellProcess() {
    const shell = os.platform() === "win32" ? "powershell.exe" : "bash";
    
    this.shellProcess = spawn(shell, [], {
      cwd: this.userDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: process.env.PATH,
        HOME: this.userDir,
        USER: this.userId
      }
    });

    // Handle shell output
    this.shellProcess.stdout.on("data", (data) => {
      this.updateActivity();
      
      const output = data.toString();
      Logger.debug('Shell stdout', { userId: this.userId, output: output.trim() });
      
      if (this.socket) {
        this.socket.emit("output-success", output);
      }
    });

    this.shellProcess.stderr.on("data", (data) => {
      this.updateActivity();
      
      const output = data.toString();
      Logger.debug('Shell stderr', { userId: this.userId, output: output.trim() });
      
      if (this.socket) {
        this.socket.emit("output-error", output);
      }
    });

    this.shellProcess.on('exit', (code, signal) => {
      Logger.info('Shell process exited', { 
        userId: this.userId, 
        code, 
        signal 
      });
      
      if (this.isActive) {
        // Restart shell if it exited unexpectedly
        setTimeout(() => {
          if (this.isActive) {
            this.createShellProcess();
          }
        }, 1000);
      }
    });

    this.shellProcess.on('error', (error) => {
      Logger.error('Shell process error', { 
        userId: this.userId, 
        error: error.message 
      });
    });
  }

  /**
   * Execute a command in the shell
   */
  executeCommand(command) {
    if (!this.isActive || !this.shellProcess) {
      throw new Error('Session is not active');
    }

    // Validate command
    const validation = validateCommand(command, this.userDir);
    if (!validation.valid) {
      Logger.warn('Command validation failed', { 
        userId: this.userId, 
        command, 
        reason: validation.message 
      });
      
      if (this.socket) {
        this.socket.emit("output-error", `Security: ${validation.message}\n`);
      }
      return false;
    }

    this.updateActivity();
    
    Logger.info('Executing command', { 
      userId: this.userId, 
      command: command.trim() 
    });
    
    this.shellProcess.stdin.write(command + "\n");
    return true;
  }

  /**
   * Write code to a file and return filename
   */
  writeCodeFile(code, language) {
    const timestamp = Date.now();
    const filename = `${timestamp}_code.${language}`;
    const filePath = path.join(this.userDir, filename);
    
    fs.writeFileSync(filePath, code);
    
    Logger.info('Code file written', { 
      userId: this.userId, 
      filename, 
      size: Buffer.byteLength(code, 'utf8') 
    });
    
    return filename;
  }

  /**
   * Update last activity timestamp and reset timeout
   */
  updateActivity() {
    this.lastActivity = new Date();
    this.setupTimeout();
  }

  /**
   * Setup session timeout
   */
  setupTimeout() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    
    this.timeoutId = setTimeout(() => {
      Logger.info('Session timeout', { userId: this.userId });
      this.destroy();
    }, config.SESSION_TIMEOUT);
  }

  /**
   * Get session info
   */
  getInfo() {
    return {
      userId: this.userId,
      isActive: this.isActive,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
      hasSocket: !!this.socket,
      uptime: Date.now() - this.createdAt.getTime()
    };
  }

  /**
   * Attach a socket to this session
   */
  attachSocket(socket) {
    this.socket = socket;
    this.updateActivity();
    
    Logger.info('Socket attached to session', { userId: this.userId });
  }

  /**
   * Detach socket from session
   */
  detachSocket() {
    this.socket = null;
    
    Logger.info('Socket detached from session', { userId: this.userId });
  }

  /**
   * Destroy the session and cleanup resources
   */
  destroy() {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;
    
    // Clear timeout
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    
    // Kill shell process
    if (this.shellProcess) {
      try {
        this.shellProcess.kill('SIGTERM');
        
        // Force kill after 5 seconds if still running
        setTimeout(() => {
          if (this.shellProcess && !this.shellProcess.killed) {
            this.shellProcess.kill('SIGKILL');
          }
        }, 5000);
      } catch (error) {
        Logger.error('Error killing shell process', { 
          userId: this.userId, 
          error: error.message 
        });
      }
      
      this.shellProcess = null;
    }
    
    Logger.info('User session destroyed', { userId: this.userId });
  }
}

module.exports = UserSession;