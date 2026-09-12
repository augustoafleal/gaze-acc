import { describe, expect, it } from "vitest";

import { DwellController } from "./dwell";

const config = { durationMs: 100, invalidToleranceMs: 20, cooldownMs: 50 };

describe("DwellController", () => {
  it("starts, progresses and confirms once", () => {
    const dwell = new DwellController(config);
    expect(dwell.update("sim", "valid", 0).state.progress).toBe(0);
    expect(dwell.update("sim", "valid", 50).state.progress).toBe(0.5);
    expect(dwell.update("sim", "valid", 100).selection).toBe("sim");
    expect(dwell.update("sim", "valid", 110).selection).toBeNull();
    expect(dwell.getState().candidateId).toBeNull();
    expect(dwell.update("sim", "valid", 140).state.candidateId).toBeNull();
    dwell.update(null, "no-face", 150);
    expect(dwell.update("sim", "valid", 160).state.progress).toBe(0);
  });

  it("cancels after a long loss and never advances on null samples", () => {
    const dwell = new DwellController(config);
    dwell.update("sim", "valid", 0);
    dwell.update(null, "no-face", 10);
    expect(dwell.update(null, "no-face", 25).state.candidateId).toBe("sim");
    expect(dwell.update(null, "no-face", 31).state.candidateId).toBeNull();
    expect(dwell.update("sim", "valid", 100).state.progress).toBe(0);
  });

  it("tolerates a short loss but requires rearm after confirmation", () => {
    const dwell = new DwellController(config);
    dwell.update("sim", "valid", 0);
    dwell.update("sim", "valid", 40);
    dwell.update(null, "eyes-closed", 50);
    dwell.update("sim", "valid", 60);
    expect(dwell.update("sim", "valid", 110).state.progress).toBeCloseTo(0.9);
    expect(dwell.update("sim", "valid", 120).selection).toBe("sim");
    expect(dwell.update("sim", "valid", 150).selection).toBeNull();
    dwell.update(null, "no-face", 200);
    expect(dwell.update("sim", "valid", 210).state.progress).toBe(0);
  });

  it("resets when the target changes", () => {
    const dwell = new DwellController(config);
    dwell.update("sim", "valid", 0);
    dwell.update("nao", "valid", 90);
    expect(dwell.update("nao", "valid", 140).state.progress).toBe(0.5);
  });

  it("reports real progress and a completed snapshot at confirmation", () => {
    const dwell = new DwellController({ durationMs: 1_200, invalidToleranceMs: 180, cooldownMs: 800 });
    expect(dwell.update("sim", "valid", 0).state.progress).toBe(0);
    expect(dwell.update("sim", "valid", 300).state.progress).toBeCloseTo(0.25);
    expect(dwell.update("sim", "valid", 600).state.progress).toBeCloseTo(0.5);
    expect(dwell.update("sim", "valid", 900).state.progress).toBeCloseTo(0.75);
    const completed = dwell.update("sim", "valid", 1_200);
    expect(completed.selection).toBe("sim");
    expect(completed.state.progress).toBe(1);
    expect(dwell.getState().progress).toBe(0);
  });
});
