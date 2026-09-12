import { useCallback, useEffect, useRef, useState } from "react";

import { CONCEPTS, type ConceptId } from "../communication/concepts";
import { ExperimentLogger } from "../communication/experiment";
import { BlinkNavigationController } from "../communication/blink-navigation";
import {
  GUIDED_DEFAULTS,
  GuidedExperimentSession,
  type GuidedExport,
} from "../communication/guided-experiment";
import type { ExperimentMetrics } from "../communication/metrics";
import {
  BlinkGestureDetector,
  DEFAULT_BLINK_CONFIG,
  type BlinkConfig,
  type BlinkDiagnosticEvent,
} from "../gaze/blink-gesture";
import { DEFAULT_DWELL_CONFIG, DwellController } from "../gaze/dwell";
import { createWebEyeTrackBlinkProvider, createWebEyeTrackProvider, type EyeObservation, type EyeStateProvider, type GazeProvider } from "../gaze";
import { normalizedPointInRectToViewport, normalizedToViewportCss, orientationForViewport, pointInCssRect, viewportFromWindow } from "../gaze/mapping";
import { invalidObservation, type GazeObservation } from "../gaze/types";
import { speak } from "../speech/tts";

const CALIBRATION_POINTS = [
  { x: 0.15, y: 0.15 }, { x: 0.5, y: 0.15 }, { x: 0.85, y: 0.15 },
  { x: 0.15, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.85, y: 0.5 },
  { x: 0.15, y: 0.85 }, { x: 0.5, y: 0.85 }, { x: 0.85, y: 0.85 },
] as const;

const BLINK_TRAINING_STEPS = [
  "Inicie uma piscada curta.",
  "Faça duas piscadas curtas.",
  "Mantenha os olhos fechados por mais tempo.",
] as const;

type Phase = "ready" | "loading" | "calibration" | "board";
type InputMode = "camera" | "pointer";
type ViewMode = "free" | "guided" | "blink";
type GuidedStage = "preparation" | "between" | "trial" | "neutral" | "paused" | "complete" | "cancelled";
type BlinkStage = "training" | "navigation";

function viewportIsLandscape(): boolean {
  return orientationForViewport(viewportFromWindow()) === "landscape";
}

function isValidBlinkConfig(config: BlinkConfig): boolean {
  return Number.isFinite(config.minIntentionalBlinkMs) && config.minIntentionalBlinkMs > 0
    && Number.isFinite(config.longBlinkThresholdMs) && config.longBlinkThresholdMs > config.minIntentionalBlinkMs
    && Number.isFinite(config.doubleBlinkWindowMs) && config.doubleBlinkWindowMs > 0
    && Number.isFinite(config.cooldownMs) && config.cooldownMs >= 0
    && Number.isFinite(config.stateStabilityMs) && config.stateStabilityMs >= 0;
}

const APPLICATION_VERSION = "0.1.0";

const statusText: Record<GazeObservation["status"], string> = {
  valid: "tracking ativo", "no-face": "rosto não encontrado", "eyes-closed": "olhos fechados",
  invalid: "amostra inválida", error: "erro de tracking",
};

export function GazeAACApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const calibrationFieldRef = useRef<HTMLDivElement>(null);
  const providerRef = useRef<GazeProvider | null>(null);
  const blinkProviderRef = useRef<EyeStateProvider | null>(null);
  const blinkDetectorRef = useRef(new BlinkGestureDetector(DEFAULT_BLINK_CONFIG));
  const blinkNavigationRef = useRef(new BlinkNavigationController());
  const blinkStageRef = useRef<BlinkStage>("training");
  const blinkConfigRef = useRef<BlinkConfig>(DEFAULT_BLINK_CONFIG);
  const blinkEventsRef = useRef<BlinkDiagnosticEvent[]>([]);
  const blinkSessionIdRef = useRef<string | null>(null);
  const blinkStartedAtRef = useRef<string | null>(null);
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
  const [blinkStage, setBlinkStageState] = useState<BlinkStage>("training");
  const [blinkTrainingStep, setBlinkTrainingStep] = useState(0);
  const [blinkConfig, setBlinkConfig] = useState<BlinkConfig>(DEFAULT_BLINK_CONFIG);
  const [blinkDebug, setBlinkDebug] = useState(false);
  const [blinkEyeState, setBlinkEyeState] = useState<EyeObservation["state"]>("unavailable");
  const [blinkDetectorState, setBlinkDetectorState] = useState<string>("unavailable");
  const [blinkLastGesture, setBlinkLastGesture] = useState<string | null>(null);
  const [blinkLastClosedDurationMs, setBlinkLastClosedDurationMs] = useState<number | null>(null);
  const [blinkFirstBlinkDurationMs, setBlinkFirstBlinkDurationMs] = useState<number | null>(null);
  const [blinkFirstBlinkCompletedAtMs, setBlinkFirstBlinkCompletedAtMs] = useState<number | null>(null);
  const [blinkDoubleWindowDeadlineMs, setBlinkDoubleWindowDeadlineMs] = useState<number | null>(null);
  const [blinkDoubleRemainingMs, setBlinkDoubleRemainingMs] = useState<number | null>(null);
  const [blinkSecondBlinkStartedAtMs, setBlinkSecondBlinkStartedAtMs] = useState<number | null>(null);
  const [blinkSecondBlinkInProgress, setBlinkSecondBlinkInProgress] = useState(false);
  const [blinkCurrentClosedDurationMs, setBlinkCurrentClosedDurationMs] = useState<number | null>(null);
  const [blinkPendingShort, setBlinkPendingShort] = useState(false);
  const [blinkCooldownRemainingMs, setBlinkCooldownRemainingMs] = useState(0);
  const [blinkFocusedTarget, setBlinkFocusedTarget] = useState<ConceptId>("sim");
  const [blinkFeedback, setBlinkFeedback] = useState("Treinamento de piscadas ativo.");
  const [blinkEventCount, setBlinkEventCount] = useState(0);
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

  const activeSession = phase === "calibration" || (phase === "board" && (inputMode !== null || viewMode === "guided"));

  const setViewMode = (next: ViewMode) => {
    guidedViewRef.current = next;
    setViewModeState(next);
  };

  const setGuidedStage = (next: GuidedStage) => {
    guidedStageRef.current = next;
    setGuidedStageState(next);
  };

  const setBlinkStage = (next: BlinkStage) => {
    blinkStageRef.current = next;
    setBlinkStageState(next);
  };

  const stopBlinkProvider = () => {
    blinkProviderRef.current?.stop();
    blinkProviderRef.current = null;
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

  const processBlinkObservation = useCallback((observation: EyeObservation) => {
    setBlinkEyeState(observation.state);
    const update = blinkDetectorRef.current.update(observation.state, observation.timestampMs);
    const snapshot = blinkDetectorRef.current.snapshot(observation.timestampMs);
    setBlinkDetectorState(snapshot.detectorState);
    setBlinkLastClosedDurationMs(snapshot.lastClosedDurationMs);
    setBlinkFirstBlinkDurationMs(snapshot.firstBlinkDurationMs);
    setBlinkFirstBlinkCompletedAtMs(snapshot.firstBlinkCompletedAtMs);
    setBlinkDoubleWindowDeadlineMs(snapshot.doubleWindowDeadlineMs);
    setBlinkDoubleRemainingMs(snapshot.doubleBlinkRemainingMs);
    setBlinkSecondBlinkStartedAtMs(snapshot.secondBlinkStartedAtMs);
    setBlinkSecondBlinkInProgress(snapshot.secondBlinkInProgress);
    setBlinkCurrentClosedDurationMs(snapshot.currentClosedDurationMs);
    setBlinkPendingShort(snapshot.pendingShort);
    setBlinkCooldownRemainingMs(snapshot.cooldownRemainingMs);

    if (update.diagnostics.length > 0) {
      blinkEventsRef.current.push(...update.diagnostics);
      setBlinkEventCount(blinkEventsRef.current.length);
    }

    for (const gesture of update.gestures) {
      setBlinkLastGesture(gesture.gesture);
      setBlinkLastClosedDurationMs(gesture.closedDurationMs);
      if (blinkStageRef.current !== "navigation") {
        setBlinkFeedback(`${gesture.gesture} reconhecido (${Math.round(gesture.closedDurationMs)} ms).`);
        continue;
      }

      const event = blinkNavigationRef.current.handleGesture(gesture.gesture);
      setBlinkFocusedTarget(event.target);
      if (event.command === "select") {
        setLastSelection(event.target);
        setBlinkFeedback(`Selecionado: ${CONCEPTS.find((concept) => concept.id === event.target)?.label ?? event.target}`);
        speak(CONCEPTS.find((concept) => concept.id === event.target)?.speech ?? event.target);
      } else {
        setBlinkFeedback(`${event.command === "next" ? "Próximo" : "Anterior"}: ${CONCEPTS.find((concept) => concept.id === event.target)?.label ?? event.target}`);
      }
    }

    const finalSnapshot = blinkDetectorRef.current.snapshot(observation.timestampMs);
    setBlinkDetectorState(finalSnapshot.detectorState);
    setBlinkFirstBlinkDurationMs(finalSnapshot.firstBlinkDurationMs);
    setBlinkFirstBlinkCompletedAtMs(finalSnapshot.firstBlinkCompletedAtMs);
    setBlinkDoubleWindowDeadlineMs(finalSnapshot.doubleWindowDeadlineMs);
    setBlinkDoubleRemainingMs(finalSnapshot.doubleBlinkRemainingMs);
    setBlinkSecondBlinkStartedAtMs(finalSnapshot.secondBlinkStartedAtMs);
    setBlinkSecondBlinkInProgress(finalSnapshot.secondBlinkInProgress);
    setBlinkCurrentClosedDurationMs(finalSnapshot.currentClosedDurationMs);
    setBlinkLastClosedDurationMs(finalSnapshot.lastClosedDurationMs);
    setBlinkPendingShort(finalSnapshot.pendingShort);
    setBlinkCooldownRemainingMs(finalSnapshot.cooldownRemainingMs);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV || !new URLSearchParams(window.location.search).has("blinkSynthetic")) return;
    const handleSyntheticObservation = (event: Event) => {
      const observation = (event as CustomEvent<EyeObservation>).detail;
      if (!observation || !["open", "closed", "unavailable"].includes(observation.state) || !Number.isFinite(observation.timestampMs)) return;
      processBlinkObservation(observation);
    };
    window.addEventListener("gaze-aac:blink-eye-state", handleSyntheticObservation);
    return () => window.removeEventListener("gaze-aac:blink-eye-state", handleSyntheticObservation);
  }, [processBlinkObservation]);

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
    const resetDwellOnViewportChange = () => {
      if (phase === "board" || phase === "calibration") resetDwell();
    };
    window.addEventListener("resize", resetDwellOnViewportChange);
    window.addEventListener("orientationchange", resetDwellOnViewportChange);
    return () => {
      window.removeEventListener("resize", resetDwellOnViewportChange);
      window.removeEventListener("orientationchange", resetDwellOnViewportChange);
    };
  // A viewport change is handled without interrupting the active session.
  }, [phase]);

  useEffect(() => () => {
    clearGuidedTimer();
    providerRef.current?.stop();
    providerRef.current = null;
    stopBlinkProvider();
  // Unmount cleanup intentionally reads the current provider/session refs.
  }, []);

  const startCamera = async () => {
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

  const startBlinkCamera = async () => {
    setPhase("loading"); setError(null);
    const provider = createWebEyeTrackBlinkProvider();
    blinkProviderRef.current = provider;
    blinkConfigRef.current = { ...blinkConfig };
    blinkDetectorRef.current = new BlinkGestureDetector(blinkConfigRef.current);
    blinkNavigationRef.current = new BlinkNavigationController();
    blinkEventsRef.current = [];
    blinkSessionIdRef.current = `blink-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    blinkStartedAtRef.current = new Date().toISOString();
    setBlinkEventCount(0);
    setBlinkEyeState("unavailable");
    setBlinkDetectorState("unavailable");
    setBlinkLastGesture(null);
    setBlinkLastClosedDurationMs(null);
    setBlinkFirstBlinkDurationMs(null);
    setBlinkFirstBlinkCompletedAtMs(null);
    setBlinkDoubleWindowDeadlineMs(null);
    setBlinkDoubleRemainingMs(null);
    setBlinkSecondBlinkStartedAtMs(null);
    setBlinkSecondBlinkInProgress(false);
    setBlinkCurrentClosedDurationMs(null);
    setBlinkPendingShort(false);
    setBlinkCooldownRemainingMs(0);
    setBlinkFocusedTarget("sim");
    setLastSelection(null);
    setBlinkFeedback("Treinamento de piscadas ativo.");
    setBlinkStage("training");
    setBlinkTrainingStep(0);
    try {
      await provider.initialize(videoRef.current!);
      provider.start(processBlinkObservation);
      setInputMode("camera");
      setPhase("board");
    } catch (reason) {
      stopBlinkProvider();
      setPhase("ready"); setInputMode(null);
      setError(reason instanceof Error ? reason.message : "Não foi possível iniciar o modo blink.");
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
    setError(null);
    void startCamera();
  };

  const startPointerMode = () => {
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
    setError(null);
  };

  const startBlinkMode = () => {
    clearGuidedTimer();
    guidedRef.current = null;
    setViewMode("blink");
    setBlinkStage("training");
    setBlinkTrainingStep(0);
    setBlinkDebug(false);
    setPhase("ready");
    setInputMode(null);
    setError(null);
  };

  const leaveGuidedPreparation = () => {
    guidedRef.current = null;
    setViewMode("free");
    setGuidedStage("preparation");
    setError(null);
  };

  const leaveBlinkPreparation = () => {
    setViewMode("free");
    setBlinkStage("training");
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
        const id = `webeyetrack-${Date.now()}`; loggerRef.current.setCalibrationId(id); setCalibrationId(id); setPhase("board");
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

  const exportBlinkDiagnostics = () => {
    if (!blinkSessionIdRef.current || !blinkStartedAtRef.current) return;
    const data = {
      schemaVersion: "blink-2.0",
      sessionId: blinkSessionIdRef.current,
      startedAt: blinkStartedAtRef.current,
      finishedAt: new Date().toISOString(),
      provider: "WebEyeTrack",
      providerVersion: "0.0.2",
      browser: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      dpr: window.devicePixelRatio || 1,
      orientation: viewportIsLandscape() ? "landscape" : "portrait",
      debugEnabled: blinkDebug,
      config: { ...blinkConfigRef.current },
      events: [...blinkEventsRef.current],
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `gaze-aac-blink-${data.sessionId}.json`; anchor.click(); URL.revokeObjectURL(url);
  };

  const leaveBlinkMode = () => {
    stopBlinkProvider();
    setPhase("ready"); setInputMode(null); setViewMode("free"); setError(null);
    setBlinkEyeState("unavailable");
  };

  const advanceBlinkTraining = () => {
    if (blinkStageRef.current !== "training") return;
    if (blinkTrainingStep < BLINK_TRAINING_STEPS.length - 1) {
      setBlinkTrainingStep((step) => step + 1);
      setBlinkFeedback("Aguardando o próximo gesto.");
      return;
    }
    blinkDetectorRef.current = new BlinkGestureDetector(blinkConfigRef.current);
    setBlinkStage("navigation");
    setBlinkFeedback("Navegação ativa. SIM é o item inicial.");
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
          <div className="setup-actions"><button className="primary-button" onClick={startCamera} disabled={phase === "loading" || !Number.isFinite(guidedTrialTimeoutMs) || guidedTrialTimeoutMs < 1000}>{phase === "loading" ? "Carregando…" : "Iniciar calibração"}</button><button className="secondary-button" onClick={leaveGuidedPreparation} disabled={phase === "loading"}>Voltar</button></div>
        </> : viewMode === "blink" ? <>
          <p className="eyebrow">modo blink experimental</p><h2>Navegação por piscadas</h2>
          <p>Sem calibração espacial: uma piscada curta avança, duas piscadas voltam e uma piscada longa seleciona.</p>
          <dl className="preparation-details"><div><dt>provider</dt><dd>WebEyeTrack 0.0.2</dd></div><div><dt>calibração</dt><dd>não utilizada</dd></div><div><dt>mínimo intencional</dt><dd>{blinkConfig.minIntentionalBlinkMs} ms</dd></div><div><dt>limiar longo</dt><dd>{blinkConfig.longBlinkThresholdMs} ms</dd></div><div><dt>janela dupla</dt><dd>{blinkConfig.doubleBlinkWindowMs} ms</dd></div><div><dt>re-arm</dt><dd>{blinkConfig.cooldownMs} ms</dd></div></dl>
          <div className="blink-config-grid"><label>mínimo intencional (ms)<input type="number" min="1" value={blinkConfig.minIntentionalBlinkMs} onChange={(event) => setBlinkConfig((current) => ({ ...current, minIntentionalBlinkMs: Number(event.target.value) }))} /></label><label>limiar de piscada longa (ms)<input type="number" min="1" value={blinkConfig.longBlinkThresholdMs} onChange={(event) => setBlinkConfig((current) => ({ ...current, longBlinkThresholdMs: Number(event.target.value) }))} /></label><label>janela de piscada dupla (ms)<input type="number" min="1" value={blinkConfig.doubleBlinkWindowMs} onChange={(event) => setBlinkConfig((current) => ({ ...current, doubleBlinkWindowMs: Number(event.target.value) }))} /></label><label>re-arm após seleção (ms)<input type="number" min="0" value={blinkConfig.cooldownMs} onChange={(event) => setBlinkConfig((current) => ({ ...current, cooldownMs: Number(event.target.value) }))} /></label><label>estabilidade de estado (ms)<input type="number" min="0" value={blinkConfig.stateStabilityMs} onChange={(event) => setBlinkConfig((current) => ({ ...current, stateStabilityMs: Number(event.target.value) }))} title="Tempo mínimo de consistência para aceitar uma transição aberto/fechado; 0 desativa a estabilização." /></label></div>
          <label className="debug-toggle"><input type="checkbox" checked={blinkDebug} onChange={(event) => setBlinkDebug(event.target.checked)} /> mostrar diagnóstico de piscadas</label>
          <p className="experiment-warning">Os limiares são experimentais e ainda não foram validados empiricamente. Use uma webcam real e mantenha o rosto visível.</p>
          <div className="setup-actions"><button className="primary-button" onClick={startBlinkCamera} disabled={phase === "loading" || !isValidBlinkConfig(blinkConfig)}>Iniciar câmera e treinamento</button><button className="secondary-button" onClick={leaveBlinkPreparation} disabled={phase === "loading"}>Voltar</button></div>
        </> : <>
          <h2>Pronto para começar</h2><p>Quatro palavras, alvos grandes e uma seleção por permanência do olhar.</p>
          <div className="setup-actions"><button className="primary-button" onClick={startCamera} disabled={phase === "loading"}>{phase === "loading" ? "Carregando…" : "Iniciar modo livre"}</button><button className="secondary-button" onClick={startPointerMode} disabled={phase === "loading"}>Modo de teste por toque</button><button className="secondary-button" onClick={startGuidedMode} disabled={phase === "loading"}>Experimento guiado</button><button className="secondary-button" onClick={startBlinkMode} disabled={phase === "loading"}>Modo blink</button></div>
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
          </div> : viewMode === "blink" ? <div className="guided-panel blink-panel" aria-live="polite">
            {blinkStage === "training" ? <><p className="eyebrow">treinamento de piscadas · etapa {blinkTrainingStep + 1} de {BLINK_TRAINING_STEPS.length}</p><h2>{BLINK_TRAINING_STEPS[blinkTrainingStep]}</h2><p>O sistema registra a duração observada, sem assumir que o gesto foi correto.</p><div className="setup-actions"><button className="primary-button" onClick={advanceBlinkTraining}>{blinkTrainingStep === BLINK_TRAINING_STEPS.length - 1 ? "Ativar navegação" : "Próxima etapa"}</button><button className="secondary-button" onClick={exportBlinkDiagnostics}>Exportar diagnóstico</button><button className="secondary-button" onClick={leaveBlinkMode}>Sair</button></div></> : <><p className="eyebrow">navegação por piscadas</p><h2>Foco: {CONCEPTS.find((concept) => concept.id === blinkFocusedTarget)?.label}</h2><p>Piscada curta: próximo · duas curtas: anterior · piscada longa: selecionar.</p><div className="setup-actions"><button className="secondary-button" onClick={exportBlinkDiagnostics}>Exportar diagnóstico</button><button className="secondary-button" onClick={leaveBlinkMode}>Sair do modo blink</button></div></>}
          </div> : <div className="experiment-toolbar"><div><p className="eyebrow">{inputMode === "camera" ? "WebEyeTrack" : "entrada local de teste"}</p><p className="toolbar-status">{calibrationId ? `calibração: ${calibrationId}` : "sem calibração"}</p></div><div className="toolbar-actions">
            <label className="intended-control">alvo pretendido<select value={intendedTarget} onChange={(event) => setIntendedTarget(event.target.value as ConceptId)}>{CONCEPTS.map((concept) => <option key={concept.id} value={concept.id}>{concept.label}</option>)}</select></label>
            <button className="secondary-button compact" onClick={startAttempt} disabled={attemptActive || neutralActive}>Iniciar tentativa</button><button className="secondary-button compact" onClick={timeoutAttempt} disabled={!attemptActive}>Timeout</button><button className={`secondary-button compact ${neutralActive ? "active" : ""}`} onClick={toggleNeutral} disabled={attemptActive}>{neutralActive ? "Encerrar neutra" : "Janela neutra"}</button><button className="secondary-button compact" onClick={startRecalibration} disabled={attemptActive || neutralActive}>Recalibrar</button><button className="secondary-button compact" onClick={exportSession}>Exportar JSON</button><label className="debug-toggle compact"><input type="checkbox" checked={debugCursor} onChange={(event) => setDebugCursor(event.target.checked)} /> debug</label>
          </div></div>}
        </div>
        <div className="interaction-region board" onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave}>{CONCEPTS.map((concept) => <button key={concept.id} ref={(element) => { targetRefs.current[concept.id] = element; }} className={`concept-target target-${concept.id} ${candidate === concept.id ? "is-candidate" : ""} ${lastSelection === concept.id ? "is-selected" : ""} ${viewMode === "blink" && blinkFocusedTarget === concept.id ? "is-blink-focused" : ""}`} aria-label={concept.label} onClick={(event) => event.preventDefault()}><span>{concept.label}</span>{viewMode === "blink" && blinkFocusedTarget === concept.id && <span className="blink-focus-indicator" aria-hidden="true">foco</span>}{candidate === concept.id && <span className="dwell-progress" style={{ transform: `scaleX(${dwellProgress})` }} aria-hidden="true" />}</button>)}{debugCursor && debugPoint && <span className="debug-cursor" style={{ left: `${debugPoint.x * 100}%`, top: `${debugPoint.y * 100}%` }} aria-hidden="true" />}</div>
        {viewMode === "free" && debugCursor && <dl className="debug-panel"><div><dt>target</dt><dd>{debugTarget ?? "—"}</dd></div><div><dt>dwell elapsed (ms)</dt><dd>{Math.round(debugElapsedMs)}</dd></div><div><dt>dwell duration (ms)</dt><dd>{DEFAULT_DWELL_CONFIG.durationMs}</dd></div><div><dt>progress</dt><dd>{dwellProgress.toFixed(3)}</dd></div><div><dt>sample timestamp (ms)</dt><dd>{debugSampleTimestampMs === null ? "—" : Math.round(debugSampleTimestampMs)}</dd></div><div><dt>current clock (ms)</dt><dd>{debugClockMs === null ? "—" : Math.round(debugClockMs)}</dd></div><div><dt>tracking status</dt><dd>{statusText[observationStatus]}</dd></div></dl>}
        {viewMode === "blink" && blinkDebug && <dl className="debug-panel blink-debug-panel"><div><dt>eye state</dt><dd>{blinkEyeState}</dd></div><div><dt>detector state</dt><dd>{blinkDetectorState}</dd></div><div><dt>last closed (ms)</dt><dd>{blinkLastClosedDurationMs === null ? "—" : Math.round(blinkLastClosedDurationMs)}</dd></div><div><dt>last gesture</dt><dd>{blinkLastGesture ?? "—"}</dd></div><div><dt>pendente 1ª curta</dt><dd>{blinkPendingShort ? "sim" : "não"}</dd></div><div><dt>1ª piscada duração (ms)</dt><dd>{blinkFirstBlinkDurationMs === null ? "—" : Math.round(blinkFirstBlinkDurationMs)}</dd></div><div><dt>1ª piscada concluída em (ms)</dt><dd>{blinkFirstBlinkCompletedAtMs === null ? "—" : Math.round(blinkFirstBlinkCompletedAtMs)}</dd></div><div><dt>deadline da janela (ms)</dt><dd>{blinkDoubleWindowDeadlineMs === null ? "—" : Math.round(blinkDoubleWindowDeadlineMs)}</dd></div><div><dt>janela dupla restante (ms)</dt><dd>{blinkDoubleRemainingMs === null ? "—" : Math.round(blinkDoubleRemainingMs)}</dd></div><div><dt>2ª piscada iniciada em (ms)</dt><dd>{blinkSecondBlinkStartedAtMs === null ? "—" : Math.round(blinkSecondBlinkStartedAtMs)}</dd></div><div><dt>2ª piscada em progresso</dt><dd>{blinkSecondBlinkInProgress ? "sim" : "não"}</dd></div><div><dt>fechamento atual (ms)</dt><dd>{blinkCurrentClosedDurationMs === null ? "—" : Math.round(blinkCurrentClosedDurationMs)}</dd></div><div><dt>cooldown (ms)</dt><dd>{Math.round(blinkCooldownRemainingMs)}</dd></div><div><dt>min / long / estabilidade (ms)</dt><dd>{blinkConfigRef.current.minIntentionalBlinkMs} / {blinkConfigRef.current.longBlinkThresholdMs} / {blinkConfigRef.current.stateStabilityMs}</dd></div><div><dt>tracking</dt><dd>{blinkEyeState === "unavailable" ? "indisponível" : "disponível"}</dd></div></dl>}
        <div className="session-footer">{viewMode === "guided" ? <>{guidedStage !== "complete" && guidedStage !== "cancelled" && <p className="selection-feedback" aria-live="polite">A seleção é registrada automaticamente.</p>}{guidedResult && <dl className="metrics-strip"><div><dt>tentativas</dt><dd>{guidedResult.trials.length}</dd></div><div><dt>acurácia</dt><dd>{guidedResult.metrics.targetAccuracy === null ? "—" : `${Math.round(guidedResult.metrics.targetAccuracy * 100)}%`}</dd></div><div><dt>falsas ativações</dt><dd>{guidedResult.metrics.falseActivationCount}</dd></div><div><dt>perda</dt><dd>{guidedResult.metrics.trackingLossRate === null ? "—" : `${Math.round(guidedResult.metrics.trackingLossRate * 100)}%`}</dd></div></dl>}</> : viewMode === "blink" ? <p className="selection-feedback" aria-live="polite">{blinkFeedback} · {blinkEventCount} evento(s) diagnóstico(s)</p> : <><p className="selection-feedback" aria-live="polite">{lastSelection ? `Selecionado: ${CONCEPTS.find((concept) => concept.id === lastSelection)?.label}` : "A seleção aparecerá aqui."}</p><dl className="metrics-strip"><div><dt>acurácia</dt><dd>{metrics.targetAccuracy === null ? "—" : `${Math.round(metrics.targetAccuracy * 100)}%`}</dd></div><div><dt>erros</dt><dd>{metrics.wrongTargetCount}</dd></div><div><dt>timeouts</dt><dd>{metrics.timeoutCount}</dd></div><div><dt>perda</dt><dd>{metrics.trackingLossRate === null ? "—" : `${Math.round(metrics.trackingLossRate * 100)}%`}</dd></div></dl></>}</div>
      </section>}
    </main>
  );
}