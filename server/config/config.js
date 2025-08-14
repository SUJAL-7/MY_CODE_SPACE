const path = require('path');

// Environment-based configuration
const config = {
  // Server configuration
  PORT: process.env.PORT || 8080,
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Security settings
  MAX_CONNECTIONS: parseInt(process.env.MAX_CONNECTIONS) || 100,
  SESSION_TIMEOUT: parseInt(process.env.SESSION_TIMEOUT) || 30 * 60 * 1000, // 30 minutes
  CODE_EXECUTION_TIMEOUT: parseInt(process.env.CODE_EXECUTION_TIMEOUT) || 30000, // 30 seconds
  MAX_CODE_SIZE: parseInt(process.env.MAX_CODE_SIZE) || 1024 * 1024, // 1MB
  
  // File system settings
  USER_BASE_DIR: process.env.USER_BASE_DIR || path.join(__dirname, '..', 'user_folders'),
  TEMP_CLEANUP_INTERVAL: parseInt(process.env.TEMP_CLEANUP_INTERVAL) || 5 * 60 * 1000, // 5 minutes
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  
  // Rate limiting
  RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
};

// Validation
if (config.MAX_CONNECTIONS < 1) {
  throw new Error('MAX_CONNECTIONS must be at least 1');
}

if (config.SESSION_TIMEOUT < 60000) {
  throw new Error('SESSION_TIMEOUT must be at least 60 seconds');
}

module.exports = config;