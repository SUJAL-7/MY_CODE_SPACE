import React from "react";
import { VscRunAll } from "react-icons/vsc";
import useCodeRunner from "../../hooks/code-runner/useCodeRunner";
import Spinner from "../spinner/Spinner";

const CodeRunnerBtn = ({ code, language }) => {
  const { runCode, isLoading } = useCodeRunner();

  return (
    <div className="h-[6vh] bg-[#181818] grid place-items-center">
      <button
        className="bg-green-700 py-1 rounded px-4 text-slate-100 text-sm flex flex-row gap-1 justify-center items-center"
        onClick={() => runCode(language, code)}
      >
        {isLoading ? (
          <Spinner color={"white"} width={"w-4"} marginRight="0" />
        ) : (
          <VscRunAll />
        )}
        <span>Run</span>
      </button>
    </div>
  );
};

export default CodeRunnerBtn;
