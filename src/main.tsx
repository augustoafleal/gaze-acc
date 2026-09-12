import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

import { CONCEPTS, type ConceptId } from "./communication/concepts";
import { ExperimentLogger } from "./communication/experiment";
import {
  GUIDED_DEFAULTS,
  GuidedExperimentSession,
  type GuidedExport,
} from "./communication/guided-experiment";
import type { ExperimentMetrics } from "./communication/metrics";
import { DEFAULT_DWELL_CONFIG, DwellController } from "./gaze/dwell";
import { createWebEyeTrackProvider, type GazeProvider } from "./gaze";
import { normalizedPointInRectToViewport, normalizedToViewportCss, orientationForViewport, pointInCssRect, viewportFromWindow } from "./gaze/mapping";
import { invalidObservation, type GazeObservation } from "./gaze/types";
import { speak } from "./speech/tts";

const CALIBRATION_POINTS = [
  { x: 0.15, y: 0.15 }, { x: 0.5, y: 0.15 }, { x: 0.85, y: 0.15 },
  { x: 0.15, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.85, y: 0.5 },
  { x: 0.15, y: 0.85 }, { x: 0.5, y: 0.85 }, { x: 0.85, y: 0.85 },
] as const;

type Phase = "ready" | "loading" | "calibration" | "board";
type InputMode = "camera" | "pointer";
type ViewMode = "free" | "guided";
type GuidedStage = "preparation" | "between" | "trial" | "neutral" | "paused" | "complete" | "cancelled";

function viewportIsLandscape(): boolean {
  return orientationForViewport(viewportFromWindow()) === "landscape";
}

const APPLICATION_VERSION = "0.1.0";

const statusText: Record<GazeObservation["status"], string> = {
  valid: "tracking ativo", "no-face": "rosto não encontrado", "eyes-closed": "olhos fechados",
  invalid: "amostra inválida", error: "erro de tracking",
};

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const calibrationFieldRef = useRef<HTMLDivElement>(null);
  const providerRef = useRef<GazeProvider | null>(null);
  const targetRefs = useRef<Record<ConceptId, HTMLButtonElement | null>>({ sim: null, nao: null, agua: null, dor: null });
  const dwellRef = useRef(new DwellController(DEFAULT_DWELL_CONFIG));
  const loggerRef = useRef(new ExperimentLogger("WebEyeTrack 0.0.2", DEFAULT_DWELL_CONFIG, null));
  const guidedRef = useRef<GuidedExperimentSession | null>(null);
  const guidedTimerRef = useRef<number | null>(null);
  const guidedStageRef = useRef<GuidedStage>("preparation");
  const guidedViewRef = useRef<ViewMode>("free");
  const guidedNeutralIndexRef = useRef(0);
  const guidedPendingActionRef = useRef<"trial" | "neutral" | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [inputMode, setInputMode] = useState<InputMode | null>(null);
  const [viewMode, setViewModeState] = useState<ViewMode>("free");
  const [guidedStage, setGuidedStageState] = useState<GuidedStage>("preparation");
  const [guidedTrialTimeoutMs, setGuidedTrialTimeoutMs] = useState(GUIDED_DEFAULTS.trialTimeoutMs);
  const [guidedTrialPlan, setGuidedTrialPlan] = useState<{ phase: "warmup" | "main"; sequenceIndex: number; intendedTarget: ConceptId } | null>(null);
  const [guidedNeutralIndex, setGuidedNeutralIndex] = useState(0);
  const [guidedResult, setGuidedResult] = useState<GuidedExport | null>(null);
  const [calibrationIndex, setCalibrationIndex] = useState(0);
  const [calibrationId, setCalibrationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [observationStatus, setObservationStatus] = useState<GazeObservation["status"]>("invalid");
  const [dwellProgress, setDwellProgress] = useState(0);
  const [candidate, setCandidate] = useState<ConceptId | null>(null);
  const [debugTarget, setDebugTarget] = useState<ConceptId | null>(null);
  const [debugElapsedMs, setDebugElapsedMs] = useState(0);
  const [debugSampleTimestampMs, setDebugSampleTimestampMs] = useState<number | null>(null);
  const [debugClockMs, setDebugClockMs] = useState<number | null>(null);
  const [lastSelection, setLastSelection] = useState<ConceptId | null>(null);
  const [debugCursor, setDebugCursor] = useState(false);
  const [debugPoint, setDebugPoint] = useState<{ x: number; y: number } | null>(null);
  const [intendedTarget, setIntendedTarget] = useState<ConceptId>("sim");
  const [attemptActive, setAttemptActive] = useState(false);
  const [neutralActive, setNeutralActive] = useState(false);
  const [metrics, setMetrics] = useState<ExperimentMetrics>(() => loggerRef.current.metrics());
  const [orientationBlocked, setOrientationBlocked] = useState(() => typeof window !== "undefined" && !viewportIsLandscape());
  const [viewportInvalid, setViewportInvalid] = useState(false);

  const activeSession = phase === "calibration" || (phase === "board" && (inputMode !== null || viewMode === "guided"));

  const setViewMode = (next: ViewMode) => {
    guidedViewRef.current = next;
    setViewModeState(next);
  };

  const setGuidedStage = (next: GuidedStage) => {
    guidedStageRef.current = next;
    setGuidedStageState(next);
  };

  const clearGuidedTimer = () => {
    if (guidedTimerRef.current !== null) window.clearTimeout(guidedTimerRef.current);
    guidedTimerRef.current = null;
  };

  const resetDwell = () => {
    dwellRef.current = new DwellController(DEFAULT_DWELL_CONFIG);
    setCandidate(null);
    setDwellProgress(0);
    setDebugTarget(null);
    setDebugElapsedMs(0);
  };

  const guidedViewport = () => {
    const viewport = viewportFromWindow();
    return { ...viewport, orientation: viewport.height >= viewport.width ? "portrait" as const : "landscape" as const };
  };

  function scheduleGuidedAction(action: "trial" | "neutral", delayMs: number): void {
    clearGuidedTimer();
    guidedPendingActionRef.current = action;
    guidedTimerRef.current = window.setTimeout(() => {
      guidedTimerRef.current = null;
      if (action === "trial") beginNextGuidedTrial();
      else beginGuidedNeutralWindow();
    }, delayMs);
  }

  function finishGuidedSession(status: "completed" | "cancelled"): void {
    const session = guidedRef.current;
    if (!session) return;
    clearGuidedTimer();
    if (status === "completed") session.complete();
    else session.cancel(performance.now());
    providerRef.current?.stop();
    providerRef.current = null;
    const result = session.exportData(guidedViewport());
    setGuidedResult(result);
    setGuidedStage(status === "completed" ? "complete" : "cancelled");
    setPhase("board");
    setInputMode(null);
    resetDwell();
  }

  function finishGuidedTrial(record: NonNullable<GuidedExport["trials"]>[number]): void {
    clearGuidedTimer();
    setGuidedTrialPlan(null);
    resetDwell();
    setGuidedStage("between");
    if (record.phase === "warmup" && guidedRef.current?.warmupOnlyReady) {
      guidedPendingActionRef.current = null;
      return;
    }
    const nextAction = record.phase === "main" && record.sequenceIndex === GUIDED_DEFAULTS.mainPerTarget * 4 ? "neutral" : "trial";
    scheduleGuidedAction(nextAction, GUIDED_DEFAULTS.interTrialNeutralMs);
  }

  function finishWarmupOnly(): void {
    if (!guidedRef.current?.warmupOnlyReady || guidedStageRef.current !== "between") return;
    finishGuidedSession("completed");
  }

  function continueAfterWarmup(): void {
    if (!guidedRef.current?.warmupOnlyReady || guidedStageRef.current !== "between") return;
    scheduleGuidedAction("trial", GUIDED_DEFAULTS.interTrialNeutralMs);
  }

  function handleGuidedTimeout(): void {
    const session = guidedRef.current;
    if (!session || guidedStageRef.current !== "trial") return;
    const record = session.timeoutTrial(performance.now());
    if (record) finishGuidedTrial(record);
  }

  function beginNextGuidedTrial(): void {
    const session = guidedRef.current;
    if (!session || session.status !== "in-progress") return;
    const plan = session.startNextTrial(performance.now());
    if (!plan) {
      beginGuidedNeutralWindow();
      return;
    }
    setGuidedTrialPlan(plan);
    setGuidedStage("trial");
    resetDwell();
    clearGuidedTimer();
    guidedTimerRef.current = window.setTimeout(handleGuidedTimeout, session.trialTimeoutMs);
  }

  function beginGuidedNeutralWindow(): void {
    const session = guidedRef.current;
    if (!session || session.status !== "in-progress") return;
    if (guidedNeutralIndexRef.current >= GUIDED_DEFAULTS.neutralWindowCount) {
      finishGuidedSession("completed");
      return;
    }
    session.startNeutralWindow(performance.now());
    setGuidedStage("neutral");
    resetDwell();
    clearGuidedTimer();
    guidedTimerRef.current = window.setTimeout(finishGuidedNeutralWindow, GUIDED_DEFAULTS.neutralWindowDurationMs);
  }

  function finishGuidedNeutralWindow(): void {
    const session = guidedRef.current;
    if (!session || guidedStageRef.current !== "neutral") return;
    session.finishNeutralWindow(performance.now());
    guidedNeutralIndexRef.current += 1;
    setGuidedNeutralIndex(guidedNeutralIndexRef.current);
    resetDwell();
    if (guidedNeutralIndexRef.current >= GUIDED_DEFAULTS.neutralWindowCount) {
      finishGuidedSession("completed");
      return;
    }
    setGuidedStage("between");
    scheduleGuidedAction("neutral", GUIDED_DEFAULTS.interTrialNeutralMs);
  }

  function cancelGuidedSession(): void {
    if (guidedRef.current) finishGuidedSession("cancelled");
  }

  function pauseGuidedSession(): void {
    if (guidedStageRef.current !== "between") return;
    clearGuidedTimer();
    setGuidedStage("paused");
  }

  function resumeGuidedSession(): void {
    if (guidedStageRef.current !== "paused") return;
    setGuidedStage("between");
    scheduleGuidedAction(guidedPendingActionRef.current ?? "trial", GUIDED_DEFAULTS.interTrialNeutralMs);
  }

  const currentTarget = useCallback((observation: GazeObservation): ConceptId | null => {
    if (observation.sample === null) return null;
    const point = normalizedToViewportCss(observation.sample, viewportFromWindow());
    return CONCEPTS.find(({ id }) => {
      const element = targetRefs.current[id];
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return pointInCssRect(point, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
    })?.id ?? null;
  }, []);

  const processObservation = useCallback((observation: GazeObservation) => {
    setObservationStatus(observation.status);
    if (observation.sample) setDebugPoint({ x: observation.sample.x, y: observation.sample.y });
    const target = currentTarget(observation);

    if (guidedViewRef.current === "guided" && guidedRef.current) {
      const stage = guidedStageRef.current;
      if (stage !== "trial" && stage !== "neutral") return;

      guidedRef.current.observe(observation, target);
      const timestampMs = observation.timestampMs ?? observation.sample?.timestampMs ?? performance.now();
      const update = dwellRef.current.update(target, observation.status, timestampMs);
      setCandidate(update.state.candidateId as ConceptId | null);
      setDwellProgress(update.state.progress);
      setDebugTarget(target);
      setDebugElapsedMs(update.state.accumulatedMs);
      setDebugSampleTimestampMs(observation.timestampMs ?? observation.sample?.timestampMs ?? null);
      setDebugClockMs(performance.now());
      if (!update.selection) return;

      const selected = update.selection as ConceptId;
      if (stage === "trial") {
        const record = guidedRef.current.confirmTrial(selected, timestampMs);
        if (record) {
          setLastSelection(selected);
          speak(CONCEPTS.find((concept) => concept.id === selected)?.speech ?? selected);
          finishGuidedTrial(record);
        }
      } else {
        guidedRef.current.confirmNeutralSelection(selected, timestampMs);
        setLastSelection(selected);
        resetDwell();
      }
      return;
    }

    loggerRef.current.observe(observation, target);
    const timestampMs = observation.timestampMs ?? observation.sample?.timestampMs ?? performance.now();
    const update = dwellRef.current.update(target, observation.status, timestampMs);
    setCandidate(update.state.candidateId as ConceptId | null);
    setDwellProgress(update.state.progress);
    setDebugTarget(target);
    setDebugElapsedMs(update.state.accumulatedMs);
    setDebugSampleTimestampMs(observation.timestampMs ?? observation.sample?.timestampMs ?? null);
    setDebugClockMs(performance.now());
    if (update.selection) {
      const selected = update.selection as ConceptId;
      loggerRef.current.confirmSelection(selected, timestampMs);
      setLastSelection(selected);
      setAttemptActive(false);
      speak(CONCEPTS.find((concept) => concept.id === selected)?.speech ?? selected);
      setMetrics(loggerRef.current.metrics());
    }
  // The provider keeps this callback after start; mutable refs intentionally supply session state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTarget]);

  useEffect(() => {
    const rootElement = document.getElementById("root");
    const elements = [document.documentElement, document.body, rootElement].filter((element): element is HTMLElement => element !== null);
    for (const element of elements) element.classList.toggle("active-session", activeSession);
    if (activeSession) window.scrollTo(0, 0);
    return () => {
      for (const element of elements) element.classList.remove("active-session");
    };
  }, [activeSession]);

  useEffect(() => {
    const invalidateViewport = () => {
      const landscape = viewportIsLandscape();
      setOrientationBlocked(!landscape);
      if (phase === "board" || phase === "calibration") {
        setViewportInvalid(true);
        resetDwell();
        if (guidedViewRef.current === "guided" && guidedRef.current && guidedStageRef.current !== "complete" && guidedStageRef.current !== "cancelled") {
          cancelGuidedSession();
          setError(landscape ? "A janela mudou de tamanho. A sessão guiada foi cancelada e pode ser exportada." : "A tela mudou de orientação. A sessão guiada foi cancelada e pode ser exportada.");
          return;
        }
        providerRef.current?.stop(); providerRef.current = null;
        setPhase("ready"); setInputMode(null); setCalibrationId(null); setCalibrationIndex(0);
        setError(landscape ? "A janela mudou de tamanho. A calibração foi invalidada." : "A tela mudou de orientação. Vire o dispositivo para a horizontal e recalibre.");
      }
    };
    window.addEventListener("resize", invalidateViewport);
    window.addEventListener("orientationchange", invalidateViewport);
    return () => {
      window.removeEventListener("resize", invalidateViewport);
      window.removeEventListener("orientationchange", invalidateViewport);
    };
  // The invalidation handler is recreated with the phase it guards.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => () => {
    clearGuidedTimer();
    providerRef.current?.stop();
    providerRef.current = null;
  // Unmount cleanup intentionally reads the current provider/session refs.
  }, []);

  const startCamera = async () => {
    if (!viewportIsLandscape()) {
      setOrientationBlocked(true);
      setError("Vire o dispositivo para a horizontal antes de iniciar a calibração.");
      return;
    }
    setOrientationBlocked(false);
    setViewportInvalid(false);
    setPhase("loading"); setError(null);
    try {
      if (guidedViewRef.current === "guided") {
        guidedRef.current = new GuidedExperimentSession({
          provider: "WebEyeTrack 0.0.2",
          applicationVersion: APPLICATION_VERSION,
          dwell: DEFAULT_DWELL_CONFIG,
          trialTimeoutMs: guidedTrialTimeoutMs,
          remoteAssetsEnabled: import.meta.env.VITE_ALLOW_REMOTE_MODEL_ASSETS === "true",
          debugCursorEnabled: false,
        });
        guidedRef.current.beginCalibration(performance.now());
        guidedNeutralIndexRef.current = 0;
        setGuidedNeutralIndex(0);
        setGuidedResult(null);
        setDebugCursor(false);
      }
      const provider = createWebEyeTrackProvider(); providerRef.current = provider;
      await provider.initialize(videoRef.current!); provider.start(processObservation);
      setInputMode("camera"); setCalibrationIndex(0); setPhase("calibration");
    } catch (reason) {
      guidedRef.current?.failCalibration(performance.now());
      providerRef.current?.stop(); providerRef.current = null; setPhase("ready");
      setError(reason instanceof Error ? reason.message : "Não foi possível iniciar a câmera.");
    }
  };

  const startRecalibration = () => {
    if (viewMode !== "free" || inputMode !== "camera" || phase !== "board" || attemptActive || neutralActive) return;
    loggerRef.current.abortAttempt(performance.now());
    loggerRef.current.finishNeutralWindow(performance.now());
    providerRef.current?.stop();
    providerRef.current = null;
    loggerRef.current.setCalibrationId(null);
    resetDwell();
    setLastSelection(null);
    setAttemptActive(false);
    setNeutralActive(false);
    setDebugPoint(null);
    setObservationStatus("invalid");
    setCalibrationId(null);
    setCalibrationIndex(0);
    setViewportInvalid(false);
    setError(null);
    void startCamera();
  };

  const startPointerMode = () => {
    if (!viewportIsLandscape()) {
      setOrientationBlocked(true);
      setError("Vire o dispositivo para a horizontal antes de iniciar o modo de teste.");
      return;
    }
    setOrientationBlocked(false);
    setViewportInvalid(false);
    providerRef.current?.stop(); providerRef.current = null; setError(null); setInputMode("pointer");
    const id = `pointer-${Date.now()}`; loggerRef.current.setCalibrationId(id); setCalibrationId(id); setPhase("board");
  };

  const startGuidedMode = () => {
    clearGuidedTimer();
    guidedRef.current = null;
    setGuidedResult(null);
    setGuidedNeutralIndex(0);
    guidedNeutralIndexRef.current = 0;
    setDebugCursor(false);
    setViewMode("guided");
    setGuidedStage("preparation");
    setPhase("ready");
    setInputMode(null);
    setOrientationBlocked(!viewportIsLandscape());
    setViewportInvalid(false);
    setError(null);
  };

  const leaveGuidedPreparation = () => {
    guidedRef.current = null;
    setViewMode("free");
    setGuidedStage("preparation");
    setError(null);
  };

  const confirmCalibrationPoint = async (point: (typeof CALIBRATION_POINTS)[number], event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      const field = calibrationFieldRef.current;
      if (!field) throw new Error("O campo de calibração não está disponível.");
      const rect = field.getBoundingClientRect();
      const viewportPoint = normalizedPointInRectToViewport(
        point,
        { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        viewportFromWindow(),
      );
      if (!viewportPoint) throw new Error("Não foi possível mapear este ponto para o viewport atual.");
      await providerRef.current?.calibrate(viewportPoint);
      guidedRef.current?.recordCalibrationPoint();
      if (calibrationIndex === CALIBRATION_POINTS.length - 1) {
        const id = `webeyetrack-${Date.now()}`; loggerRef.current.setCalibrationId(id); setCalibrationId(id); setViewportInvalid(false); setPhase("board");
        if (guidedRef.current) {
          guidedRef.current.completeCalibration(id, performance.now());
          setGuidedStage("between");
          guidedPendingActionRef.current = "trial";
          scheduleGuidedAction("trial", GUIDED_DEFAULTS.interTrialNeutralMs);
        }
      } else setCalibrationIndex((index) => index + 1);
      setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível registrar este ponto."); }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (inputMode !== "pointer" || phase !== "board") return;
    processObservation({ sample: { x: event.clientX / window.innerWidth, y: event.clientY / window.innerHeight, timestampMs: performance.now() }, status: "valid" });
  };

  const handlePointerLeave = () => { if (inputMode === "pointer") processObservation(invalidObservation("invalid")); };
  const startAttempt = () => { resetDwell(); loggerRef.current.startAttempt(intendedTarget); setAttemptActive(true); setLastSelection(null); setMetrics(loggerRef.current.metrics()); };
  const timeoutAttempt = () => { loggerRef.current.finishAttemptAsTimeout(); resetDwell(); setAttemptActive(false); setMetrics(loggerRef.current.metrics()); };
  const toggleNeutral = () => {
    if (neutralActive) loggerRef.current.finishNeutralWindow(); else loggerRef.current.startNeutralWindow();
    setNeutralActive((active) => !active); setMetrics(loggerRef.current.metrics());
  };
  const exportSession = () => {
    const viewport = viewportFromWindow();
    const data = loggerRef.current.exportData({ ...viewport, orientation: viewport.height >= viewport.width ? "portrait" : "landscape" });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${data.sessionId}.json`; anchor.click(); URL.revokeObjectURL(url);
  };

  const exportGuidedSession = () => {
    const data = guidedResult ?? guidedRef.current?.exportData(guidedViewport());
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `gaze-aac-session-${data.sessionId}.json`; anchor.click(); URL.revokeObjectURL(url);
  };

  const guidedSession = guidedRef.current;
  const completedWarmup = guidedSession?.logger.attempts.filter((trial) => trial.phase === "warmup").length ?? 0;
  const completedMain = guidedSession?.logger.attempts.filter((trial) => trial.phase === "main").length ?? 0;
  const guidedProgress = guidedStage === "neutral"
    ? `Janelas neutras: ${guidedNeutralIndex + 1} / ${GUIDED_DEFAULTS.neutralWindowCount}`
    : guidedTrialPlan?.phase === "warmup"
      ? `Warm-up: ${guidedTrialPlan.sequenceIndex} / ${GUIDED_DEFAULTS.warmupPerTarget * 4}`
      : guidedSession?.warmupOnlyReady
        ? `Warm-up: ${GUIDED_DEFAULTS.warmupPerTarget * 4} / ${GUIDED_DEFAULTS.warmupPerTarget * 4}`
      : completedWarmup < GUIDED_DEFAULTS.warmupPerTarget * 4
        ? `Warm-up: ${completedWarmup + 1} / ${GUIDED_DEFAULTS.warmupPerTarget * 4}`
        : `Experimento: ${completedMain + (guidedTrialPlan?.phase === "main" ? 1 : 0)} / ${GUIDED_DEFAULTS.mainPerTarget * 4}`;

  return (
    <main className={`app-shell ${activeSession ? "active-session" : ""}`}>
      <video ref={videoRef} id="gaze-camera" autoPlay muted playsInline className="camera-source" aria-hidden="true" />
      <header className="app-header"><div><p className="eyebrow">experimento de comunicação</p><h1>Gaze AAC</h1></div><span className={`status-pill status-${observationStatus}`}>{statusText[observationStatus]}</span></header>
      {(phase === "ready" || phase === "loading") && <section className="setup-card" aria-live="polite">
        {viewMode === "guided" ? <>
          <p className="eyebrow">modo de experimento humano</p><h2>Experimento guiado</h2>
          <p>Calibração, 8 tentativas de aquecimento, 80 tentativas formais e 10 janelas neutras.</p>
          <dl className="preparation-details"><div><dt>provider</dt><dd>WebEyeTrack 0.0.2</dd></div><div><dt>dwell</dt><dd>{DEFAULT_DWELL_CONFIG.durationMs} ms</dd></div><div><dt>tolerância</dt><dd>{DEFAULT_DWELL_CONFIG.invalidToleranceMs} ms</dd></div><div><dt>cooldown</dt><dd>{DEFAULT_DWELL_CONFIG.cooldownMs} ms</dd></div><div><dt>viewport</dt><dd>{window.innerWidth} × {window.innerHeight}</dd></div><div><dt>DPR</dt><dd>{window.devicePixelRatio || 1}</dd></div><div><dt>orientação</dt><dd>{window.innerHeight >= window.innerWidth ? "portrait" : "landscape"}</dd></div><div><dt>data/hora</dt><dd>{new Date().toLocaleString("pt-BR")}</dd></div><div><dt>browser</dt><dd>{navigator.userAgent}</dd></div></dl>
          <label className="timeout-control">timeout por tentativa (ms)<input type="number" min="1000" step="500" value={guidedTrialTimeoutMs} onChange={(event) => setGuidedTrialTimeoutMs(Number(event.target.value))} disabled={phase === "loading"} /></label>
          <p className="experiment-warning">Este teste exige webcam real. O Codex não executa a avaliação física; uma pessoa deve seguir as instruções.</p>
          {orientationBlocked && <p className="orientation-message" role="alert">Vire o dispositivo para a horizontal antes de iniciar a calibração.</p>}
          <div className="setup-actions"><button className="primary-button" onClick={startCamera} disabled={phase === "loading" || orientationBlocked || !Number.isFinite(guidedTrialTimeoutMs) || guidedTrialTimeoutMs < 1000}>{phase === "loading" ? "Carregando…" : "Iniciar calibração"}</button><button className="secondary-button" onClick={leaveGuidedPreparation} disabled={phase === "loading"}>Voltar</button></div>
        </> : <>
          <h2>Pronto para começar</h2><p>Quatro palavras, alvos grandes e uma seleção por permanência do olhar.</p>
          {orientationBlocked && <p className="orientation-message" role="alert">Vire o dispositivo para a horizontal antes de iniciar uma sessão ativa.</p>}
          <div className="setup-actions"><button className="primary-button" onClick={startCamera} disabled={phase === "loading" || orientationBlocked}>{phase === "loading" ? "Carregando…" : "Iniciar modo livre"}</button><button className="secondary-button" onClick={startPointerMode} disabled={phase === "loading" || orientationBlocked}>Modo de teste por toque</button><button className="secondary-button" onClick={startGuidedMode} disabled={phase === "loading"}>Experimento guiado</button></div>
          <label className="debug-toggle"><input type="checkbox" checked={debugCursor} onChange={(event) => setDebugCursor(event.target.checked)} /> mostrar ponto de debug</label>
        </>}
        {error && <p className="error-message">{error}</p>}<p className="privacy-note">O vídeo não é salvo nem enviado. Os assets de modelo ainda exigem configuração local ou opt-in de desenvolvimento.</p>
      </section>}
      {phase === "calibration" && <section className="active-session-shell calibration-session" aria-live="polite">
        <div className="session-instruction calibration-copy">
          <p className="eyebrow">calibração {calibrationIndex + 1} de {CALIBRATION_POINTS.length}</p>
          <h2>Olhe para o ponto e confirme</h2>
          <p>Use o clique apenas para registrar o ponto depois que o olhar estiver estável.</p>
          <div className="session-actions"><button className="secondary-button compact" onClick={() => { setCalibrationIndex(0); setError(null); }}>Reiniciar pontos</button>{viewMode === "guided" && <button className="secondary-button compact" onClick={cancelGuidedSession}>Cancelar sessão</button>}</div>
          {error && <p className="error-message">{error}</p>}
        </div>
        <div ref={calibrationFieldRef} className="interaction-region calibration-field">
          <button className="calibration-dot" style={{ left: `${CALIBRATION_POINTS[calibrationIndex].x * 100}%`, top: `${CALIBRATION_POINTS[calibrationIndex].y * 100}%` }} onClick={(event) => confirmCalibrationPoint(CALIBRATION_POINTS[calibrationIndex], event)} aria-label={`Confirmar ponto ${calibrationIndex + 1}`} />
        </div>
      </section>}
      {phase === "board" && <section className="active-session-shell board-session">
        <div className="session-instruction">
          {viewMode === "guided" ? <div className="guided-panel" aria-live="polite">
            {guidedStage === "trial" && guidedTrialPlan && <><p className="eyebrow">{guidedProgress}</p><h2>OLHE PARA: {CONCEPTS.find((concept) => concept.id === guidedTrialPlan.intendedTarget)?.label}</h2><p>Permaneça olhando até a seleção ser confirmada.</p><button className="secondary-button compact" onClick={cancelGuidedSession}>Cancelar sessão</button></>}
            {guidedStage === "between" && <><p className="eyebrow">{guidedProgress}</p><h2>{guidedSession?.warmupOnlyReady ? "Aquecimento concluído" : "Prepare-se para a próxima etapa"}</h2><p>{guidedSession?.warmupOnlyReady ? "Você pode exportar somente o aquecimento ou continuar para o protocolo formal." : "Uma pausa curta separa as tentativas."}</p><div className="setup-actions">{guidedSession?.warmupOnlyReady && <><button className="primary-button" onClick={continueAfterWarmup}>Continuar protocolo formal</button><button className="secondary-button" onClick={finishWarmupOnly}>Exportar warm-up e encerrar</button></>}<button className="secondary-button" onClick={pauseGuidedSession}>Pausar</button><button className="secondary-button" onClick={cancelGuidedSession}>Cancelar sessão</button></div></>}
            {guidedStage === "paused" && <><p className="eyebrow">sessão pausada</p><h2>Quando estiver pronto, continue</h2><div className="setup-actions"><button className="primary-button" onClick={resumeGuidedSession}>Continuar</button><button className="secondary-button" onClick={cancelGuidedSession}>Cancelar sessão</button></div></>}
            {guidedStage === "neutral" && <><p className="eyebrow">{guidedProgress}</p><h2>Olhe naturalmente para a tela</h2><p>Não tente selecionar nenhuma opção.</p><button className="secondary-button compact" onClick={cancelGuidedSession}>Cancelar sessão</button></>}
            {(guidedStage === "complete" || guidedStage === "cancelled") && <><p className="eyebrow">{guidedStage === "complete" ? "sessão concluída" : "sessão parcial"}</p><h2>{guidedStage === "complete" ? "Experimento concluído" : "Sessão cancelada"}</h2><p>{guidedResult?.trials.length ?? 0} registros de tentativa e {guidedResult?.neutralWindows.length ?? 0} janelas neutras foram preservados.</p><button className="primary-button" onClick={exportGuidedSession}>Exportar JSON</button></>}
          </div> : <div className="experiment-toolbar"><div><p className="eyebrow">{inputMode === "camera" ? "WebEyeTrack" : "entrada local de teste"}</p><p className="toolbar-status">{calibrationId ? `calibração: ${calibrationId}` : "sem calibração"}</p></div><div className="toolbar-actions">
            <label className="intended-control">alvo pretendido<select value={intendedTarget} onChange={(event) => setIntendedTarget(event.target.value as ConceptId)}>{CONCEPTS.map((concept) => <option key={concept.id} value={concept.id}>{concept.label}</option>)}</select></label>
            <button className="secondary-button compact" onClick={startAttempt} disabled={attemptActive || neutralActive}>Iniciar tentativa</button><button className="secondary-button compact" onClick={timeoutAttempt} disabled={!attemptActive}>Timeout</button><button className={`secondary-button compact ${neutralActive ? "active" : ""}`} onClick={toggleNeutral} disabled={attemptActive}>{neutralActive ? "Encerrar neutra" : "Janela neutra"}</button><button className="secondary-button compact" onClick={startRecalibration} disabled={attemptActive || neutralActive}>Recalibrar</button><button className="secondary-button compact" onClick={exportSession}>Exportar JSON</button><label className="debug-toggle compact"><input type="checkbox" checked={debugCursor} onChange={(event) => setDebugCursor(event.target.checked)} /> debug</label>
          </div></div>}
        </div>
        <div className="interaction-region board" onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave}>{CONCEPTS.map((concept) => <button key={concept.id} ref={(element) => { targetRefs.current[concept.id] = element; }} className={`concept-target target-${concept.id} ${candidate === concept.id ? "is-candidate" : ""} ${lastSelection === concept.id ? "is-selected" : ""}`} aria-label={concept.label} onClick={(event) => event.preventDefault()}><span>{concept.label}</span>{candidate === concept.id && <span className="dwell-progress" style={{ transform: `scaleX(${dwellProgress})` }} aria-hidden="true" />}</button>)}{debugCursor && debugPoint && <span className="debug-cursor" style={{ left: `${debugPoint.x * 100}%`, top: `${debugPoint.y * 100}%` }} aria-hidden="true" />}</div>
        {viewMode === "free" && debugCursor && <dl className="debug-panel"><div><dt>target</dt><dd>{debugTarget ?? "—"}</dd></div><div><dt>dwell elapsed (ms)</dt><dd>{Math.round(debugElapsedMs)}</dd></div><div><dt>dwell duration (ms)</dt><dd>{DEFAULT_DWELL_CONFIG.durationMs}</dd></div><div><dt>progress</dt><dd>{dwellProgress.toFixed(3)}</dd></div><div><dt>sample timestamp (ms)</dt><dd>{debugSampleTimestampMs === null ? "—" : Math.round(debugSampleTimestampMs)}</dd></div><div><dt>current clock (ms)</dt><dd>{debugClockMs === null ? "—" : Math.round(debugClockMs)}</dd></div><div><dt>tracking status</dt><dd>{statusText[observationStatus]}</dd></div></dl>}
        <div className="session-footer">{viewMode === "guided" ? <>{guidedStage !== "complete" && guidedStage !== "cancelled" && <p className="selection-feedback" aria-live="polite">A seleção é registrada automaticamente.</p>}{guidedResult && <dl className="metrics-strip"><div><dt>tentativas</dt><dd>{guidedResult.trials.length}</dd></div><div><dt>acurácia</dt><dd>{guidedResult.metrics.targetAccuracy === null ? "—" : `${Math.round(guidedResult.metrics.targetAccuracy * 100)}%`}</dd></div><div><dt>falsas ativações</dt><dd>{guidedResult.metrics.falseActivationCount}</dd></div><div><dt>perda</dt><dd>{guidedResult.metrics.trackingLossRate === null ? "—" : `${Math.round(guidedResult.metrics.trackingLossRate * 100)}%`}</dd></div></dl>}</> : <><p className="selection-feedback" aria-live="polite">{lastSelection ? `Selecionado: ${CONCEPTS.find((concept) => concept.id === lastSelection)?.label}` : "A seleção aparecerá aqui."}</p><dl className="metrics-strip"><div><dt>acurácia</dt><dd>{metrics.targetAccuracy === null ? "—" : `${Math.round(metrics.targetAccuracy * 100)}%`}</dd></div><div><dt>erros</dt><dd>{metrics.wrongTargetCount}</dd></div><div><dt>timeouts</dt><dd>{metrics.timeoutCount}</dd></div><div><dt>perda</dt><dd>{metrics.trackingLossRate === null ? "—" : `${Math.round(metrics.trackingLossRate * 100)}%`}</dd></div></dl></>}</div>
      </section>}
      {activeSession && (orientationBlocked || viewportInvalid) && <div className="orientation-blocker" role="alert"><h2>{orientationBlocked ? "Vire o dispositivo para a horizontal" : "A tela mudou"}</h2><p>{orientationBlocked ? "A sessão só pode continuar no modo landscape." : "A calibração foi invalidada. Recalibre antes de continuar."}</p>{guidedResult && <button className="primary-button" onClick={exportGuidedSession}>Exportar sessão parcial</button>}</div>}
    </main>
  );
}

export default App;

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

const hotData = import.meta.hot?.data as { reactRoot?: ReturnType<typeof createRoot> } | undefined;
const reactRoot = hotData?.reactRoot ?? createRoot(root);
if (hotData) hotData.reactRoot = reactRoot;

reactRoot.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
