import { useState, useEffect } from "react";
import axios from "axios";
import { notify } from "../../utils/notification";

const useFileReader = () => {
  const readBoilerFile = (language, setBoilerPlate) => {
    let extension;

    if (language === "C++") extension = "cpp";
    else if (language === "Java") extension = "java";
    else if (language === "Python") extension = "py";
    else if (language === "JavaScript") extension = "js";
    else if (language === "TypeScript") extension = "ts";
    else extension="txt";

    fetch(`boiler-plate/main.${extension}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        return response.text();
      })
      .then((text) => {
        console.log(text);
        setBoilerPlate(text);
        return text;
      })
      .catch((error) => {
        notify("Error reading boiler plate code", "error");
      });
  };

  return { readBoilerFile };
};

export default useFileReader;
