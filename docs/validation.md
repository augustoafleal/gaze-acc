# Validation

## Status

Every final validation report must begin with exactly one status:

- `PASS`
- `PASS WITH WARNINGS`
- `FAIL`

A passing status requires evidence appropriate to the change.

## General validation

When the project tooling exists, run the applicable checks:

- dependency install integrity;
- lint;
- formatting check;
- typecheck;
- unit tests;
- integration tests;
- production build;
- PWA/service-worker checks when implemented.

Never claim a command passed if it was not executed.

## Gaze validation

For gaze-related changes, validate the affected pipeline and report measurable results whenever the harness exists:

- target accuracy;
- false activation rate;
- median selection latency;
- tracking loss rate;
- calibration success/failure;
- observed drift;
- device/browser tested.

Compare with a baseline when changing:

- calibration;
- gaze model;
- preprocessing;
- smoothing;
- confidence handling;
- target mapping;
- dwell behavior.

A visually smoother pointer is not sufficient evidence.

## First four-target protocol

Targets:

- `SIM`
- `NÃO`
- `VIRAR`
- `DOR`

Protocol target:

- 20 intended selections per target;
- 80 intended selections total.

Record enough information to reconstruct:

- intended target;
- selected target, if any;
- successful/failed attempt;
- activation latency;
- false activation;
- tracking loss;
- calibration identifier/version;
- relevant configuration values.

Do not store raw face video by default.

The implemented harness keeps session data in memory and exports JSON locally. An intended attempt begins when the caregiver presses `Iniciar tentativa` with one of the four concepts selected as the cue. It ends on a confirmed dwell selection or explicit timeout. A confirmation matching the cue is `correct`; another concept is `wrong-target`; no confirmation before timeout is `timeout`. A selection with no active attempt during `Janela neutra` is a false activation. Neutral time contributes to false-activation rate, not target accuracy.

The initial dwell configuration is 1,200 ms, with 180 ms tolerated tracking loss and an 800 ms cooldown. These are experiment defaults, not clinical thresholds.

All runtime timestamps used by dwell and experiment records are monotonic milliseconds. A valid `GazeSample` has `timestampMs`; an invalid `GazeObservation` may have `sample: null` while still carrying an observation `timestampMs` for tracking-loss duration accounting. The WebEyeTrack video timestamp is not used for session timing.

Tracking loss is accumulated from observation timestamps and divided by active evaluation time. The provider does not expose semantic confidence, so no confidence metric is fabricated.

## Guided human session

The application provides an `Experimento guiado` mode for a person to run with a real webcam. Codex does not execute this physical evaluation and must not generate or submit experimental results.

Active gaze sessions use a fixed viewport in either portrait or landscape. Scrolling is disabled on `html`, `body` and `#root`; status/instruction content is constrained to a fixed-height region and cannot push the interaction region. Orientation is not a start-up requirement. A resize or orientation change during an active session does not show an interruption or end the session; the current dwell is reset silently and the targets use the current viewport. The user may manually use `Recalibrar` after a large geometry change if drift is observed.

The guided flow is:

1. preparation with browser, viewport, DPR, orientation, provider and dwell settings;
2. the existing 9-point calibration;
3. 8 warm-up trials, 2 per target, excluded from formal metrics;
4. 80 main trials, 20 per target, in one pseudo-random sequence with no runs longer than two where possible;
5. a short neutral interval between trials;
6. 10 neutral windows of 10 seconds after the main trials;
7. local JSON export.

After the 8 warm-up trials, the operator may either export the warm-up-only session or continue to the formal protocol. A warm-up-only export is marked completed but contains no formal accuracy denominator.

The default operational timeout is 8,000 ms per trial. It is configurable before the session starts and is not a clinical threshold. A trial begins when its instruction and cue timestamp are shown. It ends at a confirmed dwell selection, timeout, or explicit cancellation. A paused session can resume only between trials; cancelling preserves completed and aborted records without fabricating the remaining trials.

During the formal session the gaze cursor is disabled and accuracy is not shown. The export records the generated sequence, calibration metadata, trial phase, timestamps, selected target, result, tracking status counts, usable/lost tracking duration, neutral activations, configuration and final metrics. It contains no camera frames, screenshots or raw landmarks.

The export schema is versioned (`schemaVersion: "1.0"`) and includes accuracy by target, latency quartiles, temporal blocks (1–20, 21–40, 41–60 and 61–80), and a confusion matrix derived only from main trials.

## Blink navigation experiment

Blink navigation is the default interaction of the app (see `docs/product.md`); the dwell/calibration interface is preserved at `?legacy=1` for reference.

Blink navigation starts camera tracking without the 9-point spatial calibration. Only a result with usable facial landmarks may produce `EyeObservation.state = "open"` or `"closed"`; otherwise it is `unavailable` and cannot create a gesture. The temporal detector requires `OPEN -> CLOSED -> OPEN`, ignores natural closures below its configured minimum, delays short gestures during the double window, and emits long only after reopening. A double requires the second blink to **start** within the double window; the second blink may finish after the deadline. The deadline never resolves the first `short` while the second closure is in progress. A second closure too short for `minIntentionalBlinkMs` cancels the gesture without a command, and a second closure at or above `longBlinkThresholdMs` emits only `long`. Tracking loss cancels any pending short or in-progress closure without emitting a command. An optional `stateStabilityMs` debounces `open`/`closed` transitions without inflating measured durations; `unavailable` is never debounced.

The current defaults are 120 ms minimum intentional closure, 700 ms long threshold, 450 ms double window, 800 ms cooldown, 5,000 ms maximum closure and 0 ms state stabilization. These are experimental defaults, not clinically or physiologically validated values. Debug is off by default and may export local derived timing events; no frames, video, landmarks or remote telemetry are recorded.

The navigation mapping is circular: short = next, double short = previous, and long = select the highlighted concept. The initial highlight is `SIM`.

Before using blink navigation as AAC interaction, run the human blink test with a real person and webcam, covering natural blink, intentional short, intentional double and intentional long closures. The implementation alone is not evidence of blink usability, pediatric suitability, Android support or clinical reliability.

## Blink UI validation

The blink UI follows a fixed shell: `position: fixed`, full viewport at `100dvh`, no browser scroll, and a docked 2×2 board. Validation must confirm:

- both portrait and landscape are allowed at start, including phone-sized viewports; no viewport-size or orientation overlay may suspend blink interaction;
- the four target rectangles (`SIM`, `NÃO`, `VIRAR`, `DOR`) are geometrically invariant between the 1280×800, 1024×600 and 844×390 reference viewports (differences below 1 px are acceptable);
- the debug overlay, when enabled, does not change target geometry or readability;
- the focus indicator is visible on all four targets independently of color;
- speech fires exactly once per long blink;
- the exit action is operator-controlled and cannot be triggered by blink gestures;
- the diagnostic export remains local and contains only derived events.

## UI checklist

For UI changes, manually inspect at minimum:

- [ ] targets remain large and stable during the session;
- [ ] `SIM` and `NÃO` remain obvious and reachable;
- [ ] the focus indicator is visible without relying on color alone;
- [ ] confirmation is visually clear;
- [ ] gaze/tracking loss does not accidentally confirm and preserves focus;
- [ ] no distracting motion was introduced;
- [ ] text is legible;
- [ ] portrait and small viewports do not block the board;
- [ ] layout works at the current Android-tablet test viewport;
- [ ] layout works at the current Linux-notebook test viewport;
- [ ] touch/mouse testing remains possible if applicable.

Include screenshots when the validation environment supports them and they materially help review.

## Browser/device reporting

Do not say "cross-platform" based only on framework capability.

Report actual tested combinations, for example:

```text
Android <version> / Chrome <version> / <device>
Linux <distribution> / Chromium <version> / <camera>
```

Untested environments remain unvalidated.

## Warnings

Use `PASS WITH WARNINGS` when:

- required checks pass;
- no known issue invalidates the change;
- but a material limitation, environment gap, or non-blocking risk remains.

Use `FAIL` when a required test fails, evidence is insufficient for a required claim, or the change introduces an unacceptable regression.
