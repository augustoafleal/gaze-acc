import type { GazeStatus } from "./types";

export type DwellConfig = {
  durationMs: number;
  invalidToleranceMs: number;
  cooldownMs: number;
};

export type DwellState = {
  candidateId: string | null;
  startedAtMs: number | null;
  accumulatedMs: number;
  lastTimestampMs: number | null;
  invalidSinceMs: number | null;
  progress: number;
  cooldownUntilMs: number | null;
  rearmRequired: boolean;
};

export type DwellUpdate = {
  state: DwellState;
  selection: string | null;
};

export const DEFAULT_DWELL_CONFIG: DwellConfig = {
  durationMs: 1_200,
  invalidToleranceMs: 180,
  cooldownMs: 800,
};

export function initialDwellState(): DwellState {
  return {
    candidateId: null,
    startedAtMs: null,
    accumulatedMs: 0,
    lastTimestampMs: null,
    invalidSinceMs: null,
    progress: 0,
    cooldownUntilMs: null,
    rearmRequired: false,
  };
}

function reset(state: DwellState, rearmRequired = false): DwellState {
  return {
    ...state,
    candidateId: null,
    startedAtMs: null,
    accumulatedMs: 0,
    lastTimestampMs: null,
    invalidSinceMs: null,
    progress: 0,
    rearmRequired,
  };
}

export class DwellController {
  private state = initialDwellState();

  constructor(private readonly config: DwellConfig = DEFAULT_DWELL_CONFIG) {}

  getState(): DwellState {
    return this.state;
  }

  update(targetId: string | null, status: GazeStatus, timestampMs: number): DwellUpdate {
    if (!Number.isFinite(timestampMs)) {
      return { state: this.state, selection: null };
    }

    if (this.state.cooldownUntilMs !== null && timestampMs < this.state.cooldownUntilMs) {
      this.state = reset(this.state, true);
      return { state: this.state, selection: null };
    }

    if (this.state.cooldownUntilMs !== null && timestampMs >= this.state.cooldownUntilMs) {
      this.state = { ...reset(this.state, true), cooldownUntilMs: null };
    }

    const valid = status === "valid" && targetId !== null;
    if (!valid) {
      if (this.state.rearmRequired) {
        this.state = reset(this.state);
      } else if (this.state.candidateId !== null) {
        const invalidSinceMs = this.state.invalidSinceMs ?? timestampMs;
        this.state = { ...this.state, invalidSinceMs };
        if (timestampMs - invalidSinceMs > this.config.invalidToleranceMs) {
          this.state = reset(this.state);
        }
      }
      return { state: this.state, selection: null };
    }

    if (this.state.rearmRequired) {
      return { state: this.state, selection: null };
    }

    if (this.state.candidateId !== targetId) {
      this.state = {
        ...this.state,
        candidateId: targetId,
        startedAtMs: timestampMs,
        accumulatedMs: 0,
        lastTimestampMs: timestampMs,
        invalidSinceMs: null,
        progress: 0,
      };
      return { state: this.state, selection: null };
    }

    if (this.state.invalidSinceMs !== null) {
      if (timestampMs - this.state.invalidSinceMs > this.config.invalidToleranceMs) {
        this.state = {
          ...reset(this.state),
          candidateId: targetId,
          startedAtMs: timestampMs,
          lastTimestampMs: timestampMs,
        };
        return { state: this.state, selection: null };
      }
      this.state = { ...this.state, invalidSinceMs: null, lastTimestampMs: timestampMs };
    } else if (this.state.lastTimestampMs !== null) {
      const delta = Math.max(0, timestampMs - this.state.lastTimestampMs);
      this.state = {
        ...this.state,
        accumulatedMs: this.state.accumulatedMs + delta,
        lastTimestampMs: timestampMs,
      };
    }

    const progress = Math.min(1, this.state.accumulatedMs / this.config.durationMs);
    this.state = { ...this.state, progress };
    if (progress < 1) {
      return { state: this.state, selection: null };
    }

    const selection = this.state.candidateId;
    const completedState = { ...this.state, progress: 1 };
    this.state = {
      ...reset(this.state, true),
      cooldownUntilMs: timestampMs + this.config.cooldownMs,
    };
    return { state: completedState, selection };
  }
}
