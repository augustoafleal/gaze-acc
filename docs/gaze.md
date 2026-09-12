# Gaze Engineering

## Goal

Estimate a user's point of regard on the interactive viewport from a standard front-facing RGB camera with enough stability to support large-target AAC interaction.

This is the project's main technical uncertainty.

## Current implementation direction

Evaluate existing open-source, browser-capable gaze-estimation solutions before implementing gaze estimation from scratch.

The first provider adapter is pinned to `webeyetrack@0.0.2`. WebEyeTrack remains a baseline, not a permanent architectural dependency.

Other projects may be used as references or comparison baselines, but adoption requires an audit of:

- license;
- browser/runtime support;
- model assets;
- camera pipeline;
- calibration requirements;
- maintenance state;
- performance;
- privacy behavior;
- mobile compatibility;
- ability to run locally;
- measured accuracy on our target devices.

## Do not assume

Do not assume that:

- iris landmarks alone provide reliable screen coordinates;
- a desktop result transfers to Android;
- a single calibration is stable indefinitely;
- visual smoothness implies target-selection accuracy;
- average gaze error alone predicts AAC usability.

## Required components

A viable gaze pipeline will likely need:

1. camera acquisition;
2. face/eye localization;
3. head-pose or equivalent compensation;
4. gaze estimation;
5. user-specific calibration;
6. temporal smoothing;
7. confidence/quality handling;
8. interaction-aware dwell.

These responsibilities may be implemented by one library or several components.

## Calibration

Calibration must be treated as a product feature, not a developer-only utility.

The first implementation should evaluate a small fixed-point calibration pattern, such as 5 or 9 points.

Capture enough samples per point to reject transients.

Record:

- successful/failed calibration;
- number of usable samples;
- calibration duration;
- per-target post-calibration error when measurable.

Do not silently accept poor calibration.

The current experiment displays 9 deterministic points. WebEyeTrack exposes calibration through a global click listener and has no high-level calibration result. The adapter dispatches a normalized viewport click only after a recent valid sample exists; the UI does not call WebEyeTrack's internal `handleClick` directly. Calibration is invalidated on resize and orientation change, and the free board provides an explicit `Recalibrar` action between evaluation activities.

The installed package currently loads the Face Landmarker WASM from `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm` and the model from `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`. The package also expects its BlazeGaze TensorFlow.js model at `/web/model.json`; the manifest and shard are bundled under `public/web/` from pinned upstream commit `75fbd2f5f784f2eb3a39675a8dcbf1b01c697f1c`. `webeyetrack@0.0.2` is MIT and `@mediapipe/tasks-vision@0.10.18` is Apache-2.0, but no separate license file for the BlazeGaze artifacts or downloaded MediaPipe model was observed. These remote URLs remain a development-only limitation, and the project does not claim to be fully offline/self-contained.

## Smoothing

Smoothing exists to improve interaction stability, not to make a cursor look pleasant.

Any smoothing change may affect:

- lag;
- target accuracy;
- dwell completion;
- overshoot;
- false activations.

Compare smoothing changes against the same recorded or controlled evaluation when possible.

## Dwell

Dwell selection should be owned by the interaction layer.

Initial behavior should support:

- configurable dwell duration;
- visual progress;
- cancellation when the gaze leaves sufficiently;
- brief tolerance for noisy samples;
- cooldown after a confirmed selection.

Do not tune dwell solely by intuition.

## Metrics

When the evaluation harness exists, report at minimum:

### Target accuracy

Correct intended selections / attempted selections.

### False activation rate

Unintended confirmed selections / evaluation opportunity, using a clearly documented denominator.

### Median selection latency

Median time from intended target acquisition to confirmed selection.

### Tracking loss rate

Fraction of evaluation time or samples during which no usable gaze estimate is available.

Also record qualitative failure modes:

- head movement;
- glasses/reflections;
- low light;
- camera angle;
- user distance;
- drift;
- fatigue;
- repeated calibration failure.

## First experiment

Four large targets:

```text
SIM       NÃO

ÁGUA      DOR
```

Suggested initial protocol:

- 20 intended selections per target;
- 80 intended selections total;
- controlled target order;
- record every attempt;
- preserve raw evaluation output when privacy policy permits;
- do not store camera video by default.

The threshold for "good enough" must be chosen after a baseline exists. Do not invent a success threshold before observing the system and consulting the care team.

## Privacy

Camera data is highly sensitive in this context.

Default rules:

- process frames locally;
- do not persist video;
- do not transmit frames;
- do not add telemetry containing face/eye data;
- explicitly document any future deviation.

The application code does not upload camera frames, gaze samples, landmarks, or screenshots. Experiment export is a user-triggered local JSON download and excludes video and raw landmarks.

## Provider boundary

The adapter converts WebEyeTrack's centered `normPog` domain `[-0.5, 0.5]` to application coordinates `[0, 1]` with `x = normPog[0] + 0.5` and `y = normPog[1] + 0.5`. Values outside the documented domain are rejected rather than silently clamped. No confidence value is fabricated.

WebEyeTrack's callback timestamp is derived from `HTMLVideoElement.currentTime` and is expressed in seconds. The adapter does not expose that value: valid samples and invalid observations use the application's monotonic `performance.now()` clock in milliseconds. This prevents mixing video time with session time. Tracking-duration accounting attributes each interval to the status observed at its end and closes the last interval when an attempt or neutral window ends.
