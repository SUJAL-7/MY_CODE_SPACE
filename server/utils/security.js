const path = require('path');

// Commands that are completely forbidden
const FORBIDDEN_COMMANDS = [
  'sudo', 'su', 'chmod', 'chown', 'ssh', 'scp', 'sftp', 'ftp', 'wget', 'curl',
  'telnet', 'nc', 'netcat', 'ping', 'traceroute', 'dig', 'nslookup', 
  'ifconfig', 'ipconfig', 'netstat', 'mount', 'umount', 'fdisk', 'mkfs',
  'passwd', 'useradd', 'userdel', 'groupadd', 'groupdel', 'crontab',
  'systemctl', 'service', 'iptables', 'ufw', 'firewall-cmd'
];

// Commands that can only operate within the user directory
const PATH_RESTRICTED_COMMANDS = [
  'cat', 'ls', 'dir', 'cd', 'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch',
  'echo', 'more', 'less', 'head', 'tail', 'grep', 'find', 'sed', 'awk',
  'nano', 'vi', 'vim', 'emacs', 'code', 'open', 'xdg-open', 'start'
];

/**
 * Validates if a path is within the user directory
 * @param {string} testPath - Path to validate
 * @param {string} userDir - User's sandbox directory
 * @returns {boolean} - True if path is safe
 */
function isPathWithinUserDir(testPath, userDir) {
  try {
    const absPath = path.resolve(userDir, testPath);
    return absPath.startsWith(userDir);
  } catch (error) {
    return false;
  }
}

/**
 * Validates a command for security compliance
 * @param {string} command - Command to validate
 * @param {string} userDir - User's sandbox directory
 * @returns {Object} - Validation result with valid flag and message
 */
function validateCommand(command, userDir) {
  if (!command || typeof command !== 'string') {
    return { valid: false, message: 'Invalid command format' };
  }

  // Check for dangerous patterns first
  if (isDangerousCommand(command)) {
    return {
      valid: false,
      message: 'Command contains dangerous patterns and is not allowed'
    };
  }

  // Split the command by spaces to get the main command and arguments
  const parts = command.trim().split(/\s+/);
  const mainCommand = parts[0].toLowerCase();
  
  // Check if command is forbidden
  if (FORBIDDEN_COMMANDS.includes(mainCommand)) {
    return {
      valid: false,
      message: `Command '${mainCommand}' is not allowed in this sandbox environment`
    };
  }
  
  // For path-restricted commands, validate all arguments that could be paths
  if (PATH_RESTRICTED_COMMANDS.includes(mainCommand)) {
    const pathValidation = validateCommandPaths(parts, userDir);
    if (!pathValidation.valid) {
      return pathValidation;
    }
  }
  
  return { valid: true };
}

/**
 * Checks for dangerous command patterns
 * @param {string} command - Command to check
 * @returns {boolean} - True if command contains dangerous patterns
 */
function isDangerousCommand(command) {
  // Allow safe command sequences for code execution
  if (isSafeCodeExecutionCommand(command)) {
    return false;
  }
  
  const dangerousPatterns = [
    /\$\(.*\)/, // Command substitution
    /`.*`/, // Backtick command substitution
    /;/, // Command separator
    /&&/, // AND operator
    /\|\|/, // OR operator  
    /\|(?!\|)/, // Pipe operator (but not OR)
    />/, // Redirection
    /</, // Input redirection
    /&\s*$/, // Background process
    /\.\./,  // Directory traversal
    /\/etc/, // System directories
    /\/proc/, // Process filesystem
    /\/sys/, // System filesystem
    /\/dev/, // Device filesystem
    /\/root/, // Root directory
    /\/bin/, // Binary directories
    /\/sbin/,
    /\/usr\/bin/,
    /\/usr\/sbin/
  ];

  return dangerousPatterns.some(pattern => pattern.test(command));
}

/**
 * Checks if a command is a safe code execution command
 * @param {string} command - Command to check
 * @returns {boolean} - True if it's a safe code execution command
 */
function isSafeCodeExecutionCommand(command) {
  const safePatterns = [
    /^cd\s+dev\s+&&\s+node\s+[\w.]+$/, // cd dev && node filename
    /^cd\s+dev\s+&&\s+python3?\s+[\w.]+$/, // cd dev && python filename
    /^cd\s+dev\s+&&\s+g\+\+\s+[\w.]+\s+-o\s+[\w.]+\s+&&\s+\.\/[\w.]+\s+&&\s+rm\s+-f\s+[\w.]+$/, // C++ compilation and execution
    /^cd\s+dev\s+&&\s+tsc\s+[\w.]+\s+&&\s+node\s+[\w.]+$/ // TypeScript compilation and execution
  ];
  
  return safePatterns.some(pattern => pattern.test(command));
}

/**
 * Validates paths in command arguments
 * @param {Array} parts - Command parts
 * @param {string} userDir - User directory
 * @returns {Object} - Validation result
 */
function validateCommandPaths(parts, userDir) {
  // Extract potential path arguments (skip the command itself)
  for (let i = 1; i < parts.length; i++) {
    const arg = parts[i];
    
    // Skip arguments that are flags or special symbols
    if (arg.startsWith('-') || 
        arg.startsWith('$') || 
        ['>', '>>', '|', '&', '&&', '||'].includes(arg)) {
      continue;
    }
    
    // If the argument looks like a path and is not within user dir
    if (arg.includes('/') || arg.includes('\\')) {
      if (!isPathWithinUserDir(arg, userDir)) {
        return {
          valid: false,
          message: 'Access denied: You can only access files within your sandbox directory'
        };
      }
    }
  }
  
  return { valid: true };
}

/**
 * Validates input size
 * @param {string} input - Input to validate
 * @param {number} maxSize - Maximum allowed size
 * @returns {Object} - Validation result
 */
function validateInputSize(input, maxSize) {
  if (!input || typeof input !== 'string') {
    return { valid: false, message: 'Invalid input' };
  }
  
  if (Buffer.byteLength(input, 'utf8') > maxSize) {
    return { 
      valid: false, 
      message: `Input size exceeds maximum allowed size of ${maxSize} bytes` 
    };
  }
  
  return { valid: true };
}

/**
 * Sanitizes user ID to prevent path traversal
 * @param {string} userId - User ID to sanitize
 * @returns {string} - Sanitized user ID
 */
function sanitizeUserId(userId) {
  if (!userId || typeof userId !== 'string') {
    return null;
  }
  
  // Remove dangerous characters and limit length
  return userId
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .substring(0, 50);
}

module.exports = {
  validateCommand,
  validateInputSize,
  sanitizeUserId,
  isPathWithinUserDir,
  FORBIDDEN_COMMANDS,
  PATH_RESTRICTED_COMMANDS
};