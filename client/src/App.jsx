import { useState, useCallback } from "react";
import TerminalView from "./components/terminal/TerminalView";
import FileExplorer from "./components/files/FileExplorer";

/**
 * Layout:
 *  - Left: File Explorer (with internal editor)
 *  - Right: Terminal
 *
 * Terminal establishes the session; when ready it passes sessionId/token up.
 * FileExplorer then uses the session to perform file operations.
 */
const App = () => {
  const [username] = useState("user");
  const [sessionInfo, setSessionInfo] = useState(null);

  const handleSessionInfo = useCallback((info) => {
    setSessionInfo(info);
  }, []);

  return (
    <div className="w-screen h-screen flex flex-row overflow-hidden font-sans">
      {/* File Explorer Panel */}
      <div className="h-full flex-shrink-0">
        <FileExplorer session={sessionInfo} collapsed={false} />
      </div>

      {/* Resize handle placeholder (optional future drag) */}
      <div className="w-[4px] bg-neutral-800 cursor-col-resize" />

      {/* Terminal */}
      <div className="flex-1 min-w-0 flex">
        <TerminalView username={username} onSessionInfo={handleSessionInfo} />
      </div>
    </div>
  );
};

export default App;