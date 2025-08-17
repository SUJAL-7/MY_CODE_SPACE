// import React from "react";
import PropTypes from 'prop-types';

export default function TopBar({ username, sessionInfo, setUsername, setSessionInfo, socketRef }) {
  const handleLogout = () => {
    setUsername("");
    setSessionInfo(null);
    if (socketRef.current) socketRef.current.disconnect();
    document.cookie = "sessionId=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  };
  return (
    <header className="flex items-center justify-between px-6 py-3 bg-gray-800">
      <div>
        <span className="font-semibold text-lg">DevSpace</span>
        {sessionInfo && (
          <span className="ml-4 text-sm text-gray-400">
            User: {username} | Session: {sessionInfo.sessionId}
          </span>
        )}
      </div>
      <button
        className="bg-red-500 px-3 py-1 rounded text-sm"
        onClick={handleLogout}
      >
        Logout
      </button>
    </header>
  );
}

TopBar.propTypes = {
  username: PropTypes.string.isRequired,
  sessionInfo: PropTypes.shape({
    sessionId: PropTypes.string,
  }),
  setUsername: PropTypes.func.isRequired,
  setSessionInfo: PropTypes.func.isRequired,
  socketRef: PropTypes.shape({
    current: PropTypes.object,
  }).isRequired,
};
