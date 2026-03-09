import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { installBrowserNodeInterface } from "@/renderer/browser-node-interface";
import { AppEventBridge } from "@/renderer/app-event-bridge";
import "@/renderer/globals.css";
import { queryClient } from "@/renderer/query";
import { router } from "@/renderer/router";

if (typeof window !== "undefined" && !window.nodeInterface) {
  installBrowserNodeInterface();
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppEventBridge />
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
