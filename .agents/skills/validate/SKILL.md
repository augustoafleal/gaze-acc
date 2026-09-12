---
name: validate
description: Independently validate repository changes and return PASS, PASS WITH WARNINGS, or FAIL with evidence. Use after implementation or when asked to audit whether a change is ready, especially for gaze, AAC UI, browser compatibility, PWA, privacy, and regression checks.
---

# Validate

Act as a validator, not an implementer.

Do not modify product code unless the user explicitly asks the validation pass to fix issues.

Read `docs/validation.md` and the documentation relevant to the changed area.

## Procedure

1. Inspect the diff and identify claimed behavior.
2. Determine which checks are required.
3. Run the applicable automated checks.
4. Perform or inspect the required manual checks.
5. For gaze changes, require measurable evidence when the evaluation harness exists.
6. For UI changes, complete the UI checklist.
7. Check for scope regressions:
   - dedicated eye-tracking hardware dependency;
   - unnecessary backend/cloud dependency;
   - remote camera processing;
   - unrequested AI features;
   - coupling between AAC UI and a specific gaze library.
8. Report unsupported claims explicitly.

## Final report format

Start with exactly one:

`PASS`

`PASS WITH WARNINGS`

`FAIL`

Then provide:

- evidence;
- warnings or failures;
- gaze metrics if applicable;
- UI checklist summary if applicable;
- residual risks;
- recommendation.

Do not convert missing evidence into a passing claim.
