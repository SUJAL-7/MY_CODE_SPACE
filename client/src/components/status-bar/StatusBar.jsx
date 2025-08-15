import React from "react";
import { labelFromEditorLang } from "../../utils/inferLanguage";

const StatusBar = ({ filePath, languageId, dirty }) => {
  return (
    <div className="w-full h-6 bg-[#202020] border-t border-neutral-700 flex items-center justify-between px-3 text-[11px] text-neutral-400 font-mono">
      <span className="truncate">{filePath || "No file open"}</span>
      <span className="flex items-center gap-3">
        <span>{labelFromEditorLang(languageId)}</span>
        {dirty && <span className="text-amber-400">● unsaved</span>}
      </span>
    </div>
  );
};

export default StatusBar;