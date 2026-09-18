import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BlinkAACSessionController, conceptLabel, conceptSpeech, type BlinkCommand } from "../communication/blink-session";
import { defaultCommunicationCards, type CommunicationCard } from "../communication/concepts";
import { loadPreferences, MAX_COMMUNICATION_CARDS, newCardId, savePreferences, validCards, type BlinkTimingPreferences, type Preferences } from "../communication/preferences";
import { DEFAULT_BLINK_CONFIG, type BlinkConfig, type BlinkDetectorSnapshot } from "../gaze/blink-gesture";
import type { EyeObservation, EyeProviderStartupStatus, EyeProviderStartupStep, EyeStateProvider } from "../gaze/eye-types";
import { speak } from "../speech/tts";

function formatCommand(command: BlinkCommand, cards: readonly CommunicationCard[]): string {
  if (command.kind === "select") return `Selecionado: ${conceptLabel(command.target, cards)}`;
  return `${command.kind === "next" ? "Próximo" : "Anterior"}: ${conceptLabel(command.target, cards)}`;
}

export type BlinkAACProps = {
  providerFactory?: () => EyeStateProvider;
  config?: BlinkConfig;
  speakText?: (text: string) => void;
  debugByDefault?: boolean;
  onRequestLegacy?: () => void;
};

type Screen = "start" | "cards" | "boot" | "board" | "ended";

type BlinkTimingSettings = BlinkTimingPreferences;
type BlinkTimingDraft = Record<keyof BlinkTimingSettings, string>;

function parseTimingDraft(settings: BlinkTimingDraft): BlinkTimingSettings | null {
  const minIntentionalBlinkMs = Number(settings.minIntentionalBlinkMs);
  const longBlinkThresholdMs = Number(settings.longBlinkThresholdMs);
  const doubleBlinkWindowMs = Number(settings.doubleBlinkWindowMs);
  if (
    !settings.minIntentionalBlinkMs.trim()
    || !settings.longBlinkThresholdMs.trim()
    || !settings.doubleBlinkWindowMs.trim()
    || !Number.isFinite(minIntentionalBlinkMs)
    || !Number.isFinite(longBlinkThresholdMs)
    || !Number.isFinite(doubleBlinkWindowMs)
  ) return null;
  return { minIntentionalBlinkMs, longBlinkThresholdMs, doubleBlinkWindowMs };
}

function timingValidationMessage(settings: BlinkTimingDraft, maxClosedDurationMs: number): string | null {
  if (!settings.minIntentionalBlinkMs.trim()) return "Informe a duração mínima da piscada.";
  if (!settings.longBlinkThresholdMs.trim()) return "Informe a duração da piscada longa.";
  if (!settings.doubleBlinkWindowMs.trim()) return "Informe a janela entre duas piscadas.";
  const parsed = parseTimingDraft(settings);
  if (!parsed) return "Use apenas números válidos nos ajustes de piscada.";
  if (parsed.minIntentionalBlinkMs < 50 || parsed.minIntentionalBlinkMs > 2_000) {
    return "A piscada mínima deve ficar entre 50 e 2000 ms.";
  }
  if (parsed.longBlinkThresholdMs < 100) return "A piscada longa deve ser de pelo menos 100 ms.";
  if (parsed.longBlinkThresholdMs <= parsed.minIntentionalBlinkMs) {
    return "A piscada longa deve ser maior que a piscada mínima.";
  }
  if (parsed.longBlinkThresholdMs > maxClosedDurationMs) {
    return `A piscada longa não pode ultrapassar ${maxClosedDurationMs} ms.`;
  }
  if (parsed.doubleBlinkWindowMs < 100 || parsed.doubleBlinkWindowMs > 3_000) {
    return "A janela entre duas piscadas deve ficar entre 100 e 3000 ms.";
  }
  return null;
}

function clonePreferences(preferences: Preferences): Preferences {
  return {
    ...preferences,
    timing: { ...preferences.timing },
    cards: preferences.cards.map((card) => ({ ...card })),
  };
}

function preferencesSignature(preferences: Preferences): string {
  return JSON.stringify(preferences);
}

const STARTUP_STEPS: Array<{ id: EyeProviderStartupStep; label: string }> = [
  { id: "compatibility", label: "Navegador" },
  { id: "permission", label: "Permissão" },
  { id: "camera", label: "Câmera" },
  { id: "model", label: "Modelo" },
  { id: "engine", label: "Detector" },
];

type StartupStatusMap = Partial<Record<EyeProviderStartupStep, EyeProviderStartupStatus>>;

function StartupChecklist({ statuses }: { statuses: StartupStatusMap }) {
  return (
    <ol className="startup-checklist" aria-label="Etapas da inicialização">
      {STARTUP_STEPS.map(({ id, label }) => {
        const status = statuses[id];
        return (
          <li key={id} className={`startup-${status?.state ?? "pending"}`}>
            <span className="startup-icon" aria-hidden="true">
              {status?.state === "ready" ? "✓" : status?.state === "error" ? "!" : status?.state === "active" ? "…" : "·"}
            </span>
            <span><strong>{label}</strong><small>{status?.message ?? "Aguardando"}</small></span>
          </li>
        );
      })}
    </ol>
  );
}

export function BlinkAACApp({
  providerFactory,
  config = DEFAULT_BLINK_CONFIG,
  speakText = speak,
  debugByDefault = false,
  onRequestLegacy,
}: BlinkAACProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const providerRef = useRef<EyeStateProvider | null>(null);
  const sessionRef = useRef<BlinkAACSessionController | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const bootingRef = useRef(false);
  const reportedStartupStepsRef = useRef(new Set<EyeProviderStartupStep>());
  const applyObservationRef = useRef<(observation: EyeObservation) => void>(() => {});
  const sessionCardsRef = useRef<CommunicationCard[]>([]);
  const defaultProviderFactoryRef = useRef((() => {
    throw new Error("No blink eye-state provider was configured.");
  }) as () => EyeStateProvider);

  const [screen, setScreen] = useState<Screen>("start");
  const [sessionStage, setSessionStage] = useState<"waiting" | "active">("waiting");
  const [tracking, setTracking] = useState<"starting" | "ok" | "lost">("starting");
  const [focused, setFocused] = useState("sim");
  const [feedback, setFeedback] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugOn, setDebugOn] = useState(debugByDefault);
  const [exitArmed, setExitArmed] = useState(false);
  const [booting, setBooting] = useState(false);
  const [debugData, setDebugData] = useState<BlinkDetectorSnapshot | null>(null);
  const [diagnosticCount, setDiagnosticCount] = useState(0);
  const [startupStatuses, setStartupStatuses] = useState<StartupStatusMap>({});
  const [preferences, setPreferences] = useState(() => loadPreferences(config));
  const [timingSettings, setTimingSettings] = useState<BlinkTimingDraft>(() => ({
    minIntentionalBlinkMs: String(preferences.timing.minIntentionalBlinkMs),
    longBlinkThresholdMs: String(preferences.timing.longBlinkThresholdMs),
    doubleBlinkWindowMs: String(preferences.timing.doubleBlinkWindowMs),
  }));
  const [doubleBlinkEnabled, setDoubleBlinkEnabled] = useState(() => preferences.doubleBlinkEnabled);
  const [cards, setCards] = useState<CommunicationCard[]>(() => preferences.cards.map((card) => ({ ...card })));
  const [sessionCards, setSessionCards] = useState<CommunicationCard[]>(() => preferences.cards.map((card) => ({ ...card })));
  const [sessionConfig, setSessionConfig] = useState<BlinkConfig>(config);
  const preferencesRef = useRef(preferences);
  const persistedSignatureRef = useRef(preferencesSignature(preferences));

  const factory = providerFactory ?? defaultProviderFactoryRef.current;
  const timingError = timingValidationMessage(timingSettings, config.maxClosedDurationMs);
  const parsedTiming = useMemo(() => parseTimingDraft(timingSettings), [timingSettings]);
  const validDraftPreferences = useMemo(() => parsedTiming && timingError === null && validCards(cards)
    ? {
      schemaVersion: 1 as const,
      timing: parsedTiming,
      doubleBlinkEnabled,
      cards: cards.map((card) => ({ ...card })),
    }
    : null, [cards, doubleBlinkEnabled, parsedTiming, timingError]);
  const draftSignature = validDraftPreferences ? preferencesSignature(validDraftPreferences) : null;

  const persistPreferences = useCallback((next: Preferences) => {
    const snapshot = clonePreferences(next);
    preferencesRef.current = snapshot;
    persistedSignatureRef.current = preferencesSignature(snapshot);
    setPreferences(snapshot);
    savePreferences(snapshot, config.maxClosedDurationMs);
  }, [config.maxClosedDurationMs]);

  useEffect(() => {
    if (!validDraftPreferences || !draftSignature || draftSignature === persistedSignatureRef.current) return;
    const timeout = window.setTimeout(() => persistPreferences(validDraftPreferences), 400);
    return () => window.clearTimeout(timeout);
  }, [draftSignature, persistPreferences, validDraftPreferences]);

  const updateTiming = (field: keyof BlinkTimingSettings, value: string) => {
    setTimingSettings((current) => ({ ...current, [field]: value }));
  };

  const persistDiscreteChange = (nextCards: CommunicationCard[], nextDoubleBlinkEnabled = doubleBlinkEnabled) => {
    const timing = parsedTiming && timingError === null ? parsedTiming : preferencesRef.current.timing;
    const persistedCards = validCards(nextCards) ? nextCards : preferencesRef.current.cards;
    persistPreferences({
      schemaVersion: 1,
      timing: { ...timing },
      doubleBlinkEnabled: nextDoubleBlinkEnabled,
      cards: persistedCards.map((card) => ({ ...card })),
    });
  };

  const updateCard = (id: string, field: "label" | "speech", value: string) => {
    setCards((current) => current.map((card) => card.id === id ? { ...card, [field]: value } : card));
  };

  const moveCard = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= cards.length) return;
    const next = [...cards];
    [next[index], next[destination]] = [next[destination], next[index]];
    setCards(next);
    persistDiscreteChange(next);
  };

  const applyObservation = useCallback((observation: EyeObservation) => {
    const controller = sessionRef.current;
    if (!controller) return;
    controller.handleEyeObservation(observation);
    const view = controller.view;
    setSessionStage(view.stage);
    setTracking(view.tracking);
    setDiagnosticCount(view.diagnosticCount);

    let pulse: string | null = null;
    for (const command of controller.consumeCommands()) {
      setFocused(command.target);
      setFeedback(formatCommand(command, sessionCardsRef.current));
      if (command.kind === "select") pulse = command.target;
    }
    if (pulse !== null) {
      speakText(conceptSpeech(pulse, sessionCardsRef.current));
      setSelected(pulse);
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = window.setTimeout(() => setSelected(null), 700);
    }
  }, [speakText]);

  applyObservationRef.current = applyObservation;

  const stopSession = useCallback(() => {
    sessionRef.current?.stop();
    providerRef.current?.stop();
    providerRef.current = null;
    if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = null;
    setSessionStage("waiting");
    setTracking("starting");
  }, []);

  const beginSession = useCallback(async () => {
    if (bootingRef.current || timingError || !parsedTiming || !validCards(cards)) return;
    bootingRef.current = true;
    setBooting(true);
    setError(null);
    setFeedback("");
    setFocused("sim");
    setSelected(null);
    setExitArmed(false);
    reportedStartupStepsRef.current = new Set();
    setStartupStatuses({});
    const configuredSession = {
      ...config,
      ...parsedTiming,
      doubleBlinkEnabled,
    };
    setSessionConfig(configuredSession);
    const configuredCards = cards.map((card) => ({ ...card }));
    sessionCardsRef.current = configuredCards;
    setSessionCards(configuredCards);
    const controller = new BlinkAACSessionController(configuredSession, configuredCards);
    sessionRef.current = controller;
    controller.start();
    setScreen("boot");
    const syntheticOnly = import.meta.env.DEV && new URLSearchParams(window.location.search).has("blinkSynthetic");
    if (syntheticOnly) {
      bootingRef.current = false;
      setBooting(false);
      return;
    }
    try {
      const provider = factory();
      providerRef.current = provider;
      await provider.initialize(videoRef.current!, (status) => {
        reportedStartupStepsRef.current.add(status.step);
        setStartupStatuses((current) => ({ ...current, [status.step]: status }));
      });
      setStartupStatuses((current) => {
        const complete = { ...current };
        for (const { id, label } of STARTUP_STEPS) {
          if (!reportedStartupStepsRef.current.has(id)) {
            complete[id] = { step: id, state: "ready", message: `${label} pronto` };
          }
        }
        return complete;
      });
      provider.start(applyObservation);
    } catch (reason) {
      controller.stop();
      providerRef.current?.stop();
      providerRef.current = null;
      setError(reason instanceof Error ? reason.message : "Não foi possível iniciar a câmera.");
      setScreen("start");
    }
    bootingRef.current = false;
    setBooting(false);
  }, [applyObservation, cards, config, doubleBlinkEnabled, factory, parsedTiming, timingError]);

  useEffect(() => {
    if (sessionStage === "active" && screen === "boot") {
      setScreen("board");
    }
  }, [sessionStage, screen]);

  useEffect(() => {
    const cancelPendingGesture = () => {
      const controller = sessionRef.current;
      if (!controller?.isActive || screen !== "board") return;
      controller.cancelPendingGestureForViewportChange();
      setSessionStage(controller.view.stage);
      setTracking(controller.view.tracking);
      setDiagnosticCount(controller.view.diagnosticCount);
    };
    window.addEventListener("resize", cancelPendingGesture);
    window.addEventListener("orientationchange", cancelPendingGesture);
    return () => {
      window.removeEventListener("resize", cancelPendingGesture);
      window.removeEventListener("orientationchange", cancelPendingGesture);
    };
  }, [screen]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!new URLSearchParams(window.location.search).has("blinkSynthetic")) return;
    const handleSynthetic = (event: Event) => {
      const observation = (event as CustomEvent<EyeObservation>).detail;
      if (!observation || !["open", "closed", "unavailable"].includes(observation.state) || !Number.isFinite(observation.timestampMs)) return;
      applyObservationRef.current(observation);
    };
    window.addEventListener("gaze-aac:blink-eye-state", handleSynthetic);
    return () => window.removeEventListener("gaze-aac:blink-eye-state", handleSynthetic);
  }, []);

  useEffect(() => {
    if (!debugOn || screen !== "board") return;
    const tick = () => {
      const controller = sessionRef.current;
      if (!controller) return;
      setDebugData(controller.debugSnapshot(performance.now()));
      setDiagnosticCount(controller.view.diagnosticCount);
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [debugOn, screen]);

  useEffect(() => () => {
    sessionRef.current?.stop();
    providerRef.current?.stop();
    if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
  }, []);

  const requestExit = () => setExitArmed(true);
  const cancelExit = () => setExitArmed(false);

  const confirmExit = () => {
    stopSession();
    setScreen("ended");
    setExitArmed(false);
    setDebugData(null);
  };

  const exportDiagnostics = () => {
    const controller = sessionRef.current;
    if (!controller) return;
    const data = controller.export();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `blink-${data.sessionId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const returnToStart = () => {
    setScreen("start");
    setError(null);
    setDebugOn(false);
  };

  const waitingForFace = sessionStage === "waiting" && (screen === "boot" || screen === "board");
  const startupComplete = STARTUP_STEPS.every(({ id }) => startupStatuses[id]?.state === "ready");
  const currentStartup = [...STARTUP_STEPS].reverse().map(({ id }) => startupStatuses[id]).find((status) => status?.state === "active" || status?.state === "error");
  const runtimeFailure = [...STARTUP_STEPS].reverse().map(({ id }) => startupStatuses[id]).find((status) => status?.state === "error");

  return (
    <main className={`blink-shell ${screen === "board" ? "is-board" : ""}`}>
      <video ref={videoRef} id="gaze-camera" autoPlay muted playsInline className="camera-source" aria-hidden="true" />

      {screen === "start" && (
        <section className="blink-start" aria-live="polite">
          <p className="eyebrow">experimental</p>
          <h1>Comunicação por piscadas</h1>
          <p className="blink-start-instruction">Use piscadas para navegar e selecionar.</p>
          <ul className="blink-legend" aria-label="Como usar">
            <li><span className="legend-short">piscada curta</span><span>próximo</span></li>
            {doubleBlinkEnabled && <li><span className="legend-double">duas piscadas curtas</span><span>anterior</span></li>}
            <li><span className="legend-long">piscada longa</span><span>selecionar</span></li>
          </ul>
          <fieldset className="blink-timing-settings">
            <legend>Ajustes de piscada</legend>
            <label>
              <span>Piscada mínima</span>
              <span className="timing-input"><input type="number" aria-label="Piscada mínima (ms)" min="50" max="2000" step="10" value={timingSettings.minIntentionalBlinkMs} onChange={(event) => updateTiming("minIntentionalBlinkMs", event.currentTarget.value)} /><small>ms</small></span>
              <small>Abaixo disso, ignora</small>
            </label>
            <label>
              <span>Piscada longa</span>
              <span className="timing-input"><input type="number" aria-label="Piscada longa (ms)" min="100" max={config.maxClosedDurationMs} step="50" value={timingSettings.longBlinkThresholdMs} onChange={(event) => updateTiming("longBlinkThresholdMs", event.currentTarget.value)} /><small>ms</small></span>
              <small>A partir disso, seleciona</small>
            </label>
            <label>
              <span>Janela dupla</span>
              <span className="timing-input"><input type="number" aria-label="Janela da piscada dupla (ms)" min="100" max="3000" step="10" value={timingSettings.doubleBlinkWindowMs} disabled={!doubleBlinkEnabled} onChange={(event) => updateTiming("doubleBlinkWindowMs", event.currentTarget.value)} /><small>ms</small></span>
              <small>Tempo para a segunda piscada</small>
            </label>
          </fieldset>
          <label className="double-blink-toggle"><input type="checkbox" checked={doubleBlinkEnabled} onChange={(event) => { const next = event.currentTarget.checked; setDoubleBlinkEnabled(next); persistDiscreteChange(cards, next); }} /> <span><strong>Usar duas piscadas para voltar</strong><small>{doubleBlinkEnabled ? "Uma piscada curta aguarda brevemente por uma segunda." : "Cada piscada curta avança imediatamente."}</small></span></label>
          {timingError && <p className="timing-error" role="alert">{timingError}</p>}
          {!validCards(cards) && <p className="timing-error" role="alert">Revise os cards antes de iniciar.</p>}
          <p className="layout-note">Pode ser usado na vertical ou horizontal. O quadro se adapta à tela.</p>
          {error && (
            <div className="startup-error-panel" role="alert">
              <p className="error-message">{error}</p>
              <StartupChecklist statuses={startupStatuses} />
            </div>
          )}
          <div className="blink-start-actions">
            <button className="secondary-button" onClick={() => setScreen("cards")}>Configurar cards ({cards.length})</button>
            <button className="primary-button" onClick={() => void beginSession()} disabled={booting || timingError !== null || !validCards(cards)}>
              {booting ? "Carregando…" : "Iniciar"}
            </button>
          </div>
          {onRequestLegacy && <button className="legacy-link" onClick={onRequestLegacy}>abrir interface antiga de gaze</button>}
          <p className="privacy-note">O vídeo nunca sai do aparelho e não é salvo. As piscadas controlam apenas os lembretes acima.</p>
        </section>
      )}

      {screen === "cards" && (
        <section className="blink-start card-settings" aria-live="polite">
          <p className="eyebrow">configuração</p>
          <h2>Cards de comunicação</h2>
          <p className="blink-start-instruction">Edite o texto exibido e a frase falada. A ordem define a navegação.</p>
          <div className="card-editor-list">
            {cards.map((card, index) => (
              <fieldset className="card-editor" key={card.id}>
                <legend>Card {index + 1}</legend>
                <label>Texto do card<input aria-label={`Texto do card ${index + 1}`} value={card.label} onChange={(event) => updateCard(card.id, "label", event.currentTarget.value)} /></label>
                <label>Texto falado<input aria-label={`Texto falado do card ${index + 1}`} value={card.speech} onChange={(event) => updateCard(card.id, "speech", event.currentTarget.value)} /></label>
                <div className="card-editor-actions"><button className="secondary-button compact" onClick={() => moveCard(index, -1)} disabled={index === 0}>Subir</button><button className="secondary-button compact" onClick={() => moveCard(index, 1)} disabled={index === cards.length - 1}>Descer</button><button className="secondary-button compact" onClick={() => { const next = cards.filter((item) => item.id !== card.id); setCards(next); persistDiscreteChange(next); }} disabled={cards.length === 1}>Remover</button></div>
              </fieldset>
          ))}
          </div>
          {!validCards(cards) && <p className="timing-error" role="alert">Cada card precisa de texto exibido e texto falado.</p>}
          <div className="blink-start-actions"><button className="secondary-button" onClick={() => { if (cards.length >= MAX_COMMUNICATION_CARDS) return; const next = [...cards, { id: newCardId(cards), label: "NOVO CARD", speech: "Novo card" }]; setCards(next); persistDiscreteChange(next); }} disabled={cards.length >= MAX_COMMUNICATION_CARDS}>Adicionar card</button><button className="secondary-button" onClick={() => { const next = defaultCommunicationCards(); setCards(next); persistDiscreteChange(next); }}>Restaurar cards padrão</button><button className="secondary-button" onClick={() => setScreen("start")}>Voltar</button></div>
        </section>
      )}

      {screen === "boot" && (
        <section className="blink-boot" aria-live="polite">
          <p className="eyebrow">iniciando</p>
          <h2>{startupComplete && waitingForFace ? "Aguardando o rosto…" : currentStartup?.message ?? "Preparando…"}</h2>
          <p>{startupComplete ? "Fique de frente para a câmera, com boa iluminação no rosto." : "A primeira inicialização pode demorar um pouco."}</p>
          <StartupChecklist statuses={startupStatuses} />
          {startupComplete && <p className="tracking-pill tracking-starting">{tracking === "lost" ? "Rosto ainda não detectado" : "Detector pronto · procurando rosto"}</p>}
        </section>
      )}

      {screen === "board" && (
        <section className="blink-board-session">
          <header className="blink-board-header">
            <span className={`tracking-pill tracking-${runtimeFailure ? "lost" : tracking}`} aria-live="polite" title={runtimeFailure?.message}>
              {runtimeFailure ? `Falha: ${runtimeFailure.message}` : waitingForFace ? "Modelo OK · aguardando rosto…" : tracking === "ok" ? "Câmera + modelo: OK" : "Modelo OK · rosto perdido"}
            </span>
            <div className="blink-operator-tools">
              {debugOn && <span className="debug-count">{diagnosticCount} evento(s)</span>}
              <button className="secondary-button compact" onClick={requestExit}>Sair</button>
            </div>
          </header>

          <div className="blink-board" data-card-count={sessionCards.length}>
            {sessionCards.map((card) => (
              <button
                key={card.id}
                className={`concept-target ${focused === card.id ? "is-blink-focused" : ""} ${selected === card.id ? "is-selected" : ""}`}
                aria-label={card.label}
                onClick={(event) => event.preventDefault()}
              >
                <span>{card.label}</span>
                {focused === card.id && <span className="blink-focus-indicator" aria-hidden="true">Foco</span>}
              </button>
            ))}
          </div>

          <footer className="blink-board-footer">
            <p className="selection-feedback" aria-live="polite">{feedback || `Navegação ativa. ${sessionCards[0]?.label ?? "Card"} é o item inicial.`}</p>
          </footer>

          {exitArmed && (
            <div className="blink-exit-confirm" role="alertdialog" aria-label="Confirmar saída">
              <p>Encerrar a sessão?</p>
              <div className="setup-actions">
                <button className="primary-button" onClick={confirmExit}>Sair</button>
                <button className="secondary-button" onClick={cancelExit}>Continuar sessão</button>
              </div>
            </div>
          )}

          {debugOn && debugData && (
            <dl className="debug-panel blink-debug-panel">
              <div><dt>eye state</dt><dd>{debugData.eyeState}</dd></div>
              <div><dt>detector</dt><dd>{debugData.detectorState}</dd></div>
              <div><dt>último gesto</dt><dd>{debugData.lastGesture ?? "—"}</dd></div>
              <div><dt>1ª piscada (ms)</dt><dd>{debugData.firstBlinkDurationMs === null ? "—" : Math.round(debugData.firstBlinkDurationMs)}</dd></div>
              <div><dt>2ª em progresso</dt><dd>{debugData.secondBlinkInProgress ? "sim" : "não"}</dd></div>
              <div><dt>fechamento atual (ms)</dt><dd>{debugData.currentClosedDurationMs === null ? "—" : Math.round(debugData.currentClosedDurationMs)}</dd></div>
              <div><dt>janela dupla restante</dt><dd>{debugData.doubleBlinkRemainingMs === null ? "—" : `${Math.round(debugData.doubleBlinkRemainingMs)} ms`}</dd></div>
              <div><dt>deadline (ms)</dt><dd>{debugData.doubleWindowDeadlineMs === null ? "—" : Math.round(debugData.doubleWindowDeadlineMs)}</dd></div>
              <div><dt>pendente 1ª curta</dt><dd>{debugData.pendingShort ? "sim" : "não"}</dd></div>
              <div><dt>2ª em progresso</dt><dd>{debugData.secondBlinkInProgress ? "sim" : "não"}</dd></div>
              <div><dt>cooldown (ms)</dt><dd>{Math.round(debugData.cooldownRemainingMs)}</dd></div>
              <div><dt>min/longo (ms)</dt><dd>{sessionConfig.minIntentionalBlinkMs} / {sessionConfig.longBlinkThresholdMs}</dd></div>
              <div><dt>janela/re-arm/max (ms)</dt><dd>{sessionConfig.doubleBlinkWindowMs} / {sessionConfig.cooldownMs} / {sessionConfig.maxClosedDurationMs}</dd></div>
              <div><dt>estabilidade (ms)</dt><dd>{sessionConfig.stateStabilityMs}</dd></div>
              <div><dt>tracking</dt><dd>{tracking}</dd></div>
            </dl>
          )}
        </section>
      )}

      {screen === "ended" && (
        <section className="blink-ended" aria-live="polite">
          <p className="eyebrow">fim da sessão</p>
          <h2>Sessão encerrada.</h2>
          <p>O diagnóstico das piscadas desta sessão pode ser exportado como arquivo local.</p>
          <div className="setup-actions">
            <button className="primary-button" onClick={exportDiagnostics}>Exportar diagnóstico JSON</button>
            <button className="secondary-button" onClick={returnToStart}>Voltar ao início</button>
          </div>
          <p className="privacy-note">O export contém apenas durações e eventos derivados. Nenhum vídeo, frame ou landmark é salvo.</p>
        </section>
      )}
    </main>
  );
}
