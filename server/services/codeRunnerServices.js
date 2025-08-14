const fs = require("fs");
const path = require("path");
const Logger = require("../utils/logger");

/**
 * Execute code in user's sandbox directory
 */
const codeRunner = (language, code, session) => {
  const lang = language.toLowerCase();
  
  try {
    // Ensure dev directory exists in user's sandbox
    const devDir = path.join(session.userDir, "dev");
    if (!fs.existsSync(devDir)) {
      fs.mkdirSync(devDir, { recursive: true });
    }
    
    let filename, command;
    
    switch (lang) {
      case "javascript":
        filename = "main.js";
        command = `cd dev && node ${filename}`;
        break;
      case "python":
        filename = "main.py";
        command = `cd dev && python3 ${filename}`;
        break;
      case "c++":
        filename = "main.cpp";
        command = `cd dev && g++ ${filename} -o main.out && ./main.out && rm -f main.out`;
        break;
      case "typescript":
        filename = "main.ts";
        command = `cd dev && tsc ${filename} && node main.js`;
        break;
      default:
        Logger.warn("Unsupported language", { language, userId: session.userId });
        return false;
    }
    
    // Write code to file in user's dev directory
    const filePath = path.join(devDir, filename);
    fs.writeFileSync(filePath, code);
    
    Logger.info("Code written and executing", { 
      language: lang, 
      filename, 
      userId: session.userId 
    });
    
    // Execute the command
    return session.executeCommand(command);
    
  } catch (error) {
    Logger.error("Code execution failed", { 
      language: lang, 
      userId: session.userId, 
      error: error.message 
    });
    return false;
  }
};

module.exports = { codeRunner };
