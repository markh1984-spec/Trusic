import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { AuthProvider } from "./auth";
import { LibraryProvider } from "./library";
import { OfflineProvider } from "./offline/offline";
import { PlayerProvider } from "./player";
import { ToastProvider } from "./toast";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <LibraryProvider>
          <OfflineProvider>
            <PlayerProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </PlayerProvider>
          </OfflineProvider>
        </LibraryProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
