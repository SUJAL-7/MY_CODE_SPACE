import PropTypes from "prop-types";
import { FiLogOut, FiUser, FiCpu, FiCode } from "react-icons/fi";

export default function TopBar({
  username,
  sessionInfo,
  setUsername,
  setSessionInfo,
  socketRef,
  onLogout, 
}) {
  const handleLogout = () => {
    setUsername("");
    setSessionInfo(null);
    if (socketRef.current) socketRef.current.disconnect();
    document.cookie =
      "sessionId=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    if (onLogout) onLogout();
  };

  return (
    <header className="flex items-center justify-between px-4 h-11 bg-[#2d2d30] border-b border-[#3e3e42] z-20">
      {/* Left: Brand & Session Info */}
      <div className="flex items-center gap-5 min-w-0">
        <div className="flex items-center gap-2">
          <FiCode className="w-5 h-5 text-[#4ec9b0]" />
          <span className="font-semibold text-[15px] tracking-tight text-[#cccccc] select-none">
            DevSpace IDE
          </span>
        </div>
        
        {sessionInfo && (
          <div className="flex items-center gap-4 text-xs text-[#858585]">
            <div className="flex items-center gap-1.5" title="Logged-in user">
              <FiUser className="w-3.5 h-3.5" />
              <span className="font-medium text-[#d4d4d4]">{username}</span>
            </div>
            
            <div className="w-px h-4 bg-[#404040]" />
            
            <div className="flex items-center gap-1.5" title="Session ID">
              <FiCpu className="w-3.5 h-3.5" />
              <span className="truncate max-w-[8rem] font-mono text-[11px]">
                {sessionInfo.sessionId}
              </span>
            </div>
          </div>
        )}
      </div>
      
      {/* Right: Actions */}
      <div className="flex items-center gap-3">
        {sessionInfo && (
          <div className="flex items-center gap-2 text-xs text-[#858585] mr-2">
            <div className="w-2 h-2 rounded-full bg-[#4ec9b0] animate-pulse" />
            <span className="text-[#d4d4d4]">Connected</span>
          </div>
        )}
        
        <button
          className="flex items-center gap-2 bg-[#3a3d41] hover:bg-[#45494e] text-[#d4d4d4] px-3 py-1.5 rounded text-xs font-medium transition-colors focus:outline-none border border-[#4f5256]"
          onClick={handleLogout}
          title="Logout"
        >
          <FiLogOut className="w-3.5 h-3.5" />
          Logout
        </button>
      </div>
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
  onLogout: PropTypes.func,
};