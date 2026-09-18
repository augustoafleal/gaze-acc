import { DEFAULT_COMMUNICATION_CARDS, type CommunicationCard } from "./concepts";
import { BlinkNavigationController } from "./blink-navigation";
import {
  BlinkGestureDetector,
  DEFAULT_BLINK_CONFIG,
  type BlinkConfig,
  type BlinkDiagnosticEvent,
  type BlinkDetectorSnapshot,
  type BlinkGesture,
} from "../gaze/blink-gesture";
import type { EyeObservation } from "../gaze/eye-types";

export type BlinkTrackingStatus = "starting" | "ok" | "lost";

export type BlinkSessionStage = "waiting" | "active";

export type BlinkCommand =
  | { kind: "next"; target: string }
  | { kind: "previous"; target: string }
  | { kind: "select"; target: string };

export type BlinkSessionView = {
  stage: BlinkSessionStage;
  tracking: BlinkTrackingStatus;
  focused: string;
  lastGesture: BlinkGesture | null;
  diagnosticCount: number;
};

function newSessionId(): string {
  return `blink-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class BlinkAACSessionController {
  readonly config: BlinkConfig;
  readonly cards: readonly CommunicationCard[];

  private detector: BlinkGestureDetector;
  private navigation: BlinkNavigationController;
  private events: BlinkDiagnosticEvent[] = [];
  private pendingCommands: BlinkCommand[] = [];
  private lastGesture: BlinkGesture | null = null;
  private stage: BlinkSessionStage = "waiting";
  private tracking: BlinkTrackingStatus = "starting";
  private active = false;
  private sessionId = "";
  private startedAt = "";
  private finishedAt: string | null = null;

  constructor(config: BlinkConfig = DEFAULT_BLINK_CONFIG, cards: readonly CommunicationCard[] = DEFAULT_COMMUNICATION_CARDS) {
    this.config = config;
    this.cards = cards;
    this.detector = new BlinkGestureDetector(config);
    this.navigation = new BlinkNavigationController(cards);
  }

  get isActive(): boolean {
    return this.active;
  }

  get view(): BlinkSessionView {
    return {
      stage: this.stage,
      tracking: this.tracking,
      focused: this.navigation.currentTarget,
      lastGesture: this.lastGesture,
      diagnosticCount: this.events.length,
    };
  }

  get diagnosticEvents(): readonly BlinkDiagnosticEvent[] {
    return this.events;
  }

  start(): void {
    this.detector = new BlinkGestureDetector(this.config);
    this.navigation = new BlinkNavigationController(this.cards);
    this.events = [];
    this.pendingCommands = [];
    this.lastGesture = null;
    this.stage = "waiting";
    this.tracking = "starting";
    this.active = true;
    this.sessionId = newSessionId();
    this.startedAt = new Date().toISOString();
    this.finishedAt = null;
  }

  navToStart(): void {
    this.navigation = new BlinkNavigationController(this.cards);
  }

  handleEyeObservation(observation: EyeObservation): void {
    if (!this.active) return;

    const valid = observation.state === "open" || observation.state === "closed";
    if (valid) {
      this.tracking = "ok";
      if (this.stage === "waiting") this.stage = "active";
    } else {
      this.tracking = "lost";
    }

    const update = this.detector.update(observation.state, observation.timestampMs);
    if (update.diagnostics.length > 0) this.events.push(...update.diagnostics);

    for (const gesture of update.gestures) {
      this.lastGesture = gesture.gesture;
      const event = this.navigation.handleGesture(gesture.gesture);
      this.pendingCommands.push({ kind: event.command, target: event.target });
    }
  }

  consumeCommands(): BlinkCommand[] {
    const commands = this.pendingCommands;
    this.pendingCommands = [];
    return commands;
  }

  cancelPendingGestureForViewportChange(): void {
    if (!this.active) return;
    this.detector = new BlinkGestureDetector(this.config);
    this.pendingCommands = [];
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.finishedAt = new Date().toISOString();
    this.detector = new BlinkGestureDetector(this.config);
    this.pendingCommands = [];
    this.stage = "waiting";
    this.tracking = "starting";
    this.lastGesture = null;
  }

  debugSnapshot(nowMs: number): BlinkDetectorSnapshot {
    return this.detector.snapshot(nowMs);
  }

  export(): {
    schemaVersion: "blink-2.0";
    sessionId: string;
    startedAt: string;
    finishedAt: string | null;
    provider: string;
    providerVersion: string;
    browser: string;
    viewport: { width: number; height: number };
    dpr: number;
    orientation: "landscape" | "portrait";
    debugEnabled: boolean;
    config: BlinkConfig;
    events: BlinkDiagnosticEvent[];
  } {
    return {
      schemaVersion: "blink-2.0",
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      provider: "MediaPipe Face Landmarker",
      providerVersion: "0.10.18",
      browser: typeof navigator !== "undefined" ? navigator.userAgent : "",
      viewport: { width: typeof window !== "undefined" ? window.innerWidth : 0, height: typeof window !== "undefined" ? window.innerHeight : 0 },
      dpr: typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1,
      orientation: typeof window !== "undefined" && window.innerHeight >= window.innerWidth ? "portrait" : "landscape",
      debugEnabled: false,
      config: { ...this.config },
      events: [...this.events],
    };
  }
}

export function conceptLabel(id: string, cards: readonly CommunicationCard[] = DEFAULT_COMMUNICATION_CARDS): string {
  return cards.find((concept) => concept.id === id)?.label ?? id;
}

export function conceptSpeech(id: string, cards: readonly CommunicationCard[] = DEFAULT_COMMUNICATION_CARDS): string {
  return cards.find((concept) => concept.id === id)?.speech ?? id;
}
