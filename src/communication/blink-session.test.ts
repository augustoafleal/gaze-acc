import { describe, expect, it } from "vitest";

import { BlinkAACSessionController, conceptLabel, conceptSpeech } from "./blink-session";

const obs = (state: "open" | "closed" | "unavailable", timestampMs: number) => ({ state, timestampMs });

function runBlink(sequence: Array<[number, "open" | "closed" | "unavailable"]>): ReturnType<BlinkAACSessionController["consumeCommands"]> {
  const controller = new BlinkAACSessionController();
  controller.start();
  controller.handleEyeObservation(obs("open", 10));
  for (const [at, state] of sequence) controller.handleEyeObservation(obs(state, at));
  const commands = controller.consumeCommands();
  return commands;
}

describe("BlinkAACSessionController", () => {
  it("waits for the first valid tracking before activating", () => {
    const controller = new BlinkAACSessionController();
    controller.start();
    expect(controller.view.stage).toBe("waiting");
    expect(controller.view.tracking).toBe("starting");
    controller.handleEyeObservation(obs("unavailable", 100));
    expect(controller.view.stage).toBe("waiting");
    expect(controller.view.tracking).toBe("lost");
    controller.handleEyeObservation(obs("open", 200));
    expect(controller.view.stage).toBe("active");
    expect(controller.view.tracking).toBe("ok");
    expect(controller.view.focused).toBe("sim");
  });

  it("maps a short to a next command", () => {
    const commands = runBlink([[11, "closed"], [161, "open"], [700, "open"]]);
    expect(commands).toEqual([{ kind: "next", target: "nao" }]);
  });

  it("maps a double to a single previous command without advancing first", () => {
    const commands = runBlink([[11, "closed"], [161, "open"], [610, "closed"], [850, "open"]]);
    expect(commands).toEqual([{ kind: "previous", target: "dor" }]);
  });

  it("maps a long to a single select command and keeps the focus", () => {
    const commands = runBlink([[11, "closed"], [761, "open"]]);
    expect(commands).toEqual([{ kind: "select", target: "sim" }]);
  });

  it("does not emit a second long during cooldown", () => {
    const controller = new BlinkAACSessionController();
    controller.start();
    controller.handleEyeObservation(obs("open", 0));
    controller.handleEyeObservation(obs("closed", 11));
    controller.handleEyeObservation(obs("open", 761));
    controller.consumeCommands();
    controller.handleEyeObservation(obs("closed", 850));
    controller.handleEyeObservation(obs("open", 1550));
    expect(controller.consumeCommands()).toEqual([]);
  });

  it("cancels an in-progress gesture on tracking loss without emitting a command", () => {
    const controller = new BlinkAACSessionController();
    controller.start();
    controller.handleEyeObservation(obs("open", 0));
    controller.handleEyeObservation(obs("closed", 11));
    controller.handleEyeObservation(obs("unavailable", 500));
    expect(controller.consumeCommands()).toEqual([]);
    expect(controller.view.tracking).toBe("lost");
    expect(controller.view.focused).toBe("sim");
  });

  it("preserves focus across a viewport change and clears a pending short", () => {
    const controller = new BlinkAACSessionController();
    controller.start();
    controller.handleEyeObservation(obs("open", 0));
    controller.handleEyeObservation(obs("closed", 11));
    controller.cancelPendingGestureForViewportChange();
    expect(controller.view.stage).toBe("active");
    controller.handleEyeObservation(obs("open", 200));
    expect(controller.consumeCommands()).toEqual([]);
    controller.handleEyeObservation(obs("open", 400));
    expect(controller.view.stage).toBe("active");
    expect(controller.view.focused).toBe("sim");
    controller.handleEyeObservation(obs("closed", 600));
    controller.handleEyeObservation(obs("open", 750));
    controller.handleEyeObservation(obs("open", 1300));
    expect(controller.consumeCommands()).toEqual([{ kind: "next", target: "nao" }]);
  });

  it("stop resets the session and keeps export metadata", () => {
    const controller = new BlinkAACSessionController();
    controller.start();
    controller.handleEyeObservation(obs("open", 0));
    controller.stop();
    expect(controller.isActive).toBe(false);
    expect(controller.view.stage).toBe("waiting");
    const data = controller.export();
    expect(data.schemaVersion).toBe("blink-2.0");
    expect(data.finishedAt).toBeTruthy();
    expect(data.config.minIntentionalBlinkMs).toBe(120);
    expect(data.config.longBlinkThresholdMs).toBe(700);
    expect(data.config.doubleBlinkWindowMs).toBe(450);
    expect(data.config.cooldownMs).toBe(800);
    expect(data.config.maxClosedDurationMs).toBe(5000);
    expect(data.config.stateStabilityMs).toBe(0);
  });

  it("records diagnostic events for a double gesture", () => {
    const controller = new BlinkAACSessionController();
    controller.start();
    controller.handleEyeObservation(obs("open", 10));
    controller.handleEyeObservation(obs("closed", 11));
    controller.handleEyeObservation(obs("open", 161));
    controller.handleEyeObservation(obs("closed", 610));
    controller.handleEyeObservation(obs("open", 850));
    controller.consumeCommands();
    const kinds = controller.diagnosticEvents.map((event) => event.kind);
    expect(kinds).toContain("second_blink_started");
    expect(kinds).toContain("double_confirmed");
    expect(kinds).not.toContain("short_committed");
  });

  it("exposes concept labels and speech text", () => {
    expect(conceptLabel("virar")).toBe("VIRAR");
    expect(conceptSpeech("dor")).toBe("Dor");
  });
});
