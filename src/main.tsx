import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { MediaPipeBlinkProvider } from "./gaze/blink-provider";
import { BlinkAACApp } from "./ui/blink-aac";

const params = new URLSearchParams(window.location.search);
const root = createRoot(document.getElementById("root")!);

if (params.has("legacy")) {
  void import("./ui/gaze-legacy").then(({ GazeAACApp }) => {
    root.render(<StrictMode><GazeAACApp /></StrictMode>);
  });
} else {
  root.render(<StrictMode><BlinkAACApp providerFactory={() => new MediaPipeBlinkProvider()} /></StrictMode>);
}
