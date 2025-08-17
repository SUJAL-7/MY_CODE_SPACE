// import React from "react";
import PropTypes from "prop-types";

export default function StatusBar({ error, connected, sessionInfo }) {
  return (
    <div className="h-7 flex items-center px-4 bg-gray-800 border-t border-gray-700 text-xs">
      <span className={`mr-4 ${connected ? "text-green-400" : "text-red-400"}`}>
        ● {connected ? "Connected" : "Disconnected"}
      </span>
      {sessionInfo && (
        <span className="mr-4 text-gray-300">
          Session: {sessionInfo.sessionId}
        </span>
      )}
      {error && (
        <span className="text-red-300">{error}</span>
      )}
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
