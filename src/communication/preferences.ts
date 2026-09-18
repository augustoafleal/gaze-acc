import { defaultCommunicationCards, type CommunicationCard } from "./concepts";
import { DEFAULT_BLINK_CONFIG, type BlinkConfig } from "../gaze/blink-gesture";

export const PREFERENCES_STORAGE_KEY = "gaze-aac:preferences:v1";
export const MAX_COMMUNICATION_CARDS = 10;

export type BlinkTimingPreferences = Pick<BlinkConfig, "minIntentionalBlinkMs" | "longBlinkThresholdMs" | "doubleBlinkWindowMs">;

export type Preferences = {
  schemaVersion: 1;
  timing: BlinkTimingPreferences;
  doubleBlinkEnabled: boolean;
  cards: CommunicationCard[];
};

export function defaultPreferences(config: BlinkConfig = DEFAULT_BLINK_CONFIG): Preferences {
  return {
    schemaVersion: 1,
    timing: {
      minIntentionalBlinkMs: config.minIntentionalBlinkMs,
      longBlinkThresholdMs: config.longBlinkThresholdMs,
      doubleBlinkWindowMs: config.doubleBlinkWindowMs,
    },
    doubleBlinkEnabled: config.doubleBlinkEnabled,
    cards: defaultCommunicationCards(),
  };
}

export function validTiming(timing: BlinkTimingPreferences, maxClosedDurationMs: number = DEFAULT_BLINK_CONFIG.maxClosedDurationMs): boolean {
  return Number.isFinite(timing.minIntentionalBlinkMs)
    && Number.isFinite(timing.longBlinkThresholdMs)
    && Number.isFinite(timing.doubleBlinkWindowMs)
    && timing.minIntentionalBlinkMs >= 50 && timing.minIntentionalBlinkMs <= 2_000
    && timing.longBlinkThresholdMs >= 100 && timing.longBlinkThresholdMs > timing.minIntentionalBlinkMs
    && timing.longBlinkThresholdMs <= maxClosedDurationMs
    && timing.doubleBlinkWindowMs >= 100 && timing.doubleBlinkWindowMs <= 3_000;
}

export function validCards(cards: readonly CommunicationCard[]): boolean {
  return cards.length >= 1 && cards.length <= MAX_COMMUNICATION_CARDS
    && cards.every((card) => typeof card.id === "string" && card.id.trim() && typeof card.label === "string" && card.label.trim() && typeof card.speech === "string" && card.speech.trim())
    && new Set(cards.map((card) => card.id)).size === cards.length;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseCards(value: unknown): CommunicationCard[] | null {
  if (!Array.isArray(value)) return null;
  const cards = value.map((item) => {
    const card = asRecord(item);
    return card && typeof card.id === "string" && typeof card.label === "string" && typeof card.speech === "string"
      ? { id: card.id, label: card.label, speech: card.speech }
      : null;
  });
  return cards.every((card): card is CommunicationCard => card !== null) && validCards(cards) ? cards : null;
}

export function loadPreferences(config: BlinkConfig = DEFAULT_BLINK_CONFIG): Preferences {
  const fallback = defaultPreferences(config);
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return fallback;
    const saved = asRecord(JSON.parse(raw));
    if (!saved) return fallback;
    const timingValue = asRecord(saved.timing);
    const timing: BlinkTimingPreferences = timingValue && typeof timingValue.minIntentionalBlinkMs === "number" && typeof timingValue.longBlinkThresholdMs === "number" && typeof timingValue.doubleBlinkWindowMs === "number"
      ? { minIntentionalBlinkMs: timingValue.minIntentionalBlinkMs, longBlinkThresholdMs: timingValue.longBlinkThresholdMs, doubleBlinkWindowMs: timingValue.doubleBlinkWindowMs }
      : fallback.timing;
    return {
      schemaVersion: 1,
      timing: validTiming(timing, config.maxClosedDurationMs) ? timing : fallback.timing,
      doubleBlinkEnabled: typeof saved.doubleBlinkEnabled === "boolean" ? saved.doubleBlinkEnabled : fallback.doubleBlinkEnabled,
      cards: parseCards(saved.cards) ?? fallback.cards,
    };
  } catch {
    return fallback;
  }
}

export function savePreferences(preferences: Preferences, maxClosedDurationMs: number = DEFAULT_BLINK_CONFIG.maxClosedDurationMs): boolean {
  if (!validTiming(preferences.timing, maxClosedDurationMs) || !validCards(preferences.cards)) return false;
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function newCardId(existing: readonly CommunicationCard[]): string {
  let id = "";
  do {
    id = `card-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;
  } while (existing.some((card) => card.id === id));
  return id;
}
