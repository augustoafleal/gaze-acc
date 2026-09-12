# AGENTS.md

## Mission

Build a browser-based AAC application for children with severe motor impairment who communicate through gaze estimated from the device's front-facing camera.

The product is camera-only. Do not add dependencies on dedicated eye-tracking hardware, Tobii, Hiru, OS-level gaze APIs, or vendor-specific gaze SDKs unless the project direction is explicitly changed.

## Working model

Use this sequence for material engineering work:

1. audit;
2. implementation;
3. validation;
4. commit only when explicitly requested.

Separate evidence, uncertainty, and recommendation. Do not claim a behavior was validated unless the relevant command, test, measurement, or manual check was actually performed.

## Product constraints

- Treat Android tablets and Linux notebooks as first-class target environments.
- Prefer standards-based browser APIs and portable web technology.
- Keep camera frames and derived biometric-like signals local to the device whenever technically feasible.
- Do not add a backend, authentication, cloud storage, analytics, telemetry, or generative AI without a demonstrated requirement.
- Do not send camera frames to remote services in the default architecture.
- The gaze engine must remain replaceable.
- The AAC layer must not depend directly on a specific gaze-estimation library.
- Touch and mouse may remain available as development/test inputs, but the product interaction path is gaze.
- Accessibility and communication reliability take priority over visual novelty.
- Do not represent prototypes as clinically validated or suitable as the sole channel for urgent communication.

## Architecture boundaries

Before architecture changes, read `docs/architecture.md`.

Maintain the conceptual pipeline:

Camera -> Gaze Engine -> GazeSample -> Interaction Engine -> AAC -> Speech

The AAC/UI layer consumes gaze observations; it does not own camera capture, model inference, calibration, or smoothing.

Use normalized gaze coordinates when possible.

Canonical boundary:

```ts
export type GazeSample = {
  x: number;
  y: number;
  confidence: number;
  timestamp: number;
};
```

`x` and `y` should use a documented normalized coordinate system. Invalid or low-confidence observations must be representable without fabricating a precise point.

## Gaze work

Before modifying camera capture, calibration, gaze estimation, smoothing, confidence, dwell, head-pose handling, or gaze-target mapping:

- read `docs/gaze.md`;
- use the `gaze-engineering` skill;
- preserve a measurable baseline;
- avoid changing multiple independent gaze variables in one experiment unless necessary;
- report metrics rather than subjective impressions.

Do not implement naive iris-position-to-screen mappings as a production assumption without measured evidence.

## AAC and UI work

Before modifying communication boards, quick phrases, pictograms, keyboard layout, dwell feedback, colors, target size, navigation, or speech behavior:

- read `docs/product.md`;
- use the `aac-accessibility` skill;
- keep targets large and spatially stable;
- avoid unnecessary animation and visual clutter;
- do not rely on color alone;
- preserve an obvious path to `SIM` and `NÃO`;
- include a manual UI checklist in validation.

Child-friendly does not mean visually busy. Prefer calm, legible, predictable interfaces.

## Validation

Use the `validate` skill for final validation of material changes.

Final validation status must be exactly one of:

- `PASS`
- `PASS WITH WARNINGS`
- `FAIL`

Support the status with evidence.

For gaze-related changes, include relevant measured results whenever the test harness exists:

- target accuracy;
- false activation rate;
- median selection latency;
- tracking loss rate;
- calibration failures or drift observations.

For UI-related changes, include the manual UI checklist from `docs/validation.md`.

## Scope discipline

The first milestone is not a complete AAC product.

Initial target:

- camera access;
- gaze calibration;
- gaze estimation;
- four large targets: `SIM`, `NÃO`, `ÁGUA`, `DOR`;
- dwell selection;
- speech output;
- objective measurement.

Do not prematurely add:

- full alphabet keyboard;
- word prediction;
- user accounts;
- remote persistence;
- clinician dashboards;
- analytics;
- LLM features;
- broad pictogram libraries.

Those can follow only after gaze interaction is demonstrated to be usable.

## Documentation

Update documentation when a change alters:

- product scope;
- public/internal architecture boundaries;
- gaze-provider assumptions;
- calibration behavior;
- validation methodology;
- supported environments.

Keep documentation concise and evidence-based.

## Code quality

Prefer small modules with explicit interfaces.

Avoid comments and docstrings that merely restate code. Add comments only when they preserve non-obvious rationale, safety constraints, or algorithmic reasoning.

Do not introduce abstractions solely for hypothetical future providers or platforms. The gaze boundary already provides the necessary replaceability.

## Commits

Do not commit automatically. When a commit is requested:

- validate first;
- summarize exactly what changed;
- mention warnings;
- use a focused commit message.
