import React, { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import useFileReader from "../../hooks/file-reader/useFileReader";

const CodeEditor = ({ code, setCode, language }) => {
  const { readBoilerFile } = useFileReader();

  useEffect(() => {
    readBoilerFile(language, setCode);
  }, [language]);

  const setEditorTheme = (monaco) => {
    monaco.editor.defineTheme("customTheme", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#1f1f1f",
      },
    });
  };

  const getLanguage = (lang) => {
    switch (lang) {
      case "C++":
        return "cpp";
      case "JavaScript":
        return "javascript";
      case "TypeScript":
        return "typescript";
      case "Python":
        return "python";
      default:
        return "plaintext";
    }
  };

  return (
    <>
      <Editor
        beforeMount={setEditorTheme}
        language={getLanguage(language)}
        height={"94vh"}
        theme="customTheme"
        value={code}
        onChange={(value) => setCode(value)}
        options={{
          inlineSuggest: true,
          fontSize: 14,
          // readOnlyMessage: { value: "Read only editor" },
          formatOnType: true,
          autoClosingBrackets: "always",
          // readOnly: true,
          minimap: { enabled: false },
          padding: {
            top: 10,
          },
        }}
      />
    </>
  );
};

export default CodeEditor;
