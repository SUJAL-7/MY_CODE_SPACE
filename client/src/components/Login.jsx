import React, { useState } from "react";

export default function Login({ setUsername }) {
  const [input, setInput] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    setUsername(input.trim());
    // The cookie will be set after successful session creation.
  };

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <label htmlFor="username" className="text-lg">Enter username:</label>
        <input
          id="username"
          value={input}
          onChange={e => setInput(e.target.value)}
          autoFocus
          className="p-2 rounded text-black"
        />
        <button
          type="submit"
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
        >
          Start Session
        </button>
      </form>
    </div>
  );
}