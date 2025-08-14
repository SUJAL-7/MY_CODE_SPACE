const config = require('../config/config');

class Logger {
  static levels = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
  };

  static getCurrentLevel() {
    return this.levels[config.LOG_LEVEL] || this.levels.info;
  }

  static log(level, message, meta = {}) {
    if (this.levels[level] <= this.getCurrentLevel()) {
      const timestamp = new Date().toISOString();
      const logData = {
        timestamp,
        level: level.toUpperCase(),
        message,
        ...meta
      };
      
      console.log(JSON.stringify(logData));
    }
  }

  static error(message, meta = {}) {
    this.log('error', message, meta);
  }

  static warn(message, meta = {}) {
    this.log('warn', message, meta);
  }

  static info(message, meta = {}) {
    this.log('info', message, meta);
  }

  static debug(message, meta = {}) {
    this.log('debug', message, meta);
  }
}

module.exports = Logger;