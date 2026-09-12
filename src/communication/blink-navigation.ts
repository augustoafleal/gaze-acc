import { CONCEPTS, type ConceptId } from "./concepts";
import type { BlinkGesture } from "../gaze/blink-gesture";

export type NavigationCommand = "next" | "previous" | "select";

export type NavigationEvent = {
  gesture: BlinkGesture;
  command: NavigationCommand;
  target: ConceptId;
};

export class BlinkNavigationController {
  private index = 0;

  get currentTarget(): ConceptId {
    return CONCEPTS[this.index].id;
  }

  handleGesture(gesture: BlinkGesture): NavigationEvent {
    let command: NavigationCommand;
    if (gesture === "short") {
      command = "next";
      this.index = (this.index + 1) % CONCEPTS.length;
    } else if (gesture === "double") {
      command = "previous";
      this.index = (this.index - 1 + CONCEPTS.length) % CONCEPTS.length;
    } else {
      command = "select";
    }
    return { gesture, command, target: this.currentTarget };
  }
}
