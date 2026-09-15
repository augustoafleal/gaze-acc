/** @vitest-environment jsdom */
import { describe, expect, it, vi, afterEach } from "vitest";
import { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { BlinkAACApp } from "./blink-aac";
import type { EyeObservation, EyeProviderStatusListener, EyeStateProvider } from "../gaze/eye-types";

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
    expect(screen.queryByRole("button", { name: "Treinar piscadas" })).toBeNull();
    expect((screen.getByRole("spinbutton", { name: "Piscada mínima (ms)" }) as HTMLInputElement).value).toBe("120");
    expect((screen.getByRole("spinbutton", { name: "Piscada longa (ms)" }) as HTMLInputElement).value).toBe("700");
    expect((screen.getByRole("spinbutton", { name: "Janela da piscada dupla (ms)" }) as HTMLInputElement).value).toBe("450");
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
