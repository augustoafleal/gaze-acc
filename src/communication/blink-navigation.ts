import { DEFAULT_COMMUNICATION_CARDS, type CommunicationCard } from "./concepts";
import type { BlinkGesture } from "../gaze/blink-gesture";

export type NavigationCommand = "next" | "previous" | "select";

export type NavigationEvent = {
  gesture: BlinkGesture;
  command: NavigationCommand;
  target: string;
};

export class BlinkNavigationController {
  private index = 0;
  private readonly cards: readonly CommunicationCard[];

  constructor(cards: readonly CommunicationCard[] = DEFAULT_COMMUNICATION_CARDS) {
    if (cards.length === 0) throw new Error("A navegação exige ao menos um card.");
    this.cards = cards;
  }

  get currentTarget(): string {
    return this.cards[this.index].id;
  }

  handleGesture(gesture: BlinkGesture): NavigationEvent {
    let command: NavigationCommand;
    if (gesture === "short") {
      command = "next";
      this.index = (this.index + 1) % this.cards.length;
    } else if (gesture === "double") {
      command = "previous";
      this.index = (this.index - 1 + this.cards.length) % this.cards.length;
    } else {
      command = "select";
    }
    return { gesture, command, target: this.currentTarget };
  }
}
