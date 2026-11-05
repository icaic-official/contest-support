import "./lib/zodConfig";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ConnectedApp } from "./connected/ConnectedApp";
import { RenderErrorBoundary } from "./components/render-error-boundary";
import { preloadRememberedScreen } from "./connected/lazyScreens";
import { applyTheme } from "./lib/theme";
import "./index.css";
applyTheme();
preloadRememberedScreen();
const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing.");
createRoot(root).render(
  <StrictMode>
    <RenderErrorBoundary scope="app">
      <BrowserRouter>
        <ConnectedApp />
      </BrowserRouter>
    </RenderErrorBoundary>
  </StrictMode>,
);
