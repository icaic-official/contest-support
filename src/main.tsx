import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ConnectedApp } from "./connected/ConnectedApp";
import { applyTheme } from "./lib/theme";
import "./index.css";
applyTheme();
const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing.");
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <ConnectedApp />
    </BrowserRouter>
  </StrictMode>,
);
