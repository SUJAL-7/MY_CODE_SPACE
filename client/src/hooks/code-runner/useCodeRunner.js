import useHttpClient from "../api/useHttpClient";
import { RUN_CODE } from "../../constants/apiEndpoints";

const useCodeRunner = () => {
  const { isLoading, sendRequest, setIsLoading } = useHttpClient();

  const runCode = async (language, code) => {
    try {
      await sendRequest(RUN_CODE(language), "POST", {
        code
      });
    } catch (error) {
      console.log(error);
    } finally {
      setIsLoading(false);
    }
  };

  return { isLoading, runCode };
};

export default useCodeRunner;
