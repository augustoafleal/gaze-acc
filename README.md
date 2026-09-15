# Gaze AAC

Browser-based augmentative and alternative communication (AAC) experiment controlled by gaze estimated from the device camera.

## Product direction

The project targets ordinary devices with a front-facing camera and a modern browser, with Android tablets and Linux notebooks as first-class validation targets.

Core principles:

- camera-only gaze input;
- no dedicated eye-tracking hardware;
- browser delivery (PWA is not part of the current phase);
- local camera processing whenever technically feasible;
- gaze engine decoupled from AAC interaction and presentation;
- large, stable, low-clutter interaction targets;
- measurable validation before feature expansion;
- no backend, account system, or generative AI without a demonstrated product need.

## Current phase

**Minimal blink AAC experience implemented. Real human testing is the next step.**

The default application is a single-purpose blink communicator for the human test:

- start screen that explains the three gestures;
- camera session with three adjustable blink timings on the start screen;
- four large, fixed targets: `SIM`, `NÃO`, `VIRAR`, `DOR`;
- short blink = next, double short blink = previous, long blink = select;
- dwell selection is replaced by a long blink, but the underlying dwell and blink gesture modules remain in the repository;
- TTS speech output exactly once per selection;
- local JSON diagnostic export (durations and eye-state events only — never video or landmarks).

The previous dwell/calibration/experiment interface was not implemented on top of the old camera mode; it is preserved intact and reachable with `?legacy=1` for development and reference. Nothing was deleted: all gaze, dwell, blink-gesture, guided-experiment, and metrics modules and their tests are still present. The new blink UI does not depend on spatial calibration, dwell loops, or calibration points.

Do not start with a full keyboard, word prediction, profiles, cloud sync, or a broad AAC board. Validate the blink interaction with a human tester first.

## Run locally

```bash
npm install
npm run dev
```

The app renders the blink communicator by default. To start development:

```bash
npm install
npm run dev
```

To test from another device through a temporary HTTPS URL, keep the development
server and Cloudflare tunnel in separate terminals:

```bash
npm run dev -- --host 0.0.0.0
cloudflared tunnel --url http://localhost:5173
```

The default blink path self-hosts the pinned MediaPipe WASM runtime and downloads only the official 3.6 MB Face Landmarker model. Its startup screen reports browser compatibility, permission, a real camera frame, model download and detector initialization separately. Set `VITE_FACE_LANDMARKER_MODEL_URL` at build time to self-host the model as well.

In the blink app, the start screen exposes the minimum intentional blink, long-blink threshold, and double-blink window, prefilled with the experimental defaults. `Iniciar` opens the camera and, once the face is tracked, the four-target board with `SIM` focused. Short blink advances focus, two short blinks move it back, long blink selects and speaks. If tracking is lost the board keeps its focus and no commands are accepted until the face is detected again. Phones, tablets and notebooks support both portrait and landscape without a minimum-viewport lock; the fixed 2×2 board remains scroll-free and cancels only an incomplete blink gesture if the viewport changes.

Add `?legacy=1` to the URL to reach the previous dwell/gaze interface (calibration, free mode, pointer test mode, and the guided experiment). That interface is preserved for reference; it is not the product flow. The optional blink index in the legacy UI and the old `?blinkSynthetic` hook remain available for development only.

`?blinkSynthetic` is a development-only hook that lets a scripted harness drive the blink app with `gaze-aac:blink-eye-state` events instead of a real camera; when present it also skips camera initialization, and it is disabled outside `import.meta.env.DEV`.

The experiment exports its in-memory session as JSON and does not send data to a server. It is not clinically validated or suitable as the sole channel for urgent communication.

## Deploy to GitHub Pages

Pushes to `main` run the GitHub Pages workflow after typecheck, lint, tests, and a production build. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. The live project site is `https://augustoafleal.github.io/gaze-acc/`.

The published build enables WebEyeTrack's remote assets only for the preserved legacy gaze route. The default blink route uses the repository subpath for its pinned MediaPipe WASM files. This phase is a standard HTTPS web deployment, not a PWA: it does not add a service worker or manifest.

## Repository guide

- `AGENTS.md` — repository-wide rules for Codex and other coding agents.
- `docs/product.md` — product scope, users, MVP, and non-goals.
- `docs/architecture.md` — architectural boundaries and interfaces.
- `docs/gaze.md` — gaze-engine requirements and research direction.
- `docs/validation.md` — validation protocol and reporting rules.
- `.agents/skills/gaze-engineering/` — workflow for gaze changes.
- `.agents/skills/aac-accessibility/` — workflow for AAC/UI changes.
- `.agents/skills/validate/` — independent validation workflow.

## Current implementation

The blink app lives in `src/ui/blink-aac.tsx` on top of a framework-free session controller (`src/communication/blink-session.ts`) that owns the gesture detector, blink navigation, command queue, and diagnostic events. A dedicated MediaPipe worker performs only face/eye-state detection with the CPU/WASM delegate. The eye-state boundary (`src/gaze/eye-types.ts`) stays the only contract between the provider and the AAC layer.

The default blink route no longer loads TensorFlow.js, BlazeGaze or the WebEyeTrack worker. This reduces its initial JavaScript from roughly 2.9 MB to 220 KB before gzip and removes the forced WebGL/GPU delegate. The Face Landmarker model is still remote by default, but the UI reports its exact download stage and the URL can be replaced with a same-origin copy through `VITE_FACE_LANDMARKER_MODEL_URL`.

The WebEyeTrack provider used only by `?legacy=1` still requires the BlazeGaze TensorFlow.js assets at `${VITE_BASE_PATH}/web/model.json` and hardcodes remote MediaPipe assets. Production legacy builds therefore still need `VITE_ALLOW_REMOTE_MODEL_ASSETS=true`. Redistribution of the BlazeGaze artifacts requires license review.

The preserved legacy stack (`src/ui/gaze-legacy.tsx`, reached with `?legacy=1`) keeps the provider boundary in `src/gaze/`, the WebEyeTrack gaze adapter, 9-point calibration, four-target dwell interaction, local pointer testing, and the guided experiment with JSON export. Its thresholds and protocol are unchanged.

## Safety

This project is assistive communication software under development. Early prototypes must not be represented as a reliable channel for urgent or emergency communication. Clinical use requires real-world validation with the care team and the intended user.
