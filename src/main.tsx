import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { createWebEyeTrackBlinkProvider } from "./gaze";
import { BlinkAACApp } from "./ui/blink-aac";
import { GazeAACApp } from "./ui/gaze-legacy";

const params = new URLSearchParams(window.location.search);
const blinkApp = <BlinkAACApp providerFactory={createWebEyeTrackBlinkProvider} />;
const legacyApp = <GazeAACApp />;

createRoot(document.getElementById("root")!).render(
  <StrictMode>{params.has("legacy") ? legacyApp : blinkApp}</StrictMode>,
);