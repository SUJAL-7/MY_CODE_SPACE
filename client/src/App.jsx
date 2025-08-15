import React, { useState } from "react";
import TerminalView from "./components/terminal/TerminalView";

// Placeholder future components (Explorer, Editor, etc.)
const App = () => {
  const [username] = useState("user"); // Replace with real auth user if available.

  return (
    <div className="w-screen h-screen flex flex-row overflow-hidden font-sans">
      {/* Sidebar */}
      <div className="bg-[#181818] text-neutral-300 w-52 p-3 text-xs border-r border-neutral-700 flex flex-col gap-2">
        <div className="font-semibold tracking-wide">Sidebar</div>
        <div>Explorer (todo)</div>
        <div>Editor (todo)</div>
      </div>

      {/* Editor placeholder */}
      <div className="flex flex-col flex-1 border-r border-neutral-700">
        <div className="px-3 py-2 text-xs bg-[#202020] text-neutral-400 border-b border-neutral-700">
          Editor Panel (coming soon)
        </div>
        <div className="flex-1 flex items-center justify-center text-neutral-600 text-sm">
          Add file explorer & editor integration next.
        </div>
      </div>

      {/* Terminal */}
      <div className="flex" style={{ width: "40%" }}>
        <TerminalView username={username} />
      </div>
    </div>
  );
};

export default App;