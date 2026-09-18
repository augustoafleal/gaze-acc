import { describe, expect, it } from "vitest";

import { BlinkGestureDetector, DEFAULT_BLINK_CONFIG, type BlinkConfig } from "./blink-gesture";

function config(overrides: Partial<BlinkConfig> = {}): BlinkConfig {
  return { ...DEFAULT_BLINK_CONFIG, doubleBlinkWindowMs: 300, cooldownMs: 200, ...overrides };
}

function detector(overrides: Partial<BlinkConfig> = {}) {
  return new BlinkGestureDetector(config(overrides));
}

function open(detectorInstance: BlinkGestureDetector, timestampMs: number) {
  return detectorInstance.update("open", timestampMs);
}

function closed(detectorInstance: BlinkGestureDetector, timestampMs: number) {
  return detectorInstance.update("closed", timestampMs);
}

function blink(detectorInstance: BlinkGestureDetector, closedAtMs: number, reopenedAtMs: number) {
  closed(detectorInstance, closedAtMs);
  return open(detectorInstance, reopenedAtMs);
}

function kindsOf(updates: Array<ReturnType<BlinkGestureDetector["update"]>>) {
  return updates.flatMap((update) => update.diagnostics.map((diagnostic) => diagnostic.kind));
}

describe("BlinkGestureDetector", () => {
  it("requires an observed open state before a closed state can form a blink", () => {
    const instance = detector();
    closed(instance, 0);
    expect(open(instance, 500).gestures).toEqual([]);
    expect(blink(instance, 600, 800).gestures).toHaveLength(0);
  });

  it("ignores a natural blink below the intentional minimum", () => {
    const instance = detector();
    open(instance, 0);
    const update = blink(instance, 100, 219);
    expect(update.gestures).toEqual([]);
    expect(update.diagnostics.at(-1)?.classification).toBe("ignored");
  });

  it("emits one short gesture only after the double window expires", () => {
    const instance = detector();
    open(instance, 0);
    expect(blink(instance, 100, 220).gestures).toEqual([]);
    const update = open(instance, 521);
    expect(update.gestures).toMatchObject([{ gesture: "short", closedDurationMs: 120 }]);
    expect(update.gestures).toHaveLength(1);
    expect(update.diagnostics.at(-1)?.classification).toBe("short");
  });

  it("emits SHORT immediately and never creates DOUBLE when double blink is disabled", () => {
    const instance = detector({ doubleBlinkEnabled: false, doubleBlinkWindowMs: 300 });
    open(instance, 0);
    expect(blink(instance, 100, 220).gestures).toEqual([{ gesture: "short", timestampMs: 220, closedDurationMs: 120 }]);
    expect(instance.snapshot(220).pendingShort).toBe(false);
    expect(blink(instance, 300, 420).gestures).toEqual([{ gesture: "short", timestampMs: 420, closedDurationMs: 120 }]);
    expect(instance.snapshot(420).lastGesture).toBe("short");
  });

  it("keeps the long threshold unchanged when double blink is disabled", () => {
    const instance = detector({ doubleBlinkEnabled: false });
    open(instance, 0);
    expect(blink(instance, 100, 800).gestures).toMatchObject([{ gesture: "long", closedDurationMs: 700 }]);
  });

  it("emits double without emitting the pending short first", () => {
    const instance = detector();
    open(instance, 0);
    blink(instance, 100, 220);
    const update = blink(instance, 300, 420);
    expect(update.gestures).toMatchObject([{ gesture: "double", closedDurationMs: 120 }]);
    expect(update.gestures).toHaveLength(1);
    expect(update.diagnostics.at(-1)?.classification).toBe("double");
  });

  it("turns an expired first short into SHORT and starts a new pending short", () => {
    const instance = detector();
    open(instance, 0);
    blink(instance, 100, 220);
    const expired = closed(instance, 700);
    expect(expired.gestures).toMatchObject([{ gesture: "short", closedDurationMs: 120 }]);
    const update = open(instance, 820);
    expect(update.gestures).toEqual([]);
    expect(instance.snapshot(820).pendingShort).toBe(true);
  });

  it("emits LONG only after reopening at the threshold boundary", () => {
    const instance = detector();
    open(instance, 0);
    const update = blink(instance, 100, 800);
    expect(update.gestures).toMatchObject([{ gesture: "long", closedDurationMs: 700 }]);
    expect(update.gestures).toHaveLength(1);
  });

  it("cancels a possible blink when tracking becomes unavailable", () => {
    const instance = detector();
    open(instance, 0);
    closed(instance, 100);
    const update = instance.update("unavailable", 300);
    expect(update.gestures).toEqual([]);
    expect(update.diagnostics.at(-1)).toMatchObject({ classification: "cancelled", closedDurationMs: 200 });
    expect(open(instance, 500).gestures).toEqual([]);
  });

  it("does not repeat a long gesture while eyes remain closed or during cooldown", () => {
    const instance = detector();
    open(instance, 0);
    closed(instance, 100);
    expect(closed(instance, 900).gestures).toEqual([]);
    expect(open(instance, 1_000).gestures).toMatchObject([{ gesture: "long" }]);
    expect(blink(instance, 1_100, 1_150).gestures).toEqual([]);
    expect(blink(instance, 1_300, 1_450).gestures).toEqual([]);
    expect(open(instance, 1_751).gestures).toMatchObject([{ gesture: "short" }]);
  });

  it("reports unavailable rather than creating a gesture after tracking loss", () => {
    const instance = detector();
    open(instance, 0);
    instance.update("unavailable", 50);
    closed(instance, 100);
    const update = open(instance, 900);
    expect(update.gestures).toEqual([]);
  });

  it("accepts a normal double and emits exactly one DOUBLE with zero SHORT", () => {
    const instance = detector();
    open(instance, 0);
    blink(instance, 100, 300);
    const update = blink(instance, 550, 750);
    expect(update.gestures).toEqual([{ gesture: "double", timestampMs: 750, closedDurationMs: 200 }]);
    expect(update.gestures).toHaveLength(1);
    expect(kindsOf([update])).toContain("double_confirmed");
  });

  it("keeps a double candidate when the second blink STARTS inside the window but finishes after the deadline", () => {
    const instance = detector({ doubleBlinkWindowMs: 500 });
    open(instance, 0);
    open(instance, 100);
    blink(instance, 800, 1_000);
    // deadline = 1000 + 500 = 1500; the second closure begins at 1490.
    closed(instance, 1_490);
    expect(instance.snapshot(1_495).secondBlinkInProgress).toBe(true);
    const update = open(instance, 1_700);
    expect(update.gestures).toEqual([{ gesture: "double", timestampMs: 1_700, closedDurationMs: 210 }]);
    expect(update.gestures).toHaveLength(1);
    expect(update.diagnostics.at(-1)?.classification).toBe("double");
  });

  it("resolves the first SHORT when the second blink starts after the deadline and treats it as a new sequence", () => {
    const instance = detector({ doubleBlinkWindowMs: 500 });
    open(instance, 0);
    blink(instance, 800, 1_000);
    const started = closed(instance, 1_510);
    expect(started.gestures).toMatchObject([{ gesture: "short", timestampMs: 1_510, closedDurationMs: 200 }]);
    expect(open(instance, 1_720).gestures).toEqual([]);
    expect(instance.snapshot(1_720).pendingShort).toBe(true);
    const later = open(instance, 2_400);
    expect(later.gestures).toMatchObject([{ gesture: "short" }]);
  });

  it("never emits SHORT while the second blink is closed across the deadline", () => {
    const instance = detector({ doubleBlinkWindowMs: 500 });
    open(instance, 0);
    blink(instance, 800, 1_000);
    closed(instance, 1_450);
    // deadline 1500 passes while the eyes stay closed.
    expect(closed(instance, 1_550).gestures).toEqual([]);
    const update = open(instance, 1_700);
    expect(update.gestures).toEqual([{ gesture: "double", timestampMs: 1_700, closedDurationMs: 250 }]);
    expect(update.gestures).toHaveLength(1);
  });

  it("does not generate NEXT for a double gesture", () => {
    const instance = detector({ doubleBlinkWindowMs: 500 });
    open(instance, 0);
    const first = blink(instance, 800, 1_000);
    const second = closed(instance, 1_490);
    const third = open(instance, 1_700);
    expect(third.gestures).toEqual([{ gesture: "double", timestampMs: 1_700, closedDurationMs: 210 }]);
    const diagnostics = [first, second, third].flatMap((result) => result.diagnostics);
    expect(diagnostics.map((diagnostic) => diagnostic.kind)).not.toContain("short_committed");
    expect(diagnostics.some((diagnostic) => diagnostic.kind === "double_confirmed")).toBe(true);
  });

  it("cancels conservatively when the second blink is too short", () => {
    const instance = detector({ doubleBlinkWindowMs: 500 });
    open(instance, 0);
    blink(instance, 800, 1_000);
    closed(instance, 1_450);
    const update = open(instance, 1_500);
    expect(update.gestures).toEqual([]);
    expect(update.diagnostics.at(-1)?.classification).toBe("cancelled");
    const snapshot = instance.snapshot(1_500);
    expect(snapshot.pendingShort).toBe(false);
    expect(snapshot.secondBlinkInProgress).toBe(false);
  });

  it("gives LONG semantic precedence when the second blink becomes long", () => {
    const instance = detector({ doubleBlinkWindowMs: 500 });
    open(instance, 0);
    blink(instance, 800, 1_000);
    closed(instance, 1_450);
    const update = open(instance, 2_200);
    expect(update.gestures).toEqual([{ gesture: "long", timestampMs: 2_200, closedDurationMs: 750 }]);
    expect(update.gestures).toHaveLength(1);
    expect(update.diagnostics.at(-1)?.classification).toBe("long");
  });

  it("cancels a pending short when tracking is lost before a second blink", () => {
    const instance = detector();
    open(instance, 0);
    blink(instance, 100, 220);
    const update = instance.update("unavailable", 400);
    expect(update.gestures).toEqual([]);
    expect(update.diagnostics.at(-1)?.classification).toBe("cancelled");
    expect(instance.snapshot(400).pendingShort).toBe(false);
    open(instance, 450);
    blink(instance, 500, 700);
    expect(open(instance, 1_100).gestures).toMatchObject([{ gesture: "short" }]);
  });

  it("cancels a double attempt when tracking is lost during the second blink and emits nothing", () => {
    const instance = detector({ doubleBlinkWindowMs: 500 });
    open(instance, 0);
    blink(instance, 800, 1_000);
    closed(instance, 1_450);
    const update = instance.update("unavailable", 1_600);
    expect(update.gestures).toEqual([]);
    expect(update.diagnostics.some((diagnostic) => diagnostic.kind === "gesture_cancelled")).toBe(true);
    const snapshot = instance.snapshot(1_600);
    expect(snapshot.pendingShort).toBe(false);
    expect(snapshot.secondBlinkInProgress).toBe(false);
  });

  it("filters rapid open/closed flicker when stability is enabled and still accepts real blinks", () => {
    const instance = detector({ stateStabilityMs: 50 });
    open(instance, 0);
    open(instance, 100);
    for (let index = 1; index <= 3; index += 1) {
      closed(instance, index * 200);
      open(instance, index * 200 + 40);
    }
    const before = instance.snapshot(900);
    expect(before.pendingShort).toBe(false);
    expect(before.secondBlinkInProgress).toBe(false);
    expect(before.eyeState).toBe("open");

    closed(instance, 1_000);
    closed(instance, 1_100);
    open(instance, 1_250);
    open(instance, 1_350);
    const after = instance.snapshot(1_350);
    expect(after.eyeState).toBe("open");
    expect(after.pendingShort).toBe(true);
  });

  it("does not delay long-closure duration measurement under stability", () => {
    const instance = detector({ stateStabilityMs: 50 });
    open(instance, 0);
    open(instance, 100);
    closed(instance, 200);
    closed(instance, 300);
    open(instance, 900);
    const update = open(instance, 1_000);
    expect(update.gestures).toMatchObject([{ gesture: "long", closedDurationMs: 700 }]);
  });

  it("reports a single short exactly once after its window expires", () => {
    const instance = detector();
    open(instance, 0);
    blink(instance, 100, 220);
    expect(open(instance, 400).gestures).toEqual([]);
    expect(open(instance, 800).gestures).toMatchObject([{ gesture: "short" }]);
    expect(open(instance, 900).gestures).toEqual([]);
  });
});
