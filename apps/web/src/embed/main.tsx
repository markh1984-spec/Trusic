import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EmbedPlayer } from "./EmbedPlayer";
import "./embed.css";

// ?theme=light or ?theme=dark picks the colours; without it the player follows the visitor's device.
const theme = new URLSearchParams(window.location.search).get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

createRoot(document.getElementById("embed")!).render(
  <StrictMode>
    <EmbedPlayer />
  </StrictMode>,
);
