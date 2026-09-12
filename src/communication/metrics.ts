import type { ConceptId } from "./concepts";
import type { GazeStatus } from "../gaze/types";

export type AttemptPhase = "warmup" | "main";
export type AttemptResult = "correct" | "wrong-target" | "timeout" | "aborted";

export type GazeStatusCounts = Record<GazeStatus, number>;

export type AttemptRecord = {
  id: string;
  phase?: AttemptPhase;
  sequenceIndex?: number;
  intendedTarget: ConceptId;
  selectedTarget: ConceptId | null;
  cueTimestamp: number;
  selectionTimestamp: number | null;
  firstEstimatedTargetEntryTimestamp: number | null;
  result: AttemptResult;
  durationMs?: number;
  trackingLossMs: number;
  trackingUsableDurationMs?: number;
  trackingLostDurationMs?: number;
  statusCounts?: GazeStatusCounts;
};

export type NeutralWindow = {
  id: string;
  startedAt: number;
  endedAt: number;
  durationMs?: number;
  usableTrackingMs: number;
  lostTrackingMs?: number;
  falseActivationCount: number;
  confirmedSelections?: Array<{ timestampMs: number; target: ConceptId }>;
  statusCounts?: GazeStatusCounts;
};

export type NumericSummary = {
  median: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
};

export type ExperimentMetrics = {
  targetAccuracy: number | null;
  targetAccuracyByTarget: Record<ConceptId, number | null>;
  wrongTargetCount: number;
  timeoutCount: number;
  falseActivationCount: number;
  falseActivationRatePerMinute: number | null;
  medianCueToConfirmationLatencyMs: number | null;
  cueToConfirmation: NumericSummary;
  medianEntryToConfirmationLatencyMs: number | null;
  trackingLossRate: number | null;
};

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  if (percentileValue <= 0) return Math.min(...values);
  if (percentileValue >= 1) return Math.max(...values);

  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function summarize(values: number[]): NumericSummary {
  return {
    median: median(values),
    p25: percentile(values, 0.25),
    p75: percentile(values, 0.75),
    min: values.length === 0 ? null : Math.min(...values),
    max: values.length === 0 ? null : Math.max(...values),
  };
}

const CONCEPT_IDS: ConceptId[] = ["sim", "nao", "virar", "dor"];

export type ConfusionMatrix = Record<ConceptId, Record<ConceptId | "timeout", number>>;

export function confusionMatrix(attempts: AttemptRecord[]): ConfusionMatrix {
  const matrix = Object.fromEntries(
    CONCEPT_IDS.map((intended) => [
      intended,
      Object.fromEntries([...CONCEPT_IDS, "timeout"].map((selected) => [selected, 0])),
    ]),
  ) as ConfusionMatrix;

  for (const attempt of attempts.filter((item) => item.phase === undefined || item.phase === "main")) {
    if (attempt.result === "aborted") continue;
    matrix[attempt.intendedTarget][attempt.selectedTarget ?? "timeout"] += 1;
  }
  return matrix;
}

export type TemporalBlock = {
  label: "1-20" | "21-40" | "41-60" | "61-80";
  start: number;
  end: number;
  accuracy: number | null;
  medianLatencyMs: number | null;
  trackingLossRate: number | null;
};

export function temporalBlocks(attempts: AttemptRecord[]): TemporalBlock[] {
  const formal = attempts
    .filter((attempt) => attempt.phase === "main")
    .sort((a, b) => (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0));
  const blocks = [
    { label: "1-20" as const, start: 1, end: 20 },
    { label: "21-40" as const, start: 21, end: 40 },
    { label: "41-60" as const, start: 41, end: 60 },
    { label: "61-80" as const, start: 61, end: 80 },
  ];

  return blocks.map((block) => {
    const selected = formal.filter((attempt, index) => {
      const sequenceIndex = attempt.sequenceIndex ?? index + 1;
      return sequenceIndex >= block.start && sequenceIndex <= block.end;
    });
    const scored = selected.filter((attempt) => attempt.result !== "aborted");
    const latencies = scored.flatMap((attempt) =>
      attempt.selectionTimestamp === null ? [] : [attempt.selectionTimestamp - attempt.cueTimestamp],
    );
    const lost = selected.reduce(
      (sum, attempt) => sum + (attempt.trackingLostDurationMs ?? attempt.trackingLossMs),
      0,
    );
    const active = selected.reduce(
      (sum, attempt) =>
        sum + (attempt.trackingUsableDurationMs ?? 0) + (attempt.trackingLostDurationMs ?? attempt.trackingLossMs),
      0,
    );
    return {
      ...block,
      accuracy: scored.length === 0 ? null : scored.filter((attempt) => attempt.result === "correct").length / scored.length,
      medianLatencyMs: median(latencies),
      trackingLossRate: active === 0 ? null : lost / active,
    };
  });
}

export function calculateMetrics(
  attempts: AttemptRecord[],
  neutralWindows: NeutralWindow[],
  activeEvaluationMs: number,
  trackingLossMs: number,
  options: { phase?: AttemptPhase } = {},
): ExperimentMetrics {
  const scopedAttempts = options.phase ? attempts.filter((attempt) => attempt.phase === options.phase) : attempts;
  const scoredAttempts = scopedAttempts.filter((attempt) => attempt.result !== "aborted");
  const correct = scoredAttempts.filter((attempt) => attempt.result === "correct").length;
  const wrongTargetCount = scoredAttempts.filter((attempt) => attempt.result === "wrong-target").length;
  const timeoutCount = scoredAttempts.filter((attempt) => attempt.result === "timeout").length;
  const cueLatencies = scoredAttempts.flatMap((attempt) =>
    attempt.selectionTimestamp === null ? [] : [attempt.selectionTimestamp - attempt.cueTimestamp],
  );
  const entryLatencies = scoredAttempts.flatMap((attempt) =>
    attempt.selectionTimestamp === null || attempt.firstEstimatedTargetEntryTimestamp === null
      ? []
      : [attempt.selectionTimestamp - attempt.firstEstimatedTargetEntryTimestamp],
  );
  const targetAccuracyByTarget = Object.fromEntries(
    CONCEPT_IDS.map((target) => {
      const targetAttempts = scoredAttempts.filter((attempt) => attempt.intendedTarget === target);
      return [
        target,
        targetAttempts.length === 0
          ? null
          : targetAttempts.filter((attempt) => attempt.result === "correct").length / targetAttempts.length,
      ];
    }),
  ) as Record<ConceptId, number | null>;
  const falseActivationCount = neutralWindows.reduce((sum, window) => sum + window.falseActivationCount, 0);
  const usableNeutralMinutes =
    neutralWindows.reduce((sum, window) => sum + window.usableTrackingMs, 0) / 60_000;
  const recordLost = scopedAttempts.reduce(
    (sum, attempt) => sum + (attempt.trackingLostDurationMs ?? attempt.trackingLossMs),
    0,
  );
  const recordActive = scopedAttempts.reduce(
    (sum, attempt) =>
      sum + (attempt.trackingUsableDurationMs ?? 0) + (attempt.trackingLostDurationMs ?? attempt.trackingLossMs),
    0,
  );
  const scopedLoss = options.phase ? recordLost : trackingLossMs;
  const scopedActive = options.phase ? recordActive : activeEvaluationMs;
  const cueToConfirmation = summarize(cueLatencies);

  return {
    targetAccuracy: scoredAttempts.length === 0 ? null : correct / scoredAttempts.length,
    targetAccuracyByTarget,
    wrongTargetCount,
    timeoutCount,
    falseActivationCount,
    falseActivationRatePerMinute:
      usableNeutralMinutes === 0 ? null : falseActivationCount / usableNeutralMinutes,
    medianCueToConfirmationLatencyMs: cueToConfirmation.median,
    cueToConfirmation,
    medianEntryToConfirmationLatencyMs: median(entryLatencies),
    trackingLossRate: scopedActive === 0 ? null : scopedLoss / scopedActive,
  };
}
