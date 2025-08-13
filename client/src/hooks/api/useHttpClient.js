import { useState } from "react";
import axios from "axios";
import { notify } from "../../utils/notification";
import { notifyType } from "../../utils/notificationType";

axios.defaults.baseURL = import.meta.env.VITE_BACKEND_URL;

const useHttpClient = () => {
  const [isLoading, setIsLoading] = useState(false);

  const sendRequest = async (
    url,
    method = "GET",
    body = null,
    headers = {},
    showSuccessToast = false,
    showErrorToast = true
  ) => {
    setIsLoading(true);
    console.log("URL REQUEST", url, " ", body);
    try {
      const response = await axios({
        url,
        method,
        data: body,
        headers,
      });
      console.log("URL RESPONSE", url, " ", response);
      if (showSuccessToast) notify(response.data.message, "success");
      return response;
    } catch (error) {
      console.log(error);
      if (showErrorToast)
        notify(error.response.data.message, notifyType(error.response.status));
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return { isLoading, setIsLoading, sendRequest };
};

export default useHttpClient;
