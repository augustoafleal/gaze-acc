/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { BlinkAACApp } from "./blink-aac";
import type { EyeObservation, EyeProviderStatusListener, EyeStateProvider } from "../gaze/eye-types";
import { PREFERENCES_STORAGE_KEY } from "../communication/preferences";

class FakeProvider implements EyeStateProvider {
  readonly name = "fake-blink";
  listener: ((observation: EyeObservation) => void) | null = null;
  stopped = false;
  initializeCalls = 0;

  async initialize(_video?: HTMLVideoElement, _onStatus?: EyeProviderStatusListener): Promise<void> {
    void _video;
    void _onStatus;
    this.initializeCalls += 1;
  }

  start(listener: (observation: EyeObservation) => void): void {
    this.listener = listener;
  }

  stop(): void {
    this.stopped = true;
    this.listener = null;
  }

  emit(state: EyeObservation["state"], timestampMs: number): void {
    this.listener?.({ state, timestampMs });
  }
}

class ModelFailureProvider extends FakeProvider {
  override async initialize(_video?: HTMLVideoElement, onStatus?: EyeProviderStatusListener): Promise<void> {
    this.initializeCalls += 1;
    onStatus?.({ step: "compatibility", state: "ready", message: "Navegador compatível" });
    onStatus?.({ step: "permission", state: "ready", message: "Permissão concedida" });
    onStatus?.({ step: "camera", state: "ready", message: "Câmera transmitindo (640×480)" });
    onStatus?.({ step: "model", state: "error", message: "Falha de rede ao baixar o modelo" });
    throw new Error("A câmera abriu, mas o modelo de detecção não pôde ser baixado.");
  }
}

function blink(provider: FakeProvider, sequence: Array<[EyeObservation["state"], number]>): void {
  act(() => {
    for (const [state, timestampMs] of sequence) provider.emit(state, timestampMs);
  });
}

const shortBlink: Array<[EyeObservation["state"], number]> = [
  ["open", 10_000],
  ["closed", 10_300],
  ["open", 10_500],
  ["open", 11_000],
];

const doubleBlink: Array<[EyeObservation["state"], number]> = [
  ["open", 12_000],
  ["closed", 12_300],
  ["open", 12_500],
  ["closed", 12_700],
  ["open", 12_900],
];

const longBlink: Array<[EyeObservation["state"], number]> = [
  ["open", 14_000],
  ["closed", 14_400],
  ["open", 15_300],
];

function focusedButton(label: string): HTMLElement {
  const button = screen.getByRole("button", { name: label });
  expect(button.classList.contains("is-blink-focused")).toBe(true);
  return button;
}

function startBoard(provider: FakeProvider): void {
  blink(provider, [["open", 3_000]]);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
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

function savedPreferences(): { timing: { minIntentionalBlinkMs: number; longBlinkThresholdMs: number; doubleBlinkWindowMs: number }; doubleBlinkEnabled: boolean; cards: Array<{ id: string; label: string; speech: string }> } {
  return JSON.parse(window.localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? "null");
}

function seedPreferences(cards: Array<{ id: string; label: string; speech: string }>): void {
  window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
    schemaVersion: 1,
    timing: { minIntentionalBlinkMs: 120, longBlinkThresholdMs: 700, doubleBlinkWindowMs: 450 },
    doubleBlinkEnabled: true,
    cards,
  }));
}

describe("BlinkAACApp start screen", () => {
  it("shows a blink-only interface on first render", () => {
    render(<BlinkAACApp speakText={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Comunicação por piscadas" })).toBeTruthy();
    expect(screen.queryByText("Calibrar")).toBeNull();
    expect(screen.queryByText(/experimento/i)).toBeNull();
    expect(screen.queryByText(/gaze/i)).toBeNull();
    expect(screen.getByText("piscada curta")).toBeTruthy();
    expect(screen.getByText("piscada longa")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Iniciar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Treinar piscadas" })).toBeNull();
    expect((screen.getByRole("spinbutton", { name: "Piscada mínima (ms)" }) as HTMLInputElement).value).toBe("120");
    expect((screen.getByRole("spinbutton", { name: "Piscada longa (ms)" }) as HTMLInputElement).value).toBe("700");
    expect((screen.getByRole("spinbutton", { name: "Janela da piscada dupla (ms)" }) as HTMLInputElement).value).toBe("450");
    expect(screen.getByRole("checkbox", { name: /usar duas piscadas para voltar/i })).toBeTruthy();
  });

  it("validates the editable blink timings before starting", () => {
    render(<BlinkAACApp speakText={vi.fn()} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Piscada longa (ms)" }), { target: { value: "100" } });
    expect(screen.getByText("A piscada longa deve ser maior que a piscada mínima.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Iniciar" }).hasAttribute("disabled")).toBe(true);
  });

  it("allows a timing field to be emptied while editing and blocks only session start", () => {
    render(<BlinkAACApp speakText={vi.fn()} />);
    const minimum = screen.getByRole("spinbutton", { name: "Piscada mínima (ms)" }) as HTMLInputElement;
    fireEvent.change(minimum, { target: { value: "" } });

    expect(minimum.value).toBe("");
    expect(screen.getByText("Informe a duração mínima da piscada.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Iniciar" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(minimum, { target: { value: "150" } });
    expect(minimum.value).toBe("150");
    expect(screen.queryByText("Informe a duração mínima da piscada.")).toBeNull();
    expect(screen.getByRole("button", { name: "Iniciar" }).hasAttribute("disabled")).toBe(false);
  });

  it("autosaves valid timing without replacing the last valid preference during an invalid edit", async () => {
    render(<BlinkAACApp speakText={vi.fn()} />);
    const windowInput = screen.getByRole("spinbutton", { name: "Janela da piscada dupla (ms)" });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Piscada mínima (ms)" }), { target: { value: "121" } });
    await waitFor(() => expect(savedPreferences().timing.doubleBlinkWindowMs).toBe(450));
    fireEvent.change(windowInput, { target: { value: "" } });
    expect(screen.getByText("Informe a janela entre duas piscadas.")).toBeTruthy();
    expect(savedPreferences().timing.doubleBlinkWindowMs).toBe(450);

    fireEvent.change(windowInput, { target: { value: "600" } });
    await waitFor(() => expect(savedPreferences().timing.doubleBlinkWindowMs).toBe(600));
  });

  it("preserves and disables the double-blink window when double blink is off, then persists the toggle immediately", () => {
    render(<BlinkAACApp speakText={vi.fn()} />);
    const windowInput = screen.getByRole("spinbutton", { name: "Janela da piscada dupla (ms)" }) as HTMLInputElement;
    fireEvent.change(windowInput, { target: { value: "600" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /usar duas piscadas para voltar/i }));
    expect(windowInput.value).toBe("600");
    expect(windowInput.disabled).toBe(true);
    expect(savedPreferences().doubleBlinkEnabled).toBe(false);
    expect(savedPreferences().timing.doubleBlinkWindowMs).toBe(600);
    fireEvent.click(screen.getByRole("checkbox", { name: /usar duas piscadas para voltar/i }));
    expect(windowInput.disabled).toBe(false);
    expect(windowInput.value).toBe("600");
  });

  it("hides double-blink instructions and exposes a card editor", () => {
    render(<BlinkAACApp speakText={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /usar duas piscadas para voltar/i }));
    expect(screen.queryByText("duas piscadas curtas")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /configurar cards/i }));
    expect(screen.getByRole("heading", { name: "Cards de comunicação" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar card" }));
    expect(screen.getByRole("textbox", { name: "Texto do card 5" })).toBeTruthy();
  });

  it("keeps at least one card and limits the editor to ten cards", () => {
    render(<BlinkAACApp speakText={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /configurar cards/i }));
    const add = screen.getByRole("button", { name: "Adicionar card" });
    for (let index = 0; index < 6; index += 1) fireEvent.click(add);
    expect(screen.getByRole("textbox", { name: "Texto do card 10" })).toBeTruthy();
    expect(add.hasAttribute("disabled")).toBe(true);
    const removeButtons = screen.getAllByRole("button", { name: "Remover" });
    expect(removeButtons[0].hasAttribute("disabled")).toBe(false);
  });

  it("does not allow the last communication card to be removed", () => {
    render(<BlinkAACApp speakText={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /configurar cards/i }));
    for (let index = 0; index < 3; index += 1) fireEvent.click(screen.getAllByRole("button", { name: "Remover" })[0]);
    expect(screen.getAllByRole("button", { name: "Remover" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Remover" }).hasAttribute("disabled")).toBe(true);
  });

  it("autosaves card text, order, additions, removals and restoration", async () => {
    render(<BlinkAACApp speakText={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /configurar cards/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "Texto do card 1" }), { target: { value: "OI" } });
    await waitFor(() => expect(savedPreferences().cards[0]?.label).toBe("OI"));
    fireEvent.click(screen.getAllByRole("button", { name: "Descer" })[0]);
    expect(savedPreferences().cards[1]?.label).toBe("OI");
    fireEvent.click(screen.getByRole("button", { name: "Adicionar card" }));
    expect(savedPreferences().cards).toHaveLength(5);
    fireEvent.click(screen.getAllByRole("button", { name: "Remover" })[4]);
    expect(savedPreferences().cards).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Restaurar cards padrão" }));
    expect(savedPreferences().cards[0]?.label).toBe("SIM");
  });

  it("does not let a pending card-text autosave restore a removed card", () => {
    vi.useFakeTimers();
    seedPreferences([
      { id: "a", label: "A", speech: "A" },
      { id: "b", label: "B", speech: "B" },
    ]);
    render(<BlinkAACApp speakText={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /configurar cards/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "Texto falado do card 1" }), { target: { value: "A editado" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Remover" })[1]);
    expect(savedPreferences().cards).toEqual([{ id: "a", label: "A", speech: "A editado" }]);
    act(() => vi.advanceTimersByTime(401));
    expect(savedPreferences().cards).toEqual([{ id: "a", label: "A", speech: "A editado" }]);
  });

  it("does not let a pending card-text autosave remove an added card", () => {
    vi.useFakeTimers();
    seedPreferences([{ id: "a", label: "A", speech: "A" }]);
    render(<BlinkAACApp speakText={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /configurar cards/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "Texto do card 1" }), { target: { value: "A editado" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar card" }));
    expect(savedPreferences().cards).toHaveLength(2);
    act(() => vi.advanceTimersByTime(401));
    expect(savedPreferences().cards).toHaveLength(2);
    expect(savedPreferences().cards[0]?.label).toBe("A editado");
  });

  it("does not let a pending edit restore a previous card order", () => {
    vi.useFakeTimers();
    seedPreferences([
      { id: "a", label: "A", speech: "A" },
      { id: "b", label: "B", speech: "B" },
      { id: "c", label: "C", speech: "C" },
    ]);
    render(<BlinkAACApp speakText={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /configurar cards/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "Texto falado do card 1" }), { target: { value: "A editado" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Descer" })[1]);
    expect(savedPreferences().cards.map((card) => card.id)).toEqual(["a", "c", "b"]);
    act(() => vi.advanceTimersByTime(401));
    expect(savedPreferences().cards.map((card) => card.id)).toEqual(["a", "c", "b"]);
    expect(savedPreferences().cards[0]?.speech).toBe("A editado");
  });

  it("does not let a pending timing autosave restore the previous toggle", () => {
    vi.useFakeTimers();
    render(<BlinkAACApp speakText={vi.fn()} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Piscada mínima (ms)" }), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /usar duas piscadas para voltar/i }));
    expect(savedPreferences().timing.minIntentionalBlinkMs).toBe(150);
    expect(savedPreferences().doubleBlinkEnabled).toBe(false);
    act(() => vi.advanceTimersByTime(401));
    expect(savedPreferences().timing.minIntentionalBlinkMs).toBe(150);
    expect(savedPreferences().doubleBlinkEnabled).toBe(false);
  });

  it("includes a prior discrete toggle in a later debounced timing save", () => {
    vi.useFakeTimers();
    render(<BlinkAACApp speakText={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /usar duas piscadas para voltar/i }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Piscada mínima (ms)" }), { target: { value: "150" } });
    act(() => vi.advanceTimersByTime(401));
    expect(savedPreferences().timing.minIntentionalBlinkMs).toBe(150);
    expect(savedPreferences().doubleBlinkEnabled).toBe(false);
  });

  it("does not let a pending double-window autosave restore the previous toggle", () => {
    vi.useFakeTimers();
    render(<BlinkAACApp speakText={vi.fn()} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Janela da piscada dupla (ms)" }), { target: { value: "600" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /usar duas piscadas para voltar/i }));
    expect(savedPreferences().timing.doubleBlinkWindowMs).toBe(600);
    expect(savedPreferences().doubleBlinkEnabled).toBe(false);
    act(() => vi.advanceTimersByTime(401));
    expect(savedPreferences().timing.doubleBlinkWindowMs).toBe(600);
    expect(savedPreferences().doubleBlinkEnabled).toBe(false);
  });

  it("preserves a 600 ms double window through OFF, reload and ON", () => {
    vi.useFakeTimers();
    render(<BlinkAACApp speakText={vi.fn()} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Janela da piscada dupla (ms)" }), { target: { value: "600" } });
    act(() => vi.advanceTimersByTime(401));
    fireEvent.click(screen.getByRole("checkbox", { name: /usar duas piscadas para voltar/i }));
    expect(savedPreferences().timing.doubleBlinkWindowMs).toBe(600);
    expect(savedPreferences().doubleBlinkEnabled).toBe(false);

    cleanup();
    render(<BlinkAACApp speakText={vi.fn()} />);
    const windowInput = screen.getByRole("spinbutton", { name: "Janela da piscada dupla (ms)" }) as HTMLInputElement;
    expect(windowInput.value).toBe("600");
    expect(windowInput.disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: /usar duas piscadas para voltar/i }) as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole("checkbox", { name: /usar duas piscadas para voltar/i }));
    expect(windowInput.value).toBe("600");
    expect(windowInput.disabled).toBe(false);
    expect(savedPreferences().timing.doubleBlinkWindowMs).toBe(600);
    expect(savedPreferences().doubleBlinkEnabled).toBe(true);
  });

  it("uses the reloaded 600 ms double window in a new session", async () => {
    seedPreferences([
      { id: "a", label: "A", speech: "A" },
      { id: "b", label: "B", speech: "B" },
    ]);
    const preferences = savedPreferences();
    preferences.timing.doubleBlinkWindowMs = 600;
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    const provider = new FakeProvider();
    render(<BlinkAACApp providerFactory={() => provider} speakText={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));
    await waitFor(() => expect(provider.initializeCalls).toBe(1));
    startBoard(provider);

    blink(provider, [["closed", 10_000], ["open", 10_200], ["open", 10_700]]);
    expect(screen.getByRole("button", { name: "B" }).classList.contains("is-blink-focused")).toBe(false);
    blink(provider, [["open", 10_801]]);
    focusedButton("B");
  });

  it.each([1, 2, 5, 8, 10])("renders the structural board layout for %i cards", async (count) => {
    const cards = Array.from({ length: count }, (_, index) => ({ id: `card-${index}`, label: `CARD ${index}`, speech: `Card ${index}` }));
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      timing: { minIntentionalBlinkMs: 120, longBlinkThresholdMs: 700, doubleBlinkWindowMs: 450 },
      doubleBlinkEnabled: true,
      cards,
    }));
    const provider = new FakeProvider();
    render(<BlinkAACApp providerFactory={() => provider} speakText={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));
    await waitFor(() => expect(provider.initializeCalls).toBe(1));
    startBoard(provider);
    const board = await screen.findByRole("button", { name: "CARD 0" }).then((target) => target.parentElement!);
    expect(board.getAttribute("data-card-count")).toBe(String(count));
    expect(board.querySelectorAll(".concept-target")).toHaveLength(count);
  });

  it("exposes the legacy link only when a handler is provided", () => {
    const onRequestLegacy = vi.fn();
    render(<BlinkAACApp onRequestLegacy={onRequestLegacy} speakText={vi.fn()} />);
    const link = screen.getByRole("button", { name: "abrir interface antiga de gaze" });
    fireEvent.click(link);
    expect(onRequestLegacy).toHaveBeenCalledTimes(1);
    cleanup();
    render(<BlinkAACApp speakText={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "abrir interface antiga de gaze" })).toBeNull();
  });
});

describe("BlinkAACApp session flow", () => {
  it("uses the edited timing values in the session", async () => {
    const speakText = vi.fn();
    const provider = new FakeProvider();
    render(<BlinkAACApp providerFactory={() => provider} speakText={speakText} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Piscada longa (ms)" }), { target: { value: "400" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));
    await waitFor(() => expect(provider.initializeCalls).toBe(1));
    startBoard(provider);

    blink(provider, [
      ["open", 4_000],
      ["closed", 4_300],
      ["open", 4_800],
    ]);
    expect(speakText).toHaveBeenCalledWith("Sim");
  });

  it("shows which startup stage failed after camera permission was granted", async () => {
    const provider = new ModelFailureProvider();
    render(<BlinkAACApp providerFactory={() => provider} speakText={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));

    expect(await screen.findByText("A câmera abriu, mas o modelo de detecção não pôde ser baixado.")).toBeTruthy();
    const checklist = screen.getByRole("list", { name: "Etapas da inicialização" });
    expect(within(checklist).getByText("Permissão concedida")).toBeTruthy();
    expect(within(checklist).getByText("Câmera transmitindo (640×480)")).toBeTruthy();
    expect(within(checklist).getByText("Falha de rede ao baixar o modelo")).toBeTruthy();
    expect(provider.stopped).toBe(true);
  });

  it("initializes the camera on Iniciar and opens the board with SIM focused", async () => {
    const speakText = vi.fn();
    const provider = new FakeProvider();
    render(<BlinkAACApp providerFactory={() => provider} speakText={speakText} />);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));

    await waitFor(() => expect(provider.initializeCalls).toBe(1));
    expect(provider.listener).not.toBeNull();
    expect(screen.getByText(/aguardando o rosto/i)).toBeTruthy();

    blink(provider, [["open", 3_000]]);
    expect(await screen.findByRole("button", { name: "SIM" })).toBeTruthy();
    focusedButton("SIM");
    expect(screen.getByText(/câmera \+ modelo: ok/i)).toBeTruthy();
    expect(speakText).not.toHaveBeenCalled();
  });

  it("advances focus with a short blink and reports it", async () => {
    const speakText = vi.fn();
    const provider = new FakeProvider();
    render(<BlinkAACApp providerFactory={() => provider} speakText={speakText} />);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));
    await waitFor(() => expect(provider.initializeCalls).toBe(1));
    startBoard(provider);

    expect(await screen.findByText(/navegação ativa/i)).toBeTruthy();
    blink(provider, shortBlink);
    expect(screen.getByText(/próximo: nÃo/i)).toBeTruthy();
    focusedButton("NÃO");
    expect(speakText).not.toHaveBeenCalled();
  });

  it("moves focus back with a double blink", async () => {
    const speakText = vi.fn();
    const provider = new FakeProvider();
    render(<BlinkAACApp providerFactory={() => provider} speakText={speakText} />);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));
    await waitFor(() => expect(provider.initializeCalls).toBe(1));
    startBoard(provider);
    blink(provider, shortBlink);
    blink(provider, doubleBlink);
    expect(screen.getByText(/anterior: sim/i)).toBeTruthy();
    focusedButton("SIM");
  });

  it("selects the focused target with a long blink and speaks exactly once", async () => {
    const speakText = vi.fn();
    const provider = new FakeProvider();
    render(<BlinkAACApp providerFactory={() => provider} speakText={speakText} />);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));
    await waitFor(() => expect(provider.initializeCalls).toBe(1));
    startBoard(provider);

    blink(provider, longBlink);
    expect(speakText).toHaveBeenCalledTimes(1);
    expect(speakText).toHaveBeenCalledWith("Sim");
    expect(await screen.findByText("Selecionado: SIM")).toBeTruthy();
    const simButton = screen.getByRole("button", { name: "SIM" });
    expect(simButton.classList.contains("is-selected")).toBe(true);
  });

  it("suspends commands while tracking is unavailable and keeps focus", async () => {
    const provider = new FakeProvider();
    render(<BlinkAACApp providerFactory={() => provider} speakText={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));
    await waitFor(() => expect(provider.initializeCalls).toBe(1));
    startBoard(provider);
    expect(await screen.findByText(/câmera \+ modelo: ok/i)).toBeTruthy();

    blink(provider, [
      ["open", 20_000],
      ["closed", 20_300],
      ["open", 20_500],
      ["unavailable", 20_700],
      ["closed", 21_000],
      ["open", 21_300],
      ["open", 22_000],
      ["unavailable", 22_100],
    ]);

    expect(screen.getByText(/modelo ok · rosto perdido/i)).toBeTruthy();
    expect(screen.getByText(/navegação ativa/i)).toBeTruthy();
    focusedButton("SIM");
  });

  it("keeps the board running in portrait layout", async () => {
    const provider = new FakeProvider();
    render(<BlinkAACApp providerFactory={() => provider} speakText={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));
    await waitFor(() => expect(provider.initializeCalls).toBe(1));
    startBoard(provider);
    expect(await screen.findByText(/navegação ativa/i)).toBeTruthy();

    act(() => {
      Object.defineProperty(window, "innerWidth", { value: 600, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.queryByText(/Vire o dispositivo para a horizontal/)).toBeNull();
    expect(screen.getByText(/navegação ativa/i)).toBeTruthy();
    focusedButton("SIM");

    blink(provider, [["open", 55_000]]);
    expect(await screen.findByText(/câmera \+ modelo: ok/i)).toBeTruthy();
  });

  it("keeps a small viewport usable and cancels a partial gesture during resize", async () => {
    const provider = new FakeProvider();
    render(<BlinkAACApp providerFactory={() => provider} speakText={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));
    await waitFor(() => expect(provider.initializeCalls).toBe(1));
    startBoard(provider);
    expect(await screen.findByText(/navegação ativa/i)).toBeTruthy();

    act(() => {
      Object.defineProperty(window, "innerWidth", { value: 320, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: 568, configurable: true });
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.queryByText(/Tela pequena demais/)).toBeNull();
    expect(screen.getAllByRole("button", { name: /^(SIM|NÃO|VIRAR|DOR)$/ }).length).toBe(4);

    blink(provider, [["open", 50_000], ["closed", 50_300]]);
    act(() => window.dispatchEvent(new Event("orientationchange")));
    blink(provider, [["open", 50_500]]);
    expect(screen.getByText(/navegação ativa/i)).toBeTruthy();
    focusedButton("SIM");
    expect(provider.initializeCalls).toBe(1);

    blink(provider, shortBlink.map(([state, t]) => [state, t + 60_000] as [EyeObservation["state"], number]));
    focusedButton("NÃO");
  });

  it("exits to the ended screen and stops the provider", async () => {
    const provider = new FakeProvider();
    render(<BlinkAACApp providerFactory={() => provider} speakText={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));
    await waitFor(() => expect(provider.initializeCalls).toBe(1));
    startBoard(provider);
    expect(await screen.findByRole("button", { name: "Sair" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Sair" }));

    expect(await screen.findByText("Sessão encerrada.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Exportar diagnóstico JSON" })).toBeTruthy();
    expect(provider.stopped).toBe(true);
  });
});
