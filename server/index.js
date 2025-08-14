const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

// Import our utilities and services
const config = require("./config/config");
const Logger = require("./utils/logger");
const SessionManager = require("./utils/SessionManager");
const { codeRunner } = require("./services/codeRunnerServices");
const { validateInputSize } = require("./utils/security");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: `${Math.floor(config.MAX_CODE_SIZE / 1024)}kb` }));

// Request logging middleware
app.use((req, res, next) => {
  Logger.info('HTTP Request', {
    method: req.method,
    path: req.path,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });
  next();
});

// Ensure base directory exists
if (!fs.existsSync(config.USER_BASE_DIR)) {
  fs.mkdirSync(config.USER_BASE_DIR, { recursive: true });
}

// Initialize session manager
const sessionManager = new SessionManager();

// Health check endpoint
app.get('/health', (req, res) => {
  const stats = sessionManager.getStats();
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    ...stats
  });
});

// Statistics endpoint  
app.get('/stats', (req, res) => {
  const stats = sessionManager.getStats();
  res.json(stats);
});

// Socket.io connection handling
io.on("connection", async (socket) => {
  let session = null;
  
  try {
    Logger.info("Client connecting", { socketId: socket.id });
    
    // Get user ID from socket
    const rawUserId = socket.handshake.query.userId || 
                     socket.handshake.headers.userId;
    
    // Create or get user session
    session = await sessionManager.createSession(rawUserId, socket);
    
    Logger.info("Client connected", { 
      userId: session.userId, 
      socketId: socket.id 
    });
    
    // Handle user input
    socket.on("input", (data) => {
      try {
        if (!data || typeof data !== 'string') {
          socket.emit("output-error", "Invalid input format\n");
          return;
        }
        
        // Validate input size
        const sizeValidation = validateInputSize(data, config.MAX_CODE_SIZE);
        if (!sizeValidation.valid) {
          socket.emit("output-error", `Error: ${sizeValidation.message}\n`);
          return;
        }
        
        session.executeCommand(data);
      } catch (error) {
        Logger.error("Error handling input", { 
          userId: session.userId, 
          error: error.message 
        });
        socket.emit("output-error", "An error occurred processing your command\n");
      }
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      Logger.info("Client disconnected", { 
        userId: session?.userId, 
        socketId: socket.id 
      });
      
      if (session) {
        sessionManager.handleSocketDisconnect(session.userId);
      }
    });
    
  } catch (error) {
    Logger.error("Error in socket connection", { 
      socketId: socket.id, 
      error: error.message 
    });
    
    socket.emit("output-error", `Connection error: ${error.message}\n`);
    socket.disconnect();
  }
});

// Code execution endpoint
app.post("/run/:language", async (req, res) => {
  let session = null;
  
  try {
    const { code } = req.body;
    const language = req.params.language;
    const rawUserId = req.headers.userid || req.query.userId;
    
    // Validate inputs
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ 
        success: false,
        message: "Code is required and must be a string" 
      });
    }
    
    if (!language || typeof language !== 'string') {
      return res.status(400).json({ 
        success: false,
        message: "Language parameter is required" 
      });
    }
    
    // Validate code size
    const sizeValidation = validateInputSize(code, config.MAX_CODE_SIZE);
    if (!sizeValidation.valid) {
      return res.status(400).json({
        success: false,
        message: sizeValidation.message
      });
    }
    
    // Create or get user session
    session = await sessionManager.createSession(rawUserId);
    
    Logger.info("Code execution request", { 
      userId: session.userId, 
      language, 
      codeSize: Buffer.byteLength(code, 'utf8') 
    });
    
    // Save the code to the user's directory  
    const filename = session.writeCodeFile(code, language);
    
    // Execute the code
    const executed = codeRunner(language, code, session);
    
    if (executed) {
      res.status(200).json({ 
        success: true,
        message: "Code execution started",
        userDirectory: session.userId,
        filename: filename,
        executionId: `${session.userId}_${Date.now()}`
      });
    } else {
      res.status(400).json({ 
        success: false,
        message: `Unsupported language: ${language}` 
      });
    }
    
  } catch (error) {
    Logger.error("Code execution error", { 
      userId: session?.userId,
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({ 
      success: false,
      message: "Internal server error occurred during code execution" 
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  Logger.error("Unhandled HTTP error", {
    error: error.message,
    path: req.path,
    method: req.method
  });
  
  res.status(500).json({
    success: false,
    message: "Internal server error"
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint not found"
  });
});

// Graceful shutdown handling
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown(signal) {
  Logger.info(`Received ${signal}, starting graceful shutdown...`);
  
  try {
    // Stop accepting new connections
    server.close(() => {
      Logger.info('HTTP server closed');
    });
    
    // Shutdown session manager
    await sessionManager.shutdown();
    
    Logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    Logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
}

// Start server
server.listen(config.PORT, () => {
  Logger.info("Server started", {
    port: config.PORT,
    environment: config.NODE_ENV,
    userBaseDir: config.USER_BASE_DIR,
    maxConnections: config.MAX_CONNECTIONS,
    sessionTimeout: config.SESSION_TIMEOUT
  });
});