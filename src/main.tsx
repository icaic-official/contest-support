import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {ConnectedApp} from "./connected/ConnectedApp";
import "./styles.css";
async function mount() {
  // Historical simulated personas can only be loaded by a development server.
  const App = import.meta.env.DEV && import.meta.env.MODE === 'demo'
    ? (await import('./App')).default : ConnectedApp;
  const root = document.getElementById('root');
  if (!root) throw new Error('Application root is missing.');
  createRoot(root).render(<StrictMode><App /></StrictMode>);
}
void mount();
