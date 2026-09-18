import type { EyeState } from "./eye-types";

export const DEFAULT_BLINK_CONFIG = {
  minIntentionalBlinkMs: 120,
  longBlinkThresholdMs: 700,
  doubleBlinkWindowMs: 450,
  doubleBlinkEnabled: true,
  cooldownMs: 800,
  maxClosedDurationMs: 5_000,
  stateStabilityMs: 0,
} as const;

export type BlinkConfig = {
  minIntentionalBlinkMs: number;
  longBlinkThresholdMs: number;
  doubleBlinkWindowMs: number;
  doubleBlinkEnabled: boolean;
  cooldownMs: number;
  maxClosedDurationMs: number;
  /** Minimum time a new open/closed observation must stay consistent before the
   *  detector accepts the transition. 0 disables stabilization. Never applied to
   *  "unavailable", which stays immediate for tracking-loss safety. */
  stateStabilityMs: number;
};

export type BlinkGesture = "short" | "double" | "long";
export type BlinkDiagnosticClassification = "ignored" | "short" | "double" | "long" | "cancelled";

export type DetectorStateName =
  | "idle"
  | "closed"
  | "pending-short"
  | "second-closed"
  | "cooldown"
  | "unavailable";

export type BlinkDiagnosticKind =
  | "eye_closed"
  | "eye_opened"
  | "short_candidate"
  | "double_window_started"
  | "second_blink_started"
  | "double_confirmed"
  | "short_committed"
  | "gesture_cancelled"
  | "long_confirmed";

export type BlinkGestureEvent = {
  gesture: BlinkGesture;
  timestampMs: number;
  closedDurationMs: number;
};

export type BlinkDiagnosticEvent = {
  timestampMs: number;
  kind: BlinkDiagnosticKind;
  classification: BlinkDiagnosticClassification;
  trackingState: EyeState;
  detectorState: DetectorStateName;
  closedDurationMs: number | null;
  firstBlinkDurationMs: number | null;
  interBlinkGapMs: number | null;
  secondBlinkDurationMs: number | null;
  secondBlinkStartedBeforeDeadline: boolean | null;
};

export type BlinkDetectorUpdate = {
  gestures: BlinkGestureEvent[];
  diagnostics: BlinkDiagnosticEvent[];
};

export type BlinkDetectorSnapshot = {
  eyeState: EyeState;
  detectorState: DetectorStateName;
  lastClosedDurationMs: number | null;
  pendingShort: boolean;
  doubleBlinkRemainingMs: number | null;
  doubleWindowDeadlineMs: number | null;
  firstBlinkDurationMs: number | null;
  firstBlinkCompletedAtMs: number | null;
  secondBlinkStartedAtMs: number | null;
  secondBlinkInProgress: boolean;
  currentClosedDurationMs: number | null;
  lastGesture: BlinkGesture | null;
  cooldownRemainingMs: number;
};

function isFiniteTimestamp(timestampMs: number): boolean {
  return Number.isFinite(timestampMs) && timestampMs >= 0;
}

export class BlinkGestureDetector {
  private eyeState: EyeState = "unavailable";
  private hasSeenOpen = false;
  private closedStartedAtMs: number | null = null;
  private firstBlinkCompletedAtMs: number | null = null;
  private firstBlinkDurationMs: number | null = null;
  private secondBlinkStartedAtMs: number | null = null;
  private secondBlinkDurationMs: number | null = null;
  private secondBlinkInProgress = false;
  private lastClosedDurationMs: number | null = null;
  private lastGesture: BlinkGesture | null = null;
  private cooldownUntilMs = 0;
  private lastTimestampMs: number | null = null;
  private lastObservedState: EyeState = "unavailable";
  private candidateState: EyeState | null = null;
  private candidateSinceMs: number | null = null;

  constructor(private readonly config: BlinkConfig = DEFAULT_BLINK_CONFIG) {}

  update(nextState: EyeState, timestampMs: number): BlinkDetectorUpdate {
    if (!isFiniteTimestamp(timestampMs) || (this.lastTimestampMs !== null && timestampMs < this.lastTimestampMs)) {
      this.reset();
      return { gestures: [], diagnostics: [] };
    }
    this.lastTimestampMs = timestampMs;
    this.lastObservedState = nextState;

    if (nextState === "unavailable") {
      return this.handleUnavailable(timestampMs);
    }

    const accepted = this.acceptTransition(nextState, timestampMs);
    if (accepted === null) {
      // The transition is still being stabilized. While a possible second
      // closure is pending acceptance, never resolve the first short: the
      // second blink may have started inside the window.
      if (this.candidateState === "closed") return { gestures: [], diagnostics: [] };
      return this.expirePendingShort(timestampMs);
    }
    return this.processTransition(accepted.state, accepted.atMs, timestampMs);
  }

  snapshot(timestampMs: number): BlinkDetectorSnapshot {
    const deadline = this.doubleWindowDeadlineMs();
    const currentClosedDurationMs = this.closedStartedAtMs === null
      ? null
      : Math.max(0, timestampMs - this.closedStartedAtMs);
    return {
      eyeState: this.eyeState,
      detectorState: this.detectorStateName(),
      lastClosedDurationMs: this.lastClosedDurationMs,
      pendingShort: this.firstBlinkCompletedAtMs !== null,
      doubleBlinkRemainingMs: deadline === null ? null : deadline - timestampMs,
      doubleWindowDeadlineMs: deadline,
      firstBlinkDurationMs: this.firstBlinkDurationMs,
      firstBlinkCompletedAtMs: this.firstBlinkCompletedAtMs,
      secondBlinkStartedAtMs: this.secondBlinkStartedAtMs,
      secondBlinkInProgress: this.secondBlinkInProgress,
      currentClosedDurationMs,
      lastGesture: this.lastGesture,
      cooldownRemainingMs: Math.max(0, this.cooldownUntilMs - timestampMs),
    };
  }

  private acceptTransition(
    nextState: EyeState,
    timestampMs: number,
  ): { state: EyeState; atMs: number } | null {
    if (nextState === this.eyeState) {
      this.candidateState = null;
      this.candidateSinceMs = null;
      return { state: nextState, atMs: timestampMs };
    }
    if (this.config.stateStabilityMs <= 0) {
      this.candidateState = null;
      this.candidateSinceMs = null;
      return { state: nextState, atMs: timestampMs };
    }
    if (this.candidateState === nextState) {
      const since = this.candidateSinceMs ?? timestampMs;
      if (timestampMs - since >= this.config.stateStabilityMs) {
        this.candidateState = null;
        this.candidateSinceMs = null;
        return { state: nextState, atMs: since };
      }
      return null;
    }
    this.candidateState = nextState;
    this.candidateSinceMs = timestampMs;
    return null;
  }

  private processTransition(state: EyeState, atMs: number, nowMs: number): BlinkDetectorUpdate {
    const gestures: BlinkGestureEvent[] = [];
    const diagnostics: BlinkDiagnosticEvent[] = [];

    if (state === "closed") {
      const wasOpen = this.eyeState !== "closed";
      this.eyeState = "closed";
      this.candidateState = null;
      this.candidateSinceMs = null;

      if (!wasOpen) {
        // Repeat frame while already closed: only structural deadline expiry
        // applies, and never while a second blink is being held.
        const expired = this.expirePendingShort(nowMs);
        gestures.push(...expired.gestures);
        diagnostics.push(...expired.diagnostics);
        return { gestures, diagnostics };
      }

      if (!this.hasSeenOpen) {
        this.closedStartedAtMs = null;
        diagnostics.push(this.diag("eye_closed", nowMs));
        return { gestures, diagnostics };
      }

      this.closedStartedAtMs = atMs;
      diagnostics.push(this.diag("eye_closed", nowMs));

      if (this.firstBlinkCompletedAtMs !== null && !this.secondBlinkInProgress) {
        const deadline = this.firstBlinkCompletedAtMs + this.config.doubleBlinkWindowMs;
        if (atMs <= deadline) {
          // The second blink STARTED inside the window; let it finish freely.
          this.secondBlinkInProgress = true;
          this.secondBlinkStartedAtMs = atMs;
          this.secondBlinkDurationMs = null;
          diagnostics.push(this.diag("second_blink_started", nowMs));
        } else {
          // The second blink started after the deadline: the first short is now
          // unconditional and this closure becomes a fresh first blink.
          const committed = this.commitPendingShort(nowMs);
          gestures.push(...committed.gestures);
          diagnostics.push(...committed.diagnostics);
          this.closedStartedAtMs = atMs;
        }
      }
      return { gestures, diagnostics };
    }

    // state === "open"
    const wasClosed = this.eyeState === "closed";
    this.eyeState = "open";
    this.hasSeenOpen = true;
    this.candidateState = null;
    this.candidateSinceMs = null;

    if (wasClosed && this.closedStartedAtMs !== null) {
      const durationMs = atMs - this.closedStartedAtMs;
      this.lastClosedDurationMs = durationMs;
      this.closedStartedAtMs = null;

      if (this.secondBlinkInProgress) {
        this.secondBlinkDurationMs = durationMs;
        const classification = this.classify(durationMs);
        if (classification === "long") {
          this.clearPending();
          const event = this.emit("long", nowMs, durationMs);
          if (event) gestures.push(event);
          diagnostics.push(this.diag("long_confirmed", nowMs, {
            classification: event ? "long" : "ignored",
            closedDurationMs: durationMs,
          }));
          diagnostics.push(this.diag("eye_opened", nowMs, {
            classification: event ? "long" : "ignored",
            closedDurationMs: durationMs,
          }));
        } else if (classification === "short") {
          this.clearPending();
          const event = this.emit("double", nowMs, durationMs);
          if (event) gestures.push(event);
          diagnostics.push(this.diag("double_confirmed", nowMs, {
            classification: event ? "double" : "ignored",
            closedDurationMs: durationMs,
          }));
          diagnostics.push(this.diag("eye_opened", nowMs, {
            classification: event ? "double" : "ignored",
            closedDurationMs: durationMs,
          }));
        } else {
          // The second closure was not a viable short. Cancelling the whole
          // gesture avoids emitting NEXT for an attempt the user meant as a
          // double (a false activation in either direction is worse than none).
          this.clearPending();
          diagnostics.push(this.diag("gesture_cancelled", nowMs, {
            classification: "cancelled",
            closedDurationMs: durationMs,
          }));
        }
        return { gestures, diagnostics };
      }

      if (this.firstBlinkCompletedAtMs === null) {
        const classification = this.classify(durationMs);
        if (classification === "long") {
          this.clearPending();
          const event = this.emit("long", nowMs, durationMs);
          if (event) gestures.push(event);
          diagnostics.push(this.diag("long_confirmed", nowMs, {
            classification: event ? "long" : "ignored",
            closedDurationMs: durationMs,
          }));
          diagnostics.push(this.diag("eye_opened", nowMs, {
            classification: event ? "long" : "ignored",
            closedDurationMs: durationMs,
          }));
        } else if (classification === "short") {
          if (!this.config.doubleBlinkEnabled) {
            const event = this.emit("short", nowMs, durationMs);
            if (event) gestures.push(event);
            diagnostics.push(this.diag("short_committed", nowMs, {
              classification: event ? "short" : "ignored",
              closedDurationMs: durationMs,
            }));
            diagnostics.push(this.diag("eye_opened", nowMs, {
              classification: event ? "short" : "ignored",
              closedDurationMs: durationMs,
            }));
            return { gestures, diagnostics };
          }
          this.firstBlinkCompletedAtMs = atMs;
          this.firstBlinkDurationMs = durationMs;
          diagnostics.push(this.diag("short_candidate", nowMs, {
            classification: "short",
            closedDurationMs: durationMs,
          }));
          diagnostics.push(this.diag("double_window_started", nowMs, {
            classification: "short",
            closedDurationMs: durationMs,
          }));
          diagnostics.push(this.diag("eye_opened", nowMs, {
            classification: "short",
            closedDurationMs: durationMs,
          }));
        } else {
          diagnostics.push(this.diag("eye_opened", nowMs, {
            classification: "ignored",
            closedDurationMs: durationMs,
          }));
        }
        return { gestures, diagnostics };
      }

      // Defensive: a closure completed while a pending first short exists
      // without a registered second blink. Commit the short, then treat this
      // closure as a fresh first blink.
      const committed = this.commitPendingShort(nowMs);
      gestures.push(...committed.gestures);
      diagnostics.push(...committed.diagnostics);
      return { gestures, diagnostics };
    }

    // Repeat open frame: resolve the first short once its window has expired.
    const expired = this.expirePendingShort(nowMs);
    gestures.push(...expired.gestures);
    diagnostics.push(...expired.diagnostics);
    return { gestures, diagnostics };
  }

  private handleUnavailable(timestampMs: number): BlinkDetectorUpdate {
    const diagnostics: BlinkDiagnosticEvent[] = [];
    if (this.closedStartedAtMs !== null) {
      diagnostics.push(this.diag("gesture_cancelled", timestampMs, {
        classification: "cancelled",
        closedDurationMs: timestampMs - this.closedStartedAtMs,
      }));
    }
    if (this.firstBlinkCompletedAtMs !== null) {
      diagnostics.push(this.diag("gesture_cancelled", timestampMs, { classification: "cancelled" }));
    }
    this.reset();
    this.eyeState = "unavailable";
    this.candidateState = null;
    this.candidateSinceMs = null;
    this.hasSeenOpen = false;
    this.lastClosedDurationMs = null;
    return { gestures: [], diagnostics };
  }

  private commitPendingShort(nowMs: number): BlinkDetectorUpdate {
    if (this.firstBlinkCompletedAtMs === null) return { gestures: [], diagnostics: [] };
    const durationMs = this.firstBlinkDurationMs ?? 0;
    this.clearPending();
    const event = this.emit("short", nowMs, durationMs);
    return {
      gestures: event ? [event] : [],
      diagnostics: [this.diag("short_committed", nowMs, {
        classification: event ? "short" : "ignored",
        closedDurationMs: durationMs,
      })],
    };
  }

  private expirePendingShort(nowMs: number): BlinkDetectorUpdate {
    if (!this.config.doubleBlinkEnabled) return { gestures: [], diagnostics: [] };
    if (this.firstBlinkCompletedAtMs === null || this.secondBlinkInProgress) {
      return { gestures: [], diagnostics: [] };
    }
    if (nowMs <= this.firstBlinkCompletedAtMs + this.config.doubleBlinkWindowMs) {
      return { gestures: [], diagnostics: [] };
    }
    return this.commitPendingShort(nowMs);
  }

  private clearPending(): void {
    this.firstBlinkCompletedAtMs = null;
    this.firstBlinkDurationMs = null;
    this.secondBlinkStartedAtMs = null;
    this.secondBlinkDurationMs = null;
    this.secondBlinkInProgress = false;
  }

  private classify(durationMs: number): "ignored" | "short" | "long" {
    if (durationMs < this.config.minIntentionalBlinkMs || durationMs > this.config.maxClosedDurationMs) return "ignored";
    if (durationMs >= this.config.longBlinkThresholdMs) return "long";
    return "short";
  }

  private doubleWindowDeadlineMs(): number | null {
    return !this.config.doubleBlinkEnabled || this.firstBlinkCompletedAtMs === null
      ? null
      : this.firstBlinkCompletedAtMs + this.config.doubleBlinkWindowMs;
  }

  private interBlinkGapMs(): number | null {
    if (this.firstBlinkCompletedAtMs === null || this.secondBlinkStartedAtMs === null) return null;
    return this.secondBlinkStartedAtMs - this.firstBlinkCompletedAtMs;
  }

  private secondStartedBeforeDeadline(): boolean | null {
    const deadline = this.doubleWindowDeadlineMs();
    if (this.secondBlinkStartedAtMs === null || deadline === null) return null;
    return this.secondBlinkStartedAtMs <= deadline;
  }

  private detectorStateName(): DetectorStateName {
    if (this.eyeState === "unavailable") return "unavailable";
    if (this.secondBlinkInProgress) return "second-closed";
    if (this.firstBlinkCompletedAtMs !== null) return "pending-short";
    if (this.closedStartedAtMs !== null) return "closed";
    if (this.lastTimestampMs !== null && this.lastTimestampMs < this.cooldownUntilMs) return "cooldown";
    return "idle";
  }

  private emit(gesture: BlinkGesture, timestampMs: number, closedDurationMs: number): BlinkGestureEvent | null {
    if (timestampMs < this.cooldownUntilMs) return null;
    if (gesture === "long") this.cooldownUntilMs = timestampMs + this.config.cooldownMs;
    this.lastGesture = gesture;
    return { gesture, timestampMs, closedDurationMs };
  }

  private diag(
    kind: BlinkDiagnosticKind,
    timestampMs: number,
    overrides: { classification?: BlinkDiagnosticClassification; closedDurationMs?: number } = {},
  ): BlinkDiagnosticEvent {
    return {
      timestampMs,
      kind,
      classification: overrides.classification ?? "ignored",
      trackingState: this.lastObservedState,
      detectorState: this.detectorStateName(),
      closedDurationMs: overrides.closedDurationMs ?? this.lastClosedDurationMs,
      firstBlinkDurationMs: this.firstBlinkDurationMs,
      interBlinkGapMs: this.interBlinkGapMs(),
      secondBlinkDurationMs: this.secondBlinkDurationMs,
      secondBlinkStartedBeforeDeadline: this.secondStartedBeforeDeadline(),
    };
  }

  private reset(): void {
    this.closedStartedAtMs = null;
    this.firstBlinkCompletedAtMs = null;
    this.firstBlinkDurationMs = null;
    this.secondBlinkStartedAtMs = null;
    this.secondBlinkDurationMs = null;
    this.secondBlinkInProgress = false;
    this.eyeState = "unavailable";
    this.hasSeenOpen = false;
    this.lastClosedDurationMs = null;
    this.candidateState = null;
    this.candidateSinceMs = null;
  }
}
