# Architecture

## Core pipeline

```text
Front-facing camera
        |
        v
Camera capture
        |
        v
Gaze engine
  - preprocessing
  - calibration
  - inference
  - smoothing
        |
        v
GazeObservation
        |
        v
Interaction engine
  - target hit testing
  - dwell
  - cancellation
  - cooldown
        |
        v
AAC domain
  - quick concepts
  - composition
  - selected message
        |
        v
Speech output
```

## Primary boundary

The rest of the application must consume gaze through a small provider-independent contract.

The current provider-independent boundary distinguishes a usable estimate from tracking state:

```ts
export type GazeSample = {
  x: number;
  y: number;
  timestampMs: number;
};

export type GazeStatus =
  | "valid"
  | "no-face"
  | "eyes-closed"
  | "invalid"
  | "error";

export type GazeObservation = {
  sample: GazeSample | null;
  status: GazeStatus;
  timestampMs?: number;
};
```

Recommended coordinate semantics:

- `x`: normalized horizontal coordinate in `[0, 1]`;
- `y`: normalized vertical coordinate in `[0, 1]`;
- `(0, 0)`: top-left of the current interactive viewport;
- `timestampMs`: monotonic sampling timestamp in milliseconds from `performance.now()`.
- Invalid observations keep `sample: null`; their optional `timestampMs` lets the logger measure loss intervals without fabricating a point.

WebEyeTrack 0.0.2 does not provide semantic confidence. Its adapter does not invent one. A missing face, closed eyes, invalid output, or provider error is represented with `sample: null`. The upstream `[0, 0]` placeholder is never used as a generic tracking-loss point.

The adapter discards WebEyeTrack's video-time timestamp (seconds) at the boundary. Session, dwell, calibration and tracking-duration timestamps use the same monotonic millisecond clock.

Setup UI and active-session UI are separate layout modes. During calibration, warm-up, formal trials, neutral windows and free camera communication, the active shell occupies a fixed landscape `100dvh` viewport with scrolling disabled. Its instruction/status region has a fixed height and its interaction region contains the calibration field or four targets. A meaningful resize, orientation change or DPR change invalidates the active calibration instead of silently moving the targets.

The gaze coordinate contract remains the full CSS viewport: `(0, 0)` is the viewport top-left and `(1, 1)` is the viewport bottom-right. Calibration points are drawn inside the fixed interaction region and explicitly mapped from that region into full-viewport coordinates before being passed to WebEyeTrack. Target hit-testing uses CSS-pixel rectangles in the same full-viewport space; `devicePixelRatio` is metadata, not an extra scale factor.

## Modules

### `src/gaze/`

Owns:

- camera access;
- model loading;
- calibration;
- gaze estimation;
- smoothing;
- gaze-quality state.

The first implementation exposes `GazeProvider.initialize(video)`, `start(listener)`, `stop()`, and a small `calibrate(point)` adapter because WebEyeTrack's public calibration path is a global click event rather than a reusable calibration API.

Does not own AAC concepts or UI layout.

### `src/communication/`

Owns:

- concepts/messages;
- composition state;
- selection semantics.

Does not know how gaze is estimated.

### `src/ui/`

Owns presentation and target geometry.

Receives gaze/interaction state and renders dwell/selection feedback.

### `src/speech/`

Owns speech synthesis integration and graceful failure behavior.

## Interaction boundary

The interaction layer should transform gaze samples into semantic target events.

Conceptually:

```text
GazeSample -> target candidate -> dwell state -> confirmed selection
```

Do not trigger a selection from a single gaze sample.

The interaction layer should support:

- entry into a target;
- dwell accumulation;
- brief tolerated instability;
- cancellation;
- confirmation;
- cooldown/re-arm behavior.

Exact values must be configurable and validated empirically.

## Offline direction

The application is not a complete PWA yet. The WebEyeTrack BlazeGaze TensorFlow.js manifest and shard required at `/web/model.json` are bundled under `public/web/` from a pinned upstream commit. The package still hardcodes remote MediaPipe WASM and Face Landmarker model URLs, so remote model loading is opt-in for development via `VITE_ALLOW_REMOTE_MODEL_ASSETS=true`. The BlazeGaze files have no separate license file in the inspected upstream path and require redistribution review; the app does not claim to be fully offline/self-contained.

Camera inference should run locally by default.

No backend is required for the initial architecture.

## Replaceability

The gaze engine is replaceable, but only camera-based providers are in current scope.

Do not add abstractions for dedicated eye-tracking hardware.

A future replacement may use a different browser-compatible camera gaze model while preserving the `GazeSample` boundary.

## Architecture changes

Any change that crosses these boundaries must document:

1. the problem;
2. current evidence;
3. proposed change;
4. alternatives considered;
5. validation required.
