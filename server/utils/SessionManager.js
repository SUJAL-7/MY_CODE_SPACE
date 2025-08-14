const UserSession = require('./UserSession');
const Logger = require('./logger');
const config = require('../config/config');
const { sanitizeUserId } = require('./security');
const path = require('path');

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.connectionCount = 0;
    this.cleanupInterval = null;
    
    this.startCleanupTask();
    
    Logger.info('Session Manager initialized', {
      maxConnections: config.MAX_CONNECTIONS,
      sessionTimeout: config.SESSION_TIMEOUT,
      cleanupInterval: config.TEMP_CLEANUP_INTERVAL
    });
  }

  /**
   * Create or get existing user session
   */
  async createSession(rawUserId, socket = null) {
    // Sanitize user ID
    const userId = sanitizeUserId(rawUserId) || this.generateUserId();
    
    // Check connection limits
    if (socket && this.connectionCount >= config.MAX_CONNECTIONS) {
      Logger.warn('Connection limit exceeded', { 
        connectionCount: this.connectionCount,
        maxConnections: config.MAX_CONNECTIONS 
      });
      throw new Error('Server connection limit exceeded. Please try again later.');
    }

    // Get or create session
    let session = this.sessions.get(userId);
    
    if (!session) {
      const userDir = path.join(config.USER_BASE_DIR, userId);
      session = new UserSession(userId, userDir, socket);
      
      const initialized = await session.initialize();
      if (!initialized) {
        throw new Error('Failed to initialize user session');
      }
      
      this.sessions.set(userId, session);
      
      Logger.info('New session created', { 
        userId, 
        totalSessions: this.sessions.size 
      });
    } else {
      // Attach socket to existing session
      if (socket) {
        session.attachSocket(socket);
      }
      session.updateActivity();
      
      Logger.info('Existing session reused', { userId });
    }

    if (socket) {
      this.connectionCount++;
    }

    return session;
  }

  /**
   * Get session by user ID
   */
  getSession(userId) {
    return this.sessions.get(userId);
  }

  /**
   * Remove session
   */
  removeSession(userId) {
    const session = this.sessions.get(userId);
    if (session) {
      session.destroy();
      this.sessions.delete(userId);
      
      Logger.info('Session removed', { 
        userId, 
        totalSessions: this.sessions.size 
      });
    }
  }

  /**
   * Handle socket disconnection
   */
  handleSocketDisconnect(userId) {
    const session = this.sessions.get(userId);
    if (session) {
      session.detachSocket();
      this.connectionCount = Math.max(0, this.connectionCount - 1);
      
      Logger.info('Socket disconnected', { 
        userId, 
        connectionCount: this.connectionCount 
      });
    }
  }

  /**
   * Generate a unique user ID
   */
  generateUserId() {
    return `user_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}`;
  }

  /**
   * Get session statistics
   */
  getStats() {
    const activeSessions = Array.from(this.sessions.values());
    
    return {
      totalSessions: this.sessions.size,
      activeSessions: activeSessions.filter(s => s.isActive).length,
      connectionCount: this.connectionCount,
      sessionsWithSockets: activeSessions.filter(s => s.socket).length,
      oldestSession: activeSessions.length > 0 ? 
        Math.min(...activeSessions.map(s => s.createdAt.getTime())) : null,
      memoryUsage: process.memoryUsage()
    };
  }

  /**
   * Start cleanup task for inactive sessions
   */
  startCleanupTask() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveSessions();
    }, config.TEMP_CLEANUP_INTERVAL);
    
    Logger.debug('Cleanup task started');
  }

  /**
   * Cleanup inactive sessions
   */
  cleanupInactiveSessions() {
    const now = Date.now();
    const sessionsToRemove = [];
    
    for (const [userId, session] of this.sessions) {
      const timeSinceActivity = now - session.lastActivity.getTime();
      
      // Remove sessions that are inactive and don't have sockets
      if (!session.socket && timeSinceActivity > config.SESSION_TIMEOUT) {
        sessionsToRemove.push(userId);
      }
    }
    
    for (const userId of sessionsToRemove) {
      this.removeSession(userId);
    }
    
    if (sessionsToRemove.length > 0) {
      Logger.info('Cleanup completed', { 
        removedSessions: sessionsToRemove.length,
        remainingSessions: this.sessions.size 
      });
    }
  }

  /**
   * Graceful shutdown - cleanup all sessions
   */
  async shutdown() {
    Logger.info('Session manager shutting down...');
    
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Destroy all sessions
    const sessionIds = Array.from(this.sessions.keys());
    for (const userId of sessionIds) {
      this.removeSession(userId);
    }
    
    // Wait a moment for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    Logger.info('Session manager shutdown complete');
  }
}

module.exports = SessionManager;