import { describe, expect, it } from "vitest";

import { calculateMetrics, median, type AttemptRecord } from "./metrics";

const attempt = (result: AttemptRecord["result"], selectedTarget: AttemptRecord["selectedTarget"], cue: number, selected: number | null): AttemptRecord => ({
  id: result,
  intendedTarget: "sim",
  selectedTarget,
  cueTimestamp: cue,
  selectionTimestamp: selected,
  firstEstimatedTargetEntryTimestamp: selected === null ? null : cue + 10,
  result,
  trackingLossMs: 20,
});

describe("metrics", () => {
  it("calculates outcomes, rates and latencies", () => {
    const metrics = calculateMetrics(
      [attempt("correct", "sim", 0, 100), attempt("wrong-target", "nao", 200, 400), attempt("timeout", null, 500, null)],
      [{ id: "neutral", startedAt: 0, endedAt: 60_000, usableTrackingMs: 60_000, falseActivationCount: 2 }],
      1_000,
      200,
    );
    expect(metrics.targetAccuracy).toBeCloseTo(1 / 3);
    expect(metrics.wrongTargetCount).toBe(1);
    expect(metrics.timeoutCount).toBe(1);
    expect(metrics.falseActivationRatePerMinute).toBe(2);
    expect(metrics.medianCueToConfirmationLatencyMs).toBe(150);
    expect(metrics.medianEntryToConfirmationLatencyMs).toBe(140);
    expect(metrics.trackingLossRate).toBeCloseTo(0.2);
  });

  it("handles median edge cases", () => {
    expect(median([])).toBeNull();
    expect(median([4])).toBe(4);
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 3])).toBe(2);
  });

  it("does not invent a false activation rate without usable neutral time", () => {
    expect(calculateMetrics([], [{ id: "n", startedAt: 0, endedAt: 1, usableTrackingMs: 0, falseActivationCount: 1 }], 0, 0).falseActivationRatePerMinute).toBeNull();
  });
});
