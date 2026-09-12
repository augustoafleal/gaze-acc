import { describe, expect, it } from "vitest";

import { DEFAULT_DWELL_CONFIG } from "../gaze/dwell";
import {
  GUIDED_DEFAULTS,
  GuidedExperimentSession,
  generateBalancedSequence,
} from "./guided-experiment";
import { summarize, temporalBlocks, type AttemptRecord } from "./metrics";

const options = {
  provider: "WebEyeTrack 0.0.2",
  applicationVersion: "0.1.0",
  dwell: DEFAULT_DWELL_CONFIG,
  trialTimeoutMs: 8_000,
  remoteAssetsEnabled: false,
  debugCursorEnabled: false,
  seed: 42,
};

describe("guided experiment", () => {
  it("generates balanced warm-up and main sequences without long runs", () => {
    const sequences = [
      generateBalancedSequence(GUIDED_DEFAULTS.warmupPerTarget, 42),
      generateBalancedSequence(GUIDED_DEFAULTS.mainPerTarget, 42),
      generateBalancedSequence(GUIDED_DEFAULTS.mainPerTarget, 123456),
    ];
    for (const [index, sequence] of sequences.entries()) {
      const expectedPerTarget = index === 0 ? 2 : 20;
      expect(sequence).toHaveLength(expectedPerTarget * 4);
      expect(new Set(sequence)).toEqual(new Set(["sim", "nao", "virar", "dor"]));
      for (const target of ["sim", "nao", "virar", "dor"] as const) {
        expect(sequence.filter((item) => item === target)).toHaveLength(expectedPerTarget);
      }
      let run = 1;
      let maxRun = 1;
      for (let index = 1; index < sequence.length; index += 1) {
        run = sequence[index] === sequence[index - 1] ? run + 1 : 1;
        maxRun = Math.max(maxRun, run);
      }
      expect(maxRun).toBeLessThanOrEqual(2);
    }
    expect(generateBalancedSequence(20, 42)).toEqual(generateBalancedSequence(20, 42));
  });

  it("keeps warm-up out of formal metrics and records neutral activations", () => {
    const session = new GuidedExperimentSession(options);
    session.startNextTrial(0);
    session.confirmTrial("nao", 100);

    while (session.currentTrial === null && session.logger.attempts.length < 8) {
      const plan = session.startNextTrial(session.logger.attempts.length * 200 + 200);
      session.confirmTrial(plan!.intendedTarget, session.logger.attempts.length * 200 + 300);
    }

    session.startNeutralWindow(2_000);
    session.observe({ sample: { x: 0.5, y: 0.5, timestampMs: 2_000 }, status: "valid" }, "sim");
    session.confirmNeutralSelection("sim", 2_100);
    session.finishNeutralWindow(12_000);

    const data = session.exportData({ width: 800, height: 600, dpr: 1, orientation: "landscape" });
    expect(data.trials.filter((trial) => trial.phase === "warmup")).toHaveLength(8);
    expect(data.metrics.targetAccuracy).toBeNull();
    expect(data.metrics.falseActivationCount).toBe(1);
    expect(data.neutralWindows[0].confirmedSelections).toHaveLength(1);
  });

  it("classifies formal correct, wrong-target and timeout trials", () => {
    const session = new GuidedExperimentSession(options);
    for (let index = 0; index < 8; index += 1) {
      const plan = session.startNextTrial(index * 100);
      session.confirmTrial(plan!.intendedTarget, index * 100 + 50);
    }
    const first = session.startNextTrial(1_000)!;
    session.confirmTrial(first.intendedTarget, 1_050);
    const second = session.startNextTrial(1_100)!;
    session.confirmTrial(second.intendedTarget === "sim" ? "nao" : "sim", 1_150);
    session.startNextTrial(1_200);
    session.timeoutTrial(9_200);

    const data = session.exportData({ width: 800, height: 600, dpr: 1, orientation: "landscape" });
    const formal = data.trials.filter((trial) => trial.phase === "main");
    expect(formal[0].result).toBe("correct");
    expect(formal[1].result).toBe("wrong-target");
    expect(formal[2].result).toBe("timeout");
    expect(data.confusionMatrix[first.intendedTarget][first.intendedTarget]).toBe(1);
    expect(data.confusionMatrix[second.intendedTarget][second.intendedTarget === "sim" ? "nao" : "sim"]).toBe(1);
    expect(data.confusionMatrix[formal[2].intendedTarget].timeout).toBe(1);
  });

  it("keeps all 80 formal trials in one recorded sequence", () => {
    const session = new GuidedExperimentSession(options);
    for (let index = 0; index < 88; index += 1) {
      const plan = session.startNextTrial(index * 10)!;
      session.confirmTrial(plan.intendedTarget, index * 10 + 5);
    }
    const main = session.logger.attempts.filter((trial) => trial.phase === "main");
    expect(main).toHaveLength(80);
    expect(main.map((trial) => trial.sequenceIndex)).toEqual(Array.from({ length: 80 }, (_, index) => index + 1));
    expect(main.filter((trial) => trial.result === "correct")).toHaveLength(80);
  });

  it("preserves a partial cancelled session without filling remaining trials", () => {
    const session = new GuidedExperimentSession(options);
    session.startNextTrial(0);
    session.cancel(500);
    const data = session.exportData({ width: 800, height: 600, dpr: 1, orientation: "landscape" });
    expect(data.schemaVersion).toBe("1.0");
    expect(data.sessionStatus).toBe("cancelled");
    expect(data.trials).toHaveLength(1);
    expect(data.trials[0].result).toBe("aborted");
  });

  it("can finish after warm-up without starting formal trials", () => {
    const session = new GuidedExperimentSession(options);
    for (let index = 0; index < GUIDED_DEFAULTS.warmupPerTarget * 4; index += 1) {
      const plan = session.startNextTrial(index * 100)!;
      session.confirmTrial(plan.intendedTarget, index * 100 + 50);
    }

    expect(session.warmupOnlyReady).toBe(true);
    session.complete();
    const data = session.exportData({ width: 800, height: 600, dpr: 1, orientation: "landscape" });
    expect(data.sessionStatus).toBe("completed");
    expect(data.trials).toHaveLength(8);
    expect(data.trials.every((trial) => trial.phase === "warmup")).toBe(true);
    expect(data.metrics.targetAccuracy).toBeNull();
  });

  it("calculates quartiles and temporal blocks", () => {
    expect(summarize([100, 200, 300, 400])).toMatchObject({ median: 250, p25: 175, p75: 325, min: 100, max: 400 });
    const attempts: AttemptRecord[] = Array.from({ length: 80 }, (_, index) => ({
      id: `attempt-${index}`,
      phase: "main",
      sequenceIndex: index + 1,
      intendedTarget: "sim",
      selectedTarget: "sim",
      cueTimestamp: index * 100,
      selectionTimestamp: index * 100 + 50,
      firstEstimatedTargetEntryTimestamp: index * 100 + 10,
      result: "correct",
      trackingLossMs: 0,
      trackingUsableDurationMs: 100,
      trackingLostDurationMs: 0,
    }));
    expect(temporalBlocks(attempts).map((block) => block.label)).toEqual(["1-20", "21-40", "41-60", "61-80"]);
    expect(temporalBlocks(attempts).every((block) => block.accuracy === 1)).toBe(true);
  });
});
