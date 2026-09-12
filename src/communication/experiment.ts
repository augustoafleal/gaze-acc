import { calculateMetrics, type AttemptRecord, type NeutralWindow } from "./metrics";
import type { ConceptId } from "./concepts";
import type { GazeObservation, GazeStatus } from "../gaze/types";

type ActiveAttempt = AttemptRecord;

function emptyStatusCounts(): Record<GazeStatus, number> {
  return { valid: 0, "no-face": 0, "eyes-closed": 0, invalid: 0, error: 0 };
}

export type ExperimentExport = {
  sessionId: string;
  provider: string;
  startedAt: string;
  viewport: { width: number; height: number; dpr: number; orientation: "portrait" | "landscape" };
  dwell: { durationMs: number; invalidToleranceMs: number; cooldownMs: number };
  calibrationId: string | null;
  attempts: AttemptRecord[];
  neutralWindows: NeutralWindow[];
  activeEvaluationMs: number;
  trackingLossMs: number;
  clock: {
    source: "performance.now";
    unit: "milliseconds";
    monotonic: true;
  };
};

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class ExperimentLogger {
  readonly sessionId = id("session");
  readonly startedAt = new Date().toISOString();
  readonly attempts: AttemptRecord[] = [];
  readonly neutralWindows: NeutralWindow[] = [];

  private activeAttempt: ActiveAttempt | null = null;
  private activeNeutral: NeutralWindow | null = null;
  private lastTimestampMs: number | null = null;
  private lastStatus: GazeStatus | null = null;
  private activeEvaluationMs = 0;
  private trackingLossMs = 0;

  constructor(
    private readonly provider: string,
    private readonly dwell: { durationMs: number; invalidToleranceMs: number; cooldownMs: number },
    private calibrationId: string | null,
  ) {}

  setCalibrationId(calibrationId: string | null): void {
    this.calibrationId = calibrationId;
  }

  private recordDuration(status: GazeStatus | null, deltaMs: number): void {
    if (deltaMs <= 0 || (this.activeAttempt === null && this.activeNeutral === null)) return;
    const lost = status !== "valid";
    this.activeEvaluationMs += deltaMs;
    if (lost) this.trackingLossMs += deltaMs;

    if (this.activeAttempt) {
      this.activeAttempt.trackingUsableDurationMs! += lost ? 0 : deltaMs;
      this.activeAttempt.trackingLostDurationMs! += lost ? deltaMs : 0;
      this.activeAttempt.trackingLossMs = this.activeAttempt.trackingLostDurationMs!;
    }
    if (this.activeNeutral) {
      this.activeNeutral.usableTrackingMs += lost ? 0 : deltaMs;
      this.activeNeutral.lostTrackingMs! += lost ? deltaMs : 0;
    }
  }

  private advanceClock(timestampMs: number, status: GazeStatus | null): void {
    if (!Number.isFinite(timestampMs)) return;
    const deltaMs = this.lastTimestampMs === null ? 0 : Math.max(0, timestampMs - this.lastTimestampMs);
    this.recordDuration(status, deltaMs);
    this.lastTimestampMs = Math.max(this.lastTimestampMs ?? timestampMs, timestampMs);
    this.lastStatus = status;
  }

  private closeActiveInterval(timestampMs: number): void {
    if (!Number.isFinite(timestampMs)) return;
    this.advanceClock(timestampMs, this.lastStatus ?? "invalid");
    this.lastStatus = null;
  }

  observe(observation: GazeObservation, targetId: ConceptId | null): void {
    const timestampMs = observation.timestampMs ?? observation.sample?.timestampMs ?? performance.now();
    this.advanceClock(timestampMs, observation.status);

    if (this.activeAttempt) {
      this.activeAttempt.statusCounts![observation.status] += 1;
    }

    if (this.activeNeutral) {
      this.activeNeutral.statusCounts![observation.status] += 1;
    }

    if (
      this.activeAttempt &&
      targetId === this.activeAttempt.intendedTarget &&
      this.activeAttempt.firstEstimatedTargetEntryTimestamp === null
    ) {
      this.activeAttempt.firstEstimatedTargetEntryTimestamp = timestampMs;
    }
  }

  startAttempt(
    intendedTarget: ConceptId,
    cueTimestamp = performance.now(),
    metadata: Pick<AttemptRecord, "phase" | "sequenceIndex"> = {},
  ): void {
    this.finishAttemptAsTimeout(cueTimestamp);
    this.activeAttempt = {
      id: id("attempt"),
      ...metadata,
      intendedTarget,
      selectedTarget: null,
      cueTimestamp,
      selectionTimestamp: null,
      firstEstimatedTargetEntryTimestamp: null,
      result: "timeout",
      durationMs: 0,
      trackingLossMs: 0,
      trackingUsableDurationMs: 0,
      trackingLostDurationMs: 0,
      statusCounts: emptyStatusCounts(),
    };
    this.lastTimestampMs = cueTimestamp;
    this.lastStatus = null;
  }

  confirmSelection(selectedTarget: ConceptId, selectionTimestamp = performance.now()): void {
    if (this.activeAttempt) {
      this.closeActiveInterval(selectionTimestamp);
      this.activeAttempt.selectedTarget = selectedTarget;
      this.activeAttempt.selectionTimestamp = selectionTimestamp;
      this.activeAttempt.durationMs = Math.max(0, selectionTimestamp - this.activeAttempt.cueTimestamp);
      this.activeAttempt.result = selectedTarget === this.activeAttempt.intendedTarget ? "correct" : "wrong-target";
      this.attempts.push(this.activeAttempt);
      this.activeAttempt = null;
      return;
    }

    if (this.activeNeutral) {
      this.activeNeutral.falseActivationCount += 1;
      this.activeNeutral.confirmedSelections!.push({ timestampMs: selectionTimestamp, target: selectedTarget });
    }
  }

  finishAttemptAsTimeout(timestamp = performance.now()): void {
    if (!this.activeAttempt) return;
    this.closeActiveInterval(timestamp);
    this.activeAttempt.selectionTimestamp = null;
    this.activeAttempt.durationMs = Math.max(0, timestamp - this.activeAttempt.cueTimestamp);
    this.activeAttempt.result = "timeout";
    this.attempts.push(this.activeAttempt);
    this.activeAttempt = null;
    this.lastTimestampMs = timestamp;
    this.lastStatus = null;
  }

  abortAttempt(timestamp = performance.now()): void {
    if (!this.activeAttempt) return;
    this.closeActiveInterval(timestamp);
    this.activeAttempt.selectionTimestamp = null;
    this.activeAttempt.durationMs = Math.max(0, timestamp - this.activeAttempt.cueTimestamp);
    this.activeAttempt.result = "aborted";
    this.attempts.push(this.activeAttempt);
    this.activeAttempt = null;
    this.lastTimestampMs = timestamp;
    this.lastStatus = null;
  }

  startNeutralWindow(startedAt = performance.now()): void {
    this.finishNeutralWindow(startedAt);
    this.activeNeutral = {
      id: id("neutral"),
      startedAt,
      endedAt: startedAt,
      durationMs: 0,
      usableTrackingMs: 0,
      lostTrackingMs: 0,
      falseActivationCount: 0,
      confirmedSelections: [],
      statusCounts: emptyStatusCounts(),
    };
    this.lastTimestampMs = startedAt;
    this.lastStatus = null;
  }

  finishNeutralWindow(endedAt = performance.now()): void {
    if (!this.activeNeutral) return;
    this.closeActiveInterval(endedAt);
    this.activeNeutral.endedAt = endedAt;
    this.activeNeutral.durationMs = Math.max(0, endedAt - this.activeNeutral.startedAt);
    this.neutralWindows.push(this.activeNeutral);
    this.activeNeutral = null;
    this.lastTimestampMs = endedAt;
    this.lastStatus = null;
  }

  metrics() {
    return calculateMetrics(this.attempts, this.neutralWindows, this.activeEvaluationMs, this.trackingLossMs);
  }

  exportData(viewport: ExperimentExport["viewport"]): ExperimentExport {
    this.finishAttemptAsTimeout();
    this.finishNeutralWindow();
    return {
      sessionId: this.sessionId,
      provider: this.provider,
      startedAt: this.startedAt,
      viewport,
      dwell: this.dwell,
      calibrationId: this.calibrationId,
      attempts: [...this.attempts],
      neutralWindows: [...this.neutralWindows],
      activeEvaluationMs: this.activeEvaluationMs,
      trackingLossMs: this.trackingLossMs,
      clock: { source: "performance.now", unit: "milliseconds", monotonic: true },
    };
  }
}
