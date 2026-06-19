import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initPendo } from "./lib/pendo";
import "./styles.css";

// Bring up Pendo (Novus) analytics before the first render.
initPendo();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
