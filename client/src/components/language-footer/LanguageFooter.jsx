import React from "react";
import { TbArrowsShuffle } from "react-icons/tb";

const LanguageFooter = ({selectedLanguage}) => {
  return (
    <div className="absolute bg-opacity-60 bg-[#181818] w-full h-5 bottom-0 text-xs text-gray-500 flex items-center justify-end pr-6">
      <TbArrowsShuffle className="mr-1" /> Selected Language: {selectedLanguage}
    </div>
  );
};

export default LanguageFooter;
