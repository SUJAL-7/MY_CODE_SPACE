import { useState, useRef, useEffect } from "react";
import { FiUser, FiArrowRight, FiCode, FiTerminal } from "react-icons/fi";
import PropTypes from "prop-types";

export default function Login({ setUsername }) {
  const [input, setInput] = useState("");
  const [touched, setTouched] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (!input.trim()) return;
    setUsername(input.trim());
  };

  const inputInvalid = touched && !input.trim();

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1e1e1e] px-4">
      <div className="w-full max-w-md flex flex-col items-center">
        {/* Brand Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="bg-[#4ec9b0] p-3 rounded-lg">
            <FiCode className="text-[#1e1e1e] w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-[#cccccc] tracking-tight">DevSpace IDE</h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="w-full bg-[#252526] rounded-lg border border-[#3e3e42] p-6 flex flex-col gap-5"
        >
          <div className="flex items-center gap-3 mb-2">
            <FiUser className="text-[#4ec9b0] w-5 h-5" />
            <h2 className="text-lg font-semibold text-[#cccccc]">Start Coding Session</h2>
          </div>
          
          <div className="w-full">
            <label
              htmlFor="username"
              className="block mb-2 text-sm font-medium text-[#858585]"
            >
              Enter your username
            </label>
            <input
              id="username"
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onBlur={() => setTouched(true)}
              autoFocus
              className={`w-full py-2.5 px-3 rounded bg-[#2d2d30] border text-[#cccccc] font-medium text-sm focus:outline-none focus:ring-2 focus:ring-[#4ec9b0] transition-all
                ${inputInvalid
                  ? "border-[#f48771] focus:ring-[#f48771]"
                  : "border-[#3e3e42] focus:border-[#4ec9b0]"
                }`}
              placeholder="Your name or handle"
              aria-invalid={inputInvalid}
              maxLength={32}
            />
            {inputInvalid && (
              <span className="text-xs text-[#f48771] mt-1.5 block">
                Please enter a username to continue
              </span>
            )}
          </div>
          
          <button
            type="submit"
            disabled={!input.trim()}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded text-white font-medium text-sm transition-all
              ${!input.trim() 
                ? "bg-[#3a3d41] text-[#858585] cursor-not-allowed" 
                : "bg-[#0e639c] hover:bg-[#1177bb] active:bg-[#0a4d78] shadow-sm"
              }`}
          >
            <FiTerminal className="w-4 h-4" />
            Launch Workspace
            <FiArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs text-[#858585]">
            Connect to your personal development environment
          </p>
        </div>
      </div>
    </div>
  );
}

Login.propTypes = {
  setUsername: PropTypes.func.isRequired,
};