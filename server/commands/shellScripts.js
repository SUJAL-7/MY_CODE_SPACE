const devFolder = "./dev";

// For bash shell
const runCppCodeCmd = `g++ ${devFolder}/main.cpp -o ${devFolder}/main.out && ${devFolder}/main.out && rm ${devFolder}/main.out;`;
const runPythonCodeCmd = `python3 ${devFolder}/main.py`;
const runNodeJsCodeCmd = `node ${devFolder}/main.js`;
const runTypescriptCodeCmd = `tsc ${devFolder}/main.ts && node ${devFolder}/main.js`;

module.exports = { runCppCodeCmd, runPythonCodeCmd, runNodeJsCodeCmd, runTypescriptCodeCmd };
