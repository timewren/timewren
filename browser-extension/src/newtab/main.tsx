import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { seedProjectsCache } from "../lib/projects-cache";
import { createQueryClient } from "../lib/query-client";
import { initSentry } from "../lib/sentry";
import App from "./App";
import "./index.css";
import { initLocale } from "../i18n/init";

initSentry("newtab");

const queryClient = createQueryClient();
void seedProjectsCache(queryClient);

// Sproget læses fra lageret før første tegning, så der ikke blinker dansk
void initLocale().finally(() => {
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Mangler #root i dokumentet");
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  );
});
