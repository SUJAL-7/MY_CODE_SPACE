# Secure Code Execution Server

A secure, production-ready server for executing code in isolated sandboxed environments with comprehensive security controls and session management.

## 🔐 Security Features

### User Isolation
- **Isolated Sandboxes**: Each user gets a private directory sandbox
- **Session Management**: User sessions with automatic cleanup and timeouts
- **Connection Limits**: Configurable maximum concurrent connections
- **Resource Monitoring**: Memory usage and session statistics tracking

### Command Validation
- **Forbidden Commands**: Blocks dangerous system commands (sudo, ssh, etc.)
- **Path Restrictions**: Ensures file access stays within user sandbox
- **Input Validation**: Size limits and format validation for all inputs
- **Safe Code Execution**: Allows secure compilation and execution patterns

### Resource Management
- **Session Timeouts**: Automatic cleanup of inactive sessions (default: 30 minutes)
- **Code Size Limits**: Maximum code input size (default: 1MB)
- **Process Cleanup**: Proper cleanup of shell processes on disconnect
- **Memory Monitoring**: Real-time memory usage tracking

## 🚀 API Endpoints

### Code Execution
```http
POST /run/:language
Content-Type: application/json

{
  "code": "console.log('Hello World!');"
}
```

**Supported Languages:**
- `javascript` - Node.js execution
- `python` - Python 3 execution  
- `c++` - GCC compilation and execution
- `typescript` - TypeScript compilation and execution

**Response:**
```json
{
  "success": true,
  "message": "Code execution started",
  "userDirectory": "user_abc123",
  "filename": "1234567890_code.js",
  "executionId": "user_abc123_1234567890"
}
```

### Health Check
```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2023-01-01T00:00:00.000Z",
  "totalSessions": 5,
  "activeSessions": 3,
  "connectionCount": 2,
  "memoryUsage": { "rss": 50000000, "heapTotal": 10000000 }
}
```

### Statistics
```http
GET /stats
```

## 🔌 Socket.io Events

### Client Events
- `input` - Send command to user's shell session

### Server Events  
- `output-success` - Successful command output
- `output-error` - Error output or security violations

## ⚙️ Configuration

Create a `.env` file based on `.env.example`:

```bash
# Security Settings
MAX_CONNECTIONS=100          # Maximum concurrent connections
SESSION_TIMEOUT=1800000      # Session timeout in milliseconds (30 min)
CODE_EXECUTION_TIMEOUT=30000 # Code execution timeout (30 sec)
MAX_CODE_SIZE=1048576        # Maximum code size in bytes (1MB)

# Server Settings
PORT=8080                    # Server port
LOG_LEVEL=info              # Logging level (error, warn, info, debug)

# File System
USER_BASE_DIR=./user_folders # Base directory for user sandboxes
```

## 🏗️ Architecture

### UserSession Class
- Manages individual user shell processes
- Handles command validation and execution
- Automatic process cleanup and resource management
- Session timeout and activity tracking

### SessionManager Class
- Centralized session lifecycle management
- Connection limit enforcement
- Periodic cleanup of inactive sessions
- Statistics and monitoring

### Security Utilities
- Command validation with forbidden/restricted lists
- Input sanitization and size validation
- Path traversal prevention
- Safe code execution pattern recognition

## 🔍 Security Validation

### Forbidden Commands
```
sudo, su, chmod, chown, ssh, scp, sftp, ftp, wget, curl,
telnet, nc, netcat, ping, traceroute, dig, nslookup,
ifconfig, ipconfig, netstat, mount, umount, fdisk, mkfs,
passwd, useradd, userdel, systemctl, service, iptables
```

### Safe Code Execution Patterns
```bash
cd dev && node filename.js         # JavaScript execution
cd dev && python3 filename.py      # Python execution  
cd dev && g++ ... && ./executable  # C++ compilation/execution
cd dev && tsc ... && node ...      # TypeScript compilation/execution
```

### Path Restrictions
- All file operations must stay within user's sandbox directory
- No access to system directories (/etc, /proc, /sys, etc.)
- No directory traversal attacks (../)

## 📊 Monitoring

The server provides real-time monitoring through:
- Health endpoint for uptime and basic stats
- Statistics endpoint for detailed session info
- Structured JSON logging with configurable levels
- Memory usage tracking

## 🚨 Error Handling

- Comprehensive input validation
- Graceful handling of shell process failures
- Automatic session recovery and cleanup
- Detailed error logging with user context
- Security violation reporting

## 🔄 Session Lifecycle

1. **Creation**: User connects via Socket.io or HTTP API
2. **Initialization**: Sandbox directory and shell process created
3. **Activity**: Commands validated and executed in isolated environment
4. **Timeout**: Automatic cleanup after inactivity period
5. **Cleanup**: Shell processes killed, resources freed

## 🛡️ Security Best Practices

- Regular security audits of command validation
- Monitor for unusual activity patterns  
- Keep system dependencies updated
- Use environment variables for sensitive configuration
- Implement proper logging and alerting
- Regular cleanup of user directories