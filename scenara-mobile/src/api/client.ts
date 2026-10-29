import axios from "axios";
import { API_BASE_URL } from "../config/api";
import { PROJECT_PAUSED } from "../config/paused";
import { archiveAdapter } from "./archive";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000, // 60s — allows Render.com free-tier cold start (can reach 50s+)
  headers: {
    "Content-Type": "application/json",
  },
});

// Optional read-only archive mode. Normal builds use the live API.
if (PROJECT_PAUSED) {
  api.defaults.adapter = archiveAdapter;
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error.response) {
      // Distinguish a true axios timeout (ECONNABORTED) from other failures
      // like CORS, connection refused, or no internet. This lets callers
      // decide whether to retry (timeout = server cold) vs show a real error.
      const isTimeout =
        error.code === "ECONNABORTED" ||
        (error.message ?? "").toLowerCase().includes("timeout");

      return Promise.reject({
        message: isTimeout ? "Request timed out" : "Network error",
        isTimeout,
        originalError: error,
      });
    }

    const { status, data } = error.response;

    return Promise.reject({
      status,
      data,
      message: data?.detail || data?.error || "Backend error",
    });
  },
);
