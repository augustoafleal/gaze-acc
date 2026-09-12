import { describe, expect, it } from "vitest";

import { BlinkNavigationController } from "./blink-navigation";

describe("BlinkNavigationController", () => {
  it("starts at SIM and navigates circularly", () => {
    const controller = new BlinkNavigationController();
    expect(controller.currentTarget).toBe("sim");
    expect(controller.handleGesture("short")).toMatchObject({ command: "next", target: "nao" });
    expect(controller.handleGesture("short")).toMatchObject({ command: "next", target: "virar" });
    expect(controller.handleGesture("double")).toMatchObject({ command: "previous", target: "nao" });
    expect(controller.handleGesture("double")).toMatchObject({ command: "previous", target: "sim" });
    expect(controller.handleGesture("double")).toMatchObject({ command: "previous", target: "dor" });
    expect(controller.handleGesture("short")).toMatchObject({ command: "next", target: "sim" });
  });

  it("selects the current target without moving it", () => {
    const controller = new BlinkNavigationController();
    controller.handleGesture("short");
    expect(controller.handleGesture("long")).toMatchObject({ command: "select", target: "nao" });
    expect(controller.currentTarget).toBe("nao");
  });

  it("navigates SIM -> next -> previous -> select for short/double/long", () => {
    const controller = new BlinkNavigationController();
    expect(controller.currentTarget).toBe("sim");
    expect(controller.handleGesture("short")).toMatchObject({ gesture: "short", command: "next", target: "nao" });
    expect(controller.handleGesture("double")).toMatchObject({ gesture: "double", command: "previous", target: "sim" });
    expect(controller.handleGesture("long")).toMatchObject({ gesture: "long", command: "select", target: "sim" });
  });

  it("emits a single command per gesture", () => {
    const controller = new BlinkNavigationController();
    const events = ["short", "double", "long"].map((gesture) => controller.handleGesture(gesture as "short" | "double" | "long"));
    expect(events.map((event) => event.command)).toEqual(["next", "previous", "select"]);
  });
});
