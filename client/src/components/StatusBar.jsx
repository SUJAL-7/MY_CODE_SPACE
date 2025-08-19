import PropTypes from "prop-types";
import { FiAlertCircle, FiCpu, FiWifi, FiWifiOff } from "react-icons/fi";

export default function StatusBar({ error, connected, sessionInfo }) {
  return (
    <div className="h-6 flex items-center justify-between px-3 bg-[#007acc] text-[#ffffff] text-xs font-medium border-t border-[#0062a3]">
      {/* Left side: Status indicators */}
      <div className="flex items-center gap-4">
        {/* Connection status */}
        <div className="flex items-center gap-1.5">
          {connected ? (
            <FiWifi className="w-3 h-3 text-[#4ec9b0]" />
          ) : (
            <FiWifiOff className="w-3 h-3 text-[#f48771]" />
          )}
          <span className={connected ? "text-[#4ec9b0]" : "text-[#f48771]"}>
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>

        {/* Session info */}
        {sessionInfo && (
          <div className="flex items-center gap-1.5 text-[#e6e6e6]">
            <FiCpu className="w-3 h-3 opacity-80" />
            <span className="opacity-90">Session:</span>
            <span className="font-mono text-[11px] truncate max-w-[10rem]">
              {sessionInfo.sessionId}
            </span>
          </div>
        )}
      </div>

      {/* Right side: Error message */}
      {error && (
        <div className="flex items-center gap-1.5 text-[#ffcccc] ml-4">
          <FiAlertCircle className="w-3 h-3" />
          <span className="truncate max-w-[20rem]">{error}</span>
        </div>
      )}

      {/* Center: Empty space for potential future elements */}
      <div className="flex-1"></div>
    </div>
  );
}

StatusBar.propTypes = {
  error: PropTypes.string,
  connected: PropTypes.bool.isRequired,
  sessionInfo: PropTypes.shape({
    sessionId: PropTypes.string,
  }),
};