---
name: gaze-engineering
description: Audit, implement, or review camera-based gaze estimation, calibration, smoothing, confidence, dwell, target mapping, tracking quality, and gaze evaluation for this repository. Use for any change that can affect where the application believes the user is looking or when a gaze selection is confirmed.
---

# Gaze Engineering

Read `docs/gaze.md` and `docs/architecture.md` before material changes.

## Workflow

1. **Audit**
   - Identify the current gaze pipeline and exact behavior being changed.
   - State the current evidence and baseline.
   - Identify the smallest variable or component that needs to change.
   - Separate confirmed facts from assumptions.

2. **Define success**
   - Name the metric or observable behavior the change should improve.
   - Prefer target accuracy, false activation rate, selection latency, tracking loss, or calibration quality.
   - Do not use visual smoothness as the sole success criterion.

3. **Implement narrowly**
   - Preserve the `GazeSample` boundary unless there is evidence it is insufficient.
   - Avoid simultaneous unrelated changes to calibration, model, smoothing, and dwell.
   - Keep camera inference local by default.
   - Do not persist or transmit camera frames.

4. **Validate**
   - Run automated checks.
   - Run the relevant gaze evaluation.
   - Compare against baseline when one exists.
   - Report device/browser/configuration.
   - Record regressions and uncertainty.

5. **Report**
   - End with evidence, warnings, and a recommendation.
   - Do not claim clinical reliability.

## Guardrails

- Camera-only is current scope.
- Do not add dedicated eye-tracking hardware integration.
- Do not couple AAC UI directly to a gaze library.
- Do not implement a naive iris-coordinate mapping as if it were validated gaze estimation.
- Do not tune constants only until one demonstration "looks right."
