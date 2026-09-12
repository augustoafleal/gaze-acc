# Product

## Purpose

Provide a simple AAC interface controlled by gaze estimated from the device's front-facing camera.

The current intended interaction is camera-derived eye state with sequential target navigation:

- short blink -> advance the highlight (`Próximo`);
- double short blink -> move back (`Anterior`);
- long blink -> select and speak.

This avoids spatial calibration entirely, which is a hard requirement for unsupervised family use. Point-of-gaze with dwell (`look -> dwell -> select`) was the earlier prototype; it remains implemented and reachable with `?legacy=1` for reference, but the product path is blink navigation. Neither mode is empirically validated yet.

The application should work on ordinary consumer devices without specialized eye-tracking hardware.

## Initial target environments

First-class validation targets:

- Android tablet with front-facing camera and modern Chromium-based browser;
- Linux notebook with webcam and modern Chromium/Firefox-class browser.

Other modern browser environments may work, but they are not evidence of support until validated.

## Intended user experience

The user should be able to communicate common needs using large, stable targets with minimal visual clutter.

Initial quick concepts:

- `SIM`
- `NÃO`
- `VIRAR`
- `DOR`

These are experimental targets for validating interaction, not a final vocabulary design.

## Interaction principles

- large targets;
- stable target positions;
- generous spacing;
- a persistent, non-color-only focus indicator;
- clear confirmation after selection;
- strong legibility;
- calm, child-friendly visual language;
- no unnecessary motion;
- no dependence on color alone;
- graceful behavior when gaze is lost (focus preserved, commands suspended);
- accidental selections should be minimized.

## Product stages

### Stage 0 — technical gaze experiment

Prove that blink transitions (`open`/`closed`) can control a four-target selection loop with acceptable reliability, using precise thresholds for short/double/long and a clear tracking-loss fallback. Historical note: camera-based point-of-gaze also distinguishes four large screen regions with dwell, as preserved in the legacy interface.

### Stage 1 — minimal communication board

Add configurable quick phrases and speech output after Stage 0 meets the agreed validation threshold.

### Stage 2 — richer AAC

Only after evidence supports it, evaluate:

- categories;
- pictograms;
- phrase composition;
- alphabet keyboard;
- word suggestions;
- caregiver configuration.

## Non-goals for the initial milestone

- dedicated eye-tracking hardware;
- Tobii/Hiru integration;
- cloud accounts;
- remote camera processing;
- clinician portal;
- analytics;
- generative AI;
- automatic medical interpretation;
- emergency alert replacement;
- full AAC vocabulary.

## Safety boundary

The early product is experimental assistive software. It must not be described as medically validated or as the sole means for communicating urgent needs until real-world reliability has been established with the intended user and care team.
