# Product

## Purpose

Provide a simple AAC interface controlled by gaze estimated from the device's front-facing camera.

The intended interaction is:

look -> dwell -> select -> compose or speak

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
- `ÁGUA`
- `DOR`

These are experimental targets for validating interaction, not a final vocabulary design.

## Interaction principles

- large targets;
- stable target positions;
- generous spacing;
- clear dwell progress;
- clear confirmation after selection;
- strong legibility;
- calm, child-friendly visual language;
- no unnecessary motion;
- no dependence on color alone;
- graceful behavior when gaze is lost;
- accidental selections should be minimized.

## Product stages

### Stage 0 — technical gaze experiment

Prove that camera-based gaze can distinguish four large screen regions with acceptable reliability.

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
