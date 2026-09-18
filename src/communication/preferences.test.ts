/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";

import { defaultPreferences, loadPreferences, PREFERENCES_STORAGE_KEY, savePreferences, validCards } from "./preferences";

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      clear: () => values.clear(),
    },
  });
});

describe("local preferences", () => {
  it("uses defaults for missing or corrupt storage", () => {
    expect(loadPreferences()).toEqual(defaultPreferences());
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, "not json");
    expect(loadPreferences()).toEqual(defaultPreferences());
  });

  it("restores valid timing, toggle and ordered custom cards", () => {
    const preferences = defaultPreferences();
    preferences.timing.minIntentionalBlinkMs = 150;
    preferences.doubleBlinkEnabled = false;
    preferences.cards = [
      { id: "agua", label: "ÁGUA", speech: "Quero água" },
      { id: "ajuda", label: "AJUDA", speech: "Preciso de ajuda" },
    ];
    expect(savePreferences(preferences)).toBe(true);
    expect(loadPreferences()).toEqual(preferences);
  });

  it("merges missing fields and rejects invalid cards safely", () => {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      timing: { minIntentionalBlinkMs: 150, longBlinkThresholdMs: 700, doubleBlinkWindowMs: 450 },
      cards: [{ id: "x", label: "", speech: "fala" }],
    }));
    const loaded = loadPreferences();
    expect(loaded.timing.minIntentionalBlinkMs).toBe(150);
    expect(loaded.doubleBlinkEnabled).toBe(true);
    expect(loaded.cards).toEqual(defaultPreferences().cards);
  });

  it("accepts up to ten cards and rejects duplicate IDs or eleven cards", () => {
    const preferences = defaultPreferences();
    preferences.cards = [{ id: "same", label: "A", speech: "A" }, { id: "same", label: "B", speech: "B" }];
    expect(savePreferences(preferences)).toBe(false);
    preferences.cards = Array.from({ length: 8 }, (_, index) => ({ id: `card-${index}`, label: `C${index}`, speech: `C${index}` }));
    expect(validCards(preferences.cards)).toBe(true);
    preferences.cards = Array.from({ length: 9 }, (_, index) => ({ id: `card-${index}`, label: `C${index}`, speech: `C${index}` }));
    expect(validCards(preferences.cards)).toBe(true);
    preferences.cards = Array.from({ length: 10 }, (_, index) => ({ id: `card-${index}`, label: `C${index}`, speech: `C${index}` }));
    expect(savePreferences(preferences)).toBe(true);
    preferences.cards = Array.from({ length: 11 }, (_, index) => ({ id: `card-${index}`, label: `C${index}`, speech: `C${index}` }));
    expect(savePreferences(preferences)).toBe(false);
  });

  it("falls back safely when storage access throws", () => {
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
    expect(loadPreferences()).toEqual(defaultPreferences());
    expect(savePreferences(defaultPreferences())).toBe(false);
  });
});
