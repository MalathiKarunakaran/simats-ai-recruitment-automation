import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "@/App";
import { AuthProvider } from "@/auth/AuthContext";
import { CampusProvider } from "@/campus/CampusContext";
import { ToastProvider } from "@/components/ui/toast";
import { ThemeProvider } from "@/theme/ThemeContext";
import "@/index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <CampusProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </CampusProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
