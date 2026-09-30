import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import "@fontsource/inter/400";
import "@fontsource/inter/500";
import "@fontsource/inter/600";
import "@fontsource/inter/700";
import "@fontsource/jetbrains-mono/400";
import "@fontsource/jetbrains-mono/500";
import "@/styles/globals.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Verity: missing #root element");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
