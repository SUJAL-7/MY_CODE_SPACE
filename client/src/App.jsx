import { useState } from "react";
import CodeRunnerBtn from "./components/buttons/CodeRunnerBtn";
import CodeEditor from "./components/code-editor/CodeEditor";
import LanguageBar from "./components/language-bar/LanguageBar";
import LanguageFooter from "./components/language-footer/LanguageFooter";
import ProfileImg from "./components/profile/ProfileImg";
import Shell from "./components/shell/Shell";


const App = () => {

  const [selectedLanguage, setSelectedLanguage] = useState("JavaScript");
  const [code, setCode] = useState("");

  return (
    <div className="flex flex-row w-screen h-screen ">
      <div className="h-full w-[4%] bg-[#181818]">
        <ProfileImg/>
        <LanguageBar selectedLanguage={selectedLanguage} setSelectedLanguage={setSelectedLanguage}/>
      </div>
      <div className="w-[56%] h-full relative">
        <CodeRunnerBtn code={code} language={selectedLanguage} />
        <CodeEditor code={code} setCode={setCode} language={selectedLanguage}/>
        <LanguageFooter selectedLanguage={selectedLanguage}/>
      </div>
      <div className="w-[40%] h-full">
        <Shell />
      </div>
    </div>
  );
};

export default App;
