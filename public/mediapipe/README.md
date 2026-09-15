# MediaPipe Face Landmarker assets

The default blink interface uses only MediaPipe Face Landmarker. It does not
load the full WebEyeTrack/BlazeGaze pipeline used by the legacy gaze screen.

- `wasm/`: emitted at build time from the pinned
  `@mediapipe/tasks-vision@0.10.18` dependency. The Vite development server
  serves the same pinned files directly from `node_modules`.

The official float16 model is downloaded from Google Storage by default. To
self-host it, place `face_landmarker.task` on an HTTPS origin and set
`VITE_FACE_LANDMARKER_MODEL_URL` to that URL at build time. Camera frames and
model results remain local to the browser; only the model file is downloaded.
