---
name: aac-accessibility
description: Design, implement, or review AAC interaction and child-facing UI in this repository, including communication boards, quick concepts, pictograms, target geometry, dwell feedback, navigation, keyboard concepts, colors, and speech interaction.
---

# AAC Accessibility

Read `docs/product.md`, `docs/architecture.md`, and the UI section of `docs/validation.md`.

## Priorities

Order decisions by:

1. reliable communication;
2. low accidental activation;
3. legibility;
4. predictable interaction;
5. comfort;
6. visual appeal.

A playful interface must remain calm and gaze-friendly.

## Interaction rules

- Prefer large targets with generous spacing.
- Keep important targets spatially stable.
- Avoid moving targets while the user is trying to acquire them.
- Provide visible dwell progress.
- Provide unambiguous confirmation.
- Handle gaze loss without accidental confirmation.
- Do not rely on color alone.
- Avoid decorative animation that competes for visual attention.
- Preserve touch/mouse operation for development and caregiver testing when practical.

## Scope

Do not expand the AAC feature set before the gaze milestone justifies it.

For the initial experiment, preserve the four-target scope unless the task explicitly changes it:

- `SIM`
- `NÃO`
- `ÁGUA`
- `DOR`

## Child-facing design

Use child-friendly:

- shapes;
- typography;
- iconography;
- restrained color;
- positive feedback.

Do not equate child-friendly with dense illustration, excessive motion, or many simultaneous choices.

## Validation

For UI changes:

- run automated checks;
- inspect relevant target viewport sizes;
- complete the manual UI checklist in `docs/validation.md`;
- include screenshots when useful;
- report `PASS`, `PASS WITH WARNINGS`, or `FAIL`.
