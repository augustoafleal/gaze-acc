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

  it("navigates any valid active card collection with wrap-around", () => {
    const controller = new BlinkNavigationController([
      { id: "agua", label: "ÁGUA", speech: "Água" },
      { id: "ajuda", label: "AJUDA", speech: "Preciso de ajuda" },
    ]);
    expect(controller.currentTarget).toBe("agua");
    expect(controller.handleGesture("short").target).toBe("ajuda");
    expect(controller.handleGesture("short").target).toBe("agua");
    expect(controller.handleGesture("double").target).toBe("ajuda");
  });

  it.each([1, 2, 4, 8, 9, 10])("supports %i cards", (count) => {
    const cards = Array.from({ length: count }, (_, index) => ({ id: `card-${index}`, label: `CARD ${index}`, speech: `Card ${index}` }));
    const controller = new BlinkNavigationController(cards);
    for (let index = 0; index < count; index += 1) controller.handleGesture("short");
    expect(controller.currentTarget).toBe("card-0");
    expect(controller.handleGesture("double").target).toBe(`card-${count - 1}`);
  });

  it("wraps and selects correctly with ten cards", () => {
    const cards = Array.from({ length: 10 }, (_, index) => ({ id: `card-${index}`, label: `CARD ${index}`, speech: `Card ${index}` }));
    const controller = new BlinkNavigationController(cards);
    for (let index = 0; index < 9; index += 1) controller.handleGesture("short");
    expect(controller.currentTarget).toBe("card-9");
    expect(controller.handleGesture("short").target).toBe("card-0");
    expect(controller.handleGesture("double").target).toBe("card-9");
    expect(controller.handleGesture("long")).toMatchObject({ command: "select", target: "card-9" });
  });
});
