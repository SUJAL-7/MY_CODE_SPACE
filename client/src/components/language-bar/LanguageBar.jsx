import React from "react";
import { FaJava } from "react-icons/fa";
import { DiJavascript1 } from "react-icons/di";
import { SiCplusplus } from "react-icons/si";
import { FaPython } from "react-icons/fa";
import { SiTypescript } from "react-icons/si";
import { SiJavascript } from "react-icons/si";

const languages = [
  // {
  //   name: "Java",
  //   icon: <FaJava className="text-2xl" />,
  // },
  {
    name: "JavaScript",
    icon: <SiJavascript className="text-2xl" />,
  },
  {
    name: "TypeScript",
    icon: <SiTypescript className="text-2xl" />,
  },
  {
    name: "C++",
    icon: <SiCplusplus className="text-2xl" />,
  },
  {
    name: "Python",
    icon: <FaPython className="text-2xl" />,
  },
];

const LanguageBar = ({ selectedLanguage, setSelectedLanguage }) => {
  return (
    <div className="m-2 flex flex-col justify-between h-[90vh]">
      <div className="flex flex-col gap-2 justify-center">
        {languages.map((language) => (
          <button
            className={`border-[#1f1f1f] ${
              selectedLanguage === language.name
                ? "bg-green-700 border-green-700"
                : "bg-[#1f1f1f] hover:bg-[#252a33]"
            } border-2 text-white p-2 aspect-square grid place-items-center rounded-lg w-full `}
            onClick={() => setSelectedLanguage(language.name)}
          >
            {language.icon}
          </button>
        ))}
      </div>
      <div className="text-white -rotate-90 tracking-wider text-lg">
        DevSpace
      </div>
    </div>
  );
};

export default LanguageBar;
