/** @vitest-environment jsdom */
import { describe, expect, it, vi, afterEach } from "vitest";
import { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { BlinkAACApp } from "./blink-aac";
import type { EyeObservation, EyeStateProvider } from "../gaze/eye-types";

class FakeProvider implements EyeStateProvider {
  readonly name = "fake-blink";
  listener: ((observation: EyeObservation) => void) | null = null;
  stopped = false;
  initializeCalls = 0;

  async initialize(): Promise<void> {
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

afterEach(() => cleanup());

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
    expect(screen.getByRole("button", { name: "Treinar piscadas" })).toBeTruthy();
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
    expect(screen.getByText(/câmera: ok/i)).toBeTruthy();
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
    expect(await screen.findByText(/câmera: ok/i)).toBeTruthy();

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

    expect(screen.getByText(/câmera: perdida/i)).toBeTruthy();
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
    expect(await screen.findByText(/câmera: ok/i)).toBeTruthy();
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

  it("runs the optional training flow before the board", async () => {
    const provider = new FakeProvider();
    render(<BlinkAACApp providerFactory={() => provider} speakText={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Treinar piscadas" }));
    await waitFor(() => expect(provider.initializeCalls).toBe(1));
    blink(provider, [["open", 3_000]]);

    expect(await screen.findByText(/treinamento opcional/i)).toBeTruthy();
    for (let step = 0; step < 3; step += 1) {
      expect(screen.getByRole("button", { name: step === 2 ? "Ativar navegação" : "Avançar" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: step === 2 ? "Ativar navegação" : "Avançar" }));
    }
    expect(await screen.findByText(/navegação ativa/i)).toBeTruthy();
    focusedButton("SIM");
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
