import { describe, expect, it } from "vitest";

import { ExperimentLogger } from "./experiment";

describe("ExperimentLogger", () => {
  it("records an intended result and a neutral false activation without mixing denominators", () => {
    const logger = new ExperimentLogger("test", { durationMs: 1_200, invalidToleranceMs: 180, cooldownMs: 800 }, "cal-1");
    logger.startAttempt("sim", 0);
    logger.observe({ sample: { x: 0.2, y: 0.2, timestampMs: 10 }, status: "valid" }, "sim");
    logger.confirmSelection("sim", 100);
    logger.startNeutralWindow(200);
    logger.confirmSelection("nao", 300);
    logger.finishNeutralWindow(1_200);

    const metrics = logger.metrics();
    expect(logger.attempts).toHaveLength(1);
    expect(logger.neutralWindows[0].falseActivationCount).toBe(1);
    expect(metrics.targetAccuracy).toBe(1);
    expect(metrics.falseActivationCount).toBe(1);
  });

  it("exports session metadata and only experiment records", () => {
    const logger = new ExperimentLogger("WebEyeTrack 0.0.2", { durationMs: 1_200, invalidToleranceMs: 180, cooldownMs: 800 }, "cal-2");
    const data = logger.exportData({ width: 800, height: 600, dpr: 2, orientation: "landscape" });
    expect(data.sessionId).toMatch(/^session-/);
    expect(data.viewport.dpr).toBe(2);
    expect(data.calibrationId).toBe("cal-2");
    expect(data).not.toHaveProperty("video");
    expect(data).not.toHaveProperty("landmarks");
  });

  it("accounts for valid and lost time using observation timestamps and closes the final interval", () => {
    const logger = new ExperimentLogger("test", { durationMs: 1_200, invalidToleranceMs: 180, cooldownMs: 800 }, null);
    logger.startAttempt("sim", 0);
    logger.observe({ sample: { x: 0.5, y: 0.5, timestampMs: 2_000 }, status: "valid" }, "sim");
    logger.observe({ sample: null, status: "no-face", timestampMs: 7_000 }, null);
    logger.finishAttemptAsTimeout(8_000);

    const attempt = logger.attempts[0];
    expect(attempt.durationMs).toBe(8_000);
    expect(attempt.trackingUsableDurationMs).toBe(2_000);
    expect(attempt.trackingLostDurationMs).toBe(6_000);
    expect(attempt.trackingUsableDurationMs! + attempt.trackingLostDurationMs!).toBe(attempt.durationMs);
    expect(logger.metrics().trackingLossRate).toBe(0.75);
  });

  it("does not create negative duration when provider timestamps arrive out of order", () => {
    const logger = new ExperimentLogger("test", { durationMs: 1_200, invalidToleranceMs: 180, cooldownMs: 800 }, null);
    logger.startAttempt("sim", 1_000);
    logger.observe({ sample: { x: 0.5, y: 0.5, timestampMs: 1_500 }, status: "valid" }, "sim");
    logger.observe({ sample: null, status: "invalid", timestampMs: 1_200 }, null);
    logger.finishAttemptAsTimeout(2_000);

    const attempt = logger.attempts[0];
    expect(attempt.trackingUsableDurationMs! + attempt.trackingLostDurationMs!).toBe(1_000);
    expect(attempt.trackingUsableDurationMs).toBeGreaterThanOrEqual(0);
    expect(attempt.trackingLostDurationMs).toBeGreaterThanOrEqual(0);
  });
});
