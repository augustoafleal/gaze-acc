import { WebcamClient, WebEyeTrackProxy } from "webeyetrack";
import type { GazeResult } from "webeyetrack";

import { webEyeTrackToNormalized } from "./mapping";
import type { CalibrationPoint, GazeProvider } from "./provider";
import { invalidObservation, type GazeObservation } from "./types";

const RECENT_SAMPLE_WINDOW_MS = 1_000;
const CAMERA_START_TIMEOUT_MS = 30_000;
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
  audio: false,
};

export type WebEyeTrackProviderOptions = {
  allowRemoteAssets?: boolean;
};

export class WebEyeTrackProvider implements GazeProvider {
  readonly name = "WebEyeTrack 0.0.2";

  private webcam: WebcamClient | null = null;
  private proxy: WebEyeTrackProxy | null = null;
  private listener: ((observation: GazeObservation) => void) | null = null;
  private lastValidTimestampMs: number | null = null;
  private calibrationPointCount = 0;
  private readonly allowRemoteAssets: boolean;

  constructor(options: WebEyeTrackProviderOptions = {}) {
    this.allowRemoteAssets = options.allowRemoteAssets ?? import.meta.env.VITE_ALLOW_REMOTE_MODEL_ASSETS === "true";
  }

  async initialize(video: HTMLVideoElement): Promise<void> {
    if (!this.allowRemoteAssets) {
      throw new Error(
        "WebEyeTrack requires model/WASM assets that are not self-hosted yet. Set VITE_ALLOW_REMOTE_MODEL_ASSETS=true only for development.",
      );
    }

    if (!video.id) {
      throw new Error("The WebEyeTrack video element must have a stable id.");
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("A câmera não está disponível neste contexto. Use localhost ou HTTPS e um navegador com suporte a getUserMedia.");
    }

    await this.verifyCameraAccess();

    this.webcam = new WebcamClient(video.id);
    this.proxy = new WebEyeTrackProxy(this.webcam);
    this.proxy.onGazeResults = (result) => this.handleResult(result);

    await this.waitForCameraStream(video);
  }

  private async verifyCameraAccess(): Promise<void> {
    let stream: MediaStream | null = null;
    try {
      // WebEyeTrack 0.0.2 starts its own stream only after its worker loads the model.
      // Preflight makes permission and device failures observable before calibration.
      stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
    } catch (reason) {
      const name = reason instanceof DOMException ? reason.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new Error("O acesso à câmera foi negado. Permita a câmera para este site e tente novamente.");
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        throw new Error("Nenhuma câmera frontal compatível foi encontrada neste dispositivo.");
      }
      if (name === "NotReadableError" || name === "AbortError") {
        throw new Error("A câmera está ocupada ou não pôde ser lida. Feche outros aplicativos que a estejam usando e tente novamente.");
      }
      throw new Error("Não foi possível acessar a câmera. Verifique a permissão e se existe uma webcam disponível.");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  private async waitForCameraStream(video: HTMLVideoElement): Promise<void> {
    const deadline = performance.now() + CAMERA_START_TIMEOUT_MS;

    while (performance.now() < deadline) {
      const stream = video.srcObject as MediaStream | null;
      const hasLiveVideo = stream?.getVideoTracks().some((track) => track.readyState === "live") ?? false;
      if (hasLiveVideo) return;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }

    throw new Error(
      "A câmera não iniciou. Permita o acesso à câmera, confirme que há uma webcam disponível e reinicie. Se o erro persistir, verifique o carregamento dos modelos locais/remotos.",
    );
  }

  start(listener: (observation: GazeObservation) => void): void {
    if (!this.proxy) {
      throw new Error("WebEyeTrack must be initialized before start.");
    }
    this.listener = listener;
  }

  stop(): void {
    this.webcam?.stopWebcam();

    const proxyInternals = this.proxy as unknown as { worker?: Worker } | null;
    proxyInternals?.worker?.terminate();
    this.listener = null;
    this.proxy = null;
    this.webcam = null;
    this.lastValidTimestampMs = null;
  }

  async calibrate(point: CalibrationPoint): Promise<void> {
    if (!this.proxy) {
      throw new Error("WebEyeTrack must be initialized before calibration.");
    }

    const now = performance.now();
    if (this.lastValidTimestampMs === null || now - this.lastValidTimestampMs > RECENT_SAMPLE_WINDOW_MS) {
      throw new Error("No recent valid gaze sample. Ask the user to look at the point before confirming it.");
    }

    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
      throw new Error("Calibration point must be normalized to the current viewport.");
    }

    const event = new MouseEvent("click", {
      bubbles: false,
      clientX: point.x * window.innerWidth,
      clientY: point.y * window.innerHeight,
    });
    window.dispatchEvent(event);
    this.calibrationPointCount += 1;
  }

  private handleResult(result: GazeResult): void {
    try {
      if (!result || typeof result !== "object") {
        this.listener?.(invalidObservation("error"));
        return;
      }

      const landmarks = result.facialLandmarks;

      if (!Array.isArray(landmarks) || landmarks.length === 0) {
        this.listener?.(invalidObservation("no-face"));
        return;
      }

      if (result.gazeState !== "open") {
        this.listener?.(invalidObservation("eyes-closed"));
        return;
      }

      const point = webEyeTrackToNormalized(result.normPog);
      if (!point) {
        this.listener?.(invalidObservation("invalid"));
        return;
      }

      // WebEyeTrack receives video.currentTime in seconds. Only expose the
      // application's monotonic clock beyond this adapter.
      const timestampMs = performance.now();
      this.lastValidTimestampMs = timestampMs;
      this.listener?.({ sample: { ...point, timestampMs }, status: "valid" });
    } catch {
      this.listener?.(invalidObservation("error"));
    }
  }
}
