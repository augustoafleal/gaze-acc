import type { DwellConfig } from "../gaze/dwell";
import type { GazeObservation } from "../gaze/types";
import type { ConceptId } from "./concepts";
import {
  calculateMetrics,
  confusionMatrix,
  temporalBlocks,
  type AttemptRecord,
  type ConfusionMatrix,
  type ExperimentMetrics,
  type NeutralWindow,
  type TemporalBlock,
} from "./metrics";
import { ExperimentLogger, type ExperimentExport } from "./experiment";

export const GUIDED_DEFAULTS = {
  warmupPerTarget: 2,
  mainPerTarget: 20,
  neutralWindowCount: 10,
  neutralWindowDurationMs: 10_000,
  trialTimeoutMs: 8_000,
  interTrialNeutralMs: 1_200,
};

const TARGETS: ConceptId[] = ["sim", "nao", "virar", "dor"];

export type GuidedTrialPlan = {
  phase: "warmup" | "main";
  sequenceIndex: number;
  intendedTarget: ConceptId;
};

export type CalibrationRecord = {
  id: string | null;
  startedAt: number | null;
  completedAt: number | null;
  pointCount: number;
  status: "not-started" | "in-progress" | "success" | "failed";
};

export type GuidedSessionStatus = "in-progress" | "completed" | "cancelled";

export type GuidedSessionOptions = {
  provider: string;
  applicationVersion: string | null;
  dwell: DwellConfig;
  trialTimeoutMs: number;
  remoteAssetsEnabled: boolean;
  debugCursorEnabled: boolean;
  seed?: number;
};

export type GuidedExport = ExperimentExport & {
  schemaVersion: "1.0";
  sessionStatus: GuidedSessionStatus;
  finishedAt: string | null;
  providerVersion: string;
  applicationVersion: string | null;
  browser: string;
  trialTimeoutMs: number;
  debugCursorEnabled: boolean;
  remoteAssetsEnabled: boolean;
  sequence: {
    seed: number;
    warmup: ConceptId[];
    main: ConceptId[];
  };
  calibration: CalibrationRecord;
  trials: AttemptRecord[];
  neutralWindows: Array<NeutralWindow & { finishedAt: number }>;
  metrics: ExperimentMetrics;
  confusionMatrix: ConfusionMatrix;
  temporalBlocks: TemporalBlock[];
};

function nextRandom(value: number): number {
  let state = value | 0;
  state = Math.imul(state ^ (state >>> 16), 2_246_822_519);
  state = Math.imul(state ^ (state >>> 13), 3_266_489_917);
  return (state ^ (state >>> 16)) >>> 0;
}

export function generateBalancedSequence(countPerTarget: number, seed: number): ConceptId[] {
  if (!Number.isInteger(countPerTarget) || countPerTarget < 0) {
    throw new Error("countPerTarget must be a non-negative integer");
  }

  const sequence: ConceptId[] = [];
  let state = seed | 0;

  // Each round contains every target exactly once. Concatenating rounds
  // preserves the balance and makes a run longer than two impossible.
  for (let round = 0; round < countPerTarget; round += 1) {
    const order = [...TARGETS];
    for (let index = order.length - 1; index > 0; index -= 1) {
      state = nextRandom(state);
      const swapIndex = state % (index + 1);
      [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
    }
    sequence.push(...order);
  }

  return sequence;
}

function isoNow(): string {
  return new Date().toISOString();
}

export class GuidedExperimentSession {
  readonly logger: ExperimentLogger;
  readonly seed: number;
  readonly warmupSequence: ConceptId[];
  readonly mainSequence: ConceptId[];
  readonly startedAt: string;
  readonly trialTimeoutMs: number;

  private warmupIndex = 0;
  private mainIndex = 0;
  private activeTrial: GuidedTrialPlan | null = null;
  private sessionStatus: GuidedSessionStatus = "in-progress";
  private finishedAt: string | null = null;
  private calibration: CalibrationRecord = {
    id: null,
    startedAt: null,
    completedAt: null,
    pointCount: 0,
    status: "not-started",
  };

  constructor(private readonly options: GuidedSessionOptions) {
    this.seed = options.seed ?? Date.now();
    this.warmupSequence = generateBalancedSequence(GUIDED_DEFAULTS.warmupPerTarget, this.seed);
    this.mainSequence = generateBalancedSequence(GUIDED_DEFAULTS.mainPerTarget, this.seed ^ 0x45d9f3b);
    this.trialTimeoutMs = options.trialTimeoutMs;
    this.startedAt = isoNow();
    this.logger = new ExperimentLogger(options.provider, options.dwell, null);
  }

  get status(): GuidedSessionStatus {
    return this.sessionStatus;
  }

  get currentTrial(): GuidedTrialPlan | null {
    return this.activeTrial;
  }

  get calibrationRecord(): CalibrationRecord {
    return { ...this.calibration };
  }

  get warmupOnlyReady(): boolean {
    return this.activeTrial === null && this.warmupIndex === this.warmupSequence.length && this.mainIndex === 0;
  }

  beginCalibration(startedAt: number): void {
    this.calibration = { id: null, startedAt, completedAt: null, pointCount: 0, status: "in-progress" };
  }

  recordCalibrationPoint(): void {
    if (this.calibration.status === "in-progress") this.calibration.pointCount += 1;
  }

  completeCalibration(id: string, completedAt: number): void {
    this.calibration = { ...this.calibration, id, completedAt, status: "success" };
    this.logger.setCalibrationId(id);
  }

  failCalibration(completedAt: number): void {
    this.calibration = { ...this.calibration, completedAt, status: "failed" };
  }

  observe(observation: GazeObservation, targetId: ConceptId | null): void {
    this.logger.observe(observation, targetId);
  }

  startNextTrial(cueTimestamp: number): GuidedTrialPlan | null {
    if (this.activeTrial || this.sessionStatus !== "in-progress") return null;

    let plan: GuidedTrialPlan | null = null;
    if (this.warmupIndex < this.warmupSequence.length) {
      plan = { phase: "warmup", sequenceIndex: this.warmupIndex + 1, intendedTarget: this.warmupSequence[this.warmupIndex] };
      this.warmupIndex += 1;
    } else if (this.mainIndex < this.mainSequence.length) {
      plan = { phase: "main", sequenceIndex: this.mainIndex + 1, intendedTarget: this.mainSequence[this.mainIndex] };
      this.mainIndex += 1;
    }

    if (!plan) return null;
    this.activeTrial = plan;
    this.logger.startAttempt(plan.intendedTarget, cueTimestamp, plan);
    return plan;
  }

  confirmTrial(selectedTarget: ConceptId, timestamp: number): AttemptRecord | null {
    if (!this.activeTrial) return null;
    this.logger.confirmSelection(selectedTarget, timestamp);
    this.activeTrial = null;
    return this.logger.attempts[this.logger.attempts.length - 1] ?? null;
  }

  timeoutTrial(timestamp: number): AttemptRecord | null {
    if (!this.activeTrial) return null;
    this.logger.finishAttemptAsTimeout(timestamp);
    this.activeTrial = null;
    return this.logger.attempts[this.logger.attempts.length - 1] ?? null;
  }

  abortTrial(timestamp: number): AttemptRecord | null {
    if (!this.activeTrial) return null;
    this.logger.abortAttempt(timestamp);
    this.activeTrial = null;
    return this.logger.attempts[this.logger.attempts.length - 1] ?? null;
  }

  startNeutralWindow(startedAt: number): void {
    this.logger.startNeutralWindow(startedAt);
  }

  finishNeutralWindow(endedAt: number): void {
    this.logger.finishNeutralWindow(endedAt);
  }

  confirmNeutralSelection(selectedTarget: ConceptId, timestamp: number): void {
    this.logger.confirmSelection(selectedTarget, timestamp);
  }

  cancel(timestamp = performance.now()): void {
    this.abortTrial(timestamp);
    this.logger.finishNeutralWindow(timestamp);
    this.sessionStatus = "cancelled";
    this.finishedAt = isoNow();
  }

  complete(): void {
    this.sessionStatus = "completed";
    this.finishedAt = isoNow();
  }

  exportData(viewport: ExperimentExport["viewport"]): GuidedExport {
    const base = this.logger.exportData(viewport);
    const metrics = calculateMetrics(base.attempts, base.neutralWindows, base.activeEvaluationMs, base.trackingLossMs, {
      phase: "main",
    });
    return {
      ...base,
      schemaVersion: "1.0",
      sessionStatus: this.sessionStatus,
      finishedAt: this.finishedAt,
      providerVersion: this.options.provider,
      applicationVersion: this.options.applicationVersion,
      browser: typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
      trialTimeoutMs: this.trialTimeoutMs,
      debugCursorEnabled: this.options.debugCursorEnabled,
      remoteAssetsEnabled: this.options.remoteAssetsEnabled,
      sequence: { seed: this.seed, warmup: [...this.warmupSequence], main: [...this.mainSequence] },
      calibration: this.calibrationRecord,
      trials: [...base.attempts],
      neutralWindows: base.neutralWindows.map((window) => ({ ...window, finishedAt: window.endedAt })),
      metrics,
      confusionMatrix: confusionMatrix(base.attempts),
      temporalBlocks: temporalBlocks(base.attempts),
    };
  }
}
