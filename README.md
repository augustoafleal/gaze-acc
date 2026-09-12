# Gaze AAC

Browser-based augmentative and alternative communication (AAC) experiment controlled by gaze estimated from the device camera.

## Product direction

The project targets ordinary devices with a front-facing camera and a modern browser, with Android tablets and Linux notebooks as first-class validation targets.

Core principles:

- camera-only gaze input;
- no dedicated eye-tracking hardware;
- browser/PWA delivery;
- local camera processing whenever technically feasible;
- gaze engine decoupled from AAC interaction and presentation;
- large, stable, low-clutter interaction targets;
- measurable validation before feature expansion;
- no backend, account system, or generative AI without a demonstrated product need.

## Current phase

**Minimal experiment implemented. Real-device evaluation remains outstanding.**

The first technical milestone is deliberately small:

1. access the front-facing camera;
2. calibrate gaze;
3. estimate gaze position;
4. expose a normalized `GazeSample`;
5. distinguish four large targets: `SIM`, `NÃO`, `ÁGUA`, `DOR`;
6. select by dwell;
7. measure accuracy, false activations, selection latency, and tracking loss.

Do not start with a full keyboard, word prediction, profiles, cloud sync, or a broad AAC board. Validate the gaze interaction first.

## Run locally

```bash
npm install
npm run dev
```

The board includes a local pointer mode for development checks without a camera. `Experimento guiado` conducts the human protocol: 9-point calibration, 8 warm-up trials, 80 formal trials and 10 neutral windows. It exports one versioned JSON session locally. The normal experiment starts without a gaze cursor; debug display is opt-in.

WebEyeTrack 0.0.2 requires the BlazeGaze TensorFlow.js assets at `/web/model.json`; those assets are bundled under `public/web/` from a pinned upstream commit and documented there. The package still hardcodes remote MediaPipe WASM and Face Landmarker model URLs. Para executar o POC com câmera durante o desenvolvimento, inicie o Vite explicitamente com `VITE_ALLOW_REMOTE_MODEL_ASSETS=true npm run dev`; sem essa opção a aplicação permanece protegida e mostra o erro de assets não self-hosted. Local camera inference is not the same as fully offline operation, and redistribution of the BlazeGaze artifacts still requires license review.

The experiment exports its in-memory session as JSON and does not send data to a server. It is not clinically validated or suitable as the sole channel for urgent communication.

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

The first experiment uses a provider boundary in `src/gaze/`, a WebEyeTrack adapter, 9-point calibration, four-target dwell interaction, local pointer testing, Web Speech API feedback, and in-memory JSON export. Peekr is not integrated.

## Safety

This project is assistive communication software under development. Early prototypes must not be represented as a reliable channel for urgent or emergency communication. Clinical use requires real-world validation with the care team and the intended user.
