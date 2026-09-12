import { WebcamClient, WebEyeTrackProxy } from "webeyetrack";
import type { GazeResult } from "webeyetrack";

import type { EyeObservation, EyeState, EyeStateProvider } from "./eye-types";
import { hasUsableFaceLandmarks } from "./eye-state";

const CAMERA_START_TIMEOUT_MS = 30_000;
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
  audio: false,
};

export type WebEyeTrackBlinkProviderOptions = {
  allowRemoteAssets?: boolean;
};

function unavailable(timestampMs: number): EyeObservation {
  return { state: "unavailable", timestampMs };
}

export class WebEyeTrackBlinkProvider implements EyeStateProvider {
  readonly name = "WebEyeTrack 0.0.2 blink";

  private webcam: WebcamClient | null = null;
  private proxy: WebEyeTrackProxy | null = null;
  private listener: ((observation: EyeObservation) => void) | null = null;
  private readonly allowRemoteAssets: boolean;

  constructor(options: WebEyeTrackBlinkProviderOptions = {}) {
    this.allowRemoteAssets = options.allowRemoteAssets ?? (import.meta.env.DEV || import.meta.env.VITE_ALLOW_REMOTE_MODEL_ASSETS === "true");
  }

  async initialize(video: HTMLVideoElement): Promise<void> {
    if (!this.allowRemoteAssets) {
      throw new Error(
        "WebEyeTrack requires model/WASM assets that are not self-hosted yet. Set VITE_ALLOW_REMOTE_MODEL_ASSETS=true only for development.",
      );
    }
    if (!video.id) throw new Error("The WebEyeTrack video element must have a stable id.");
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
      if (stream?.getVideoTracks().some((track) => track.readyState === "live")) return;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    throw new Error("A câmera não iniciou. Permita o acesso à câmera, confirme que há uma webcam disponível e reinicie.");
  }

  start(listener: (observation: EyeObservation) => void): void {
    if (!this.proxy) throw new Error("WebEyeTrack must be initialized before start.");
    this.listener = listener;
  }

  stop(): void {
    this.webcam?.stopWebcam();
    const proxyInternals = this.proxy as unknown as { worker?: Worker } | null;
    proxyInternals?.worker?.terminate();
    this.listener = null;
    this.proxy = null;
    this.webcam = null;
  }

  private handleResult(result: GazeResult): void {
    const timestampMs = performance.now();
    try {
      if (!result || !hasUsableFaceLandmarks(result)) {
        this.listener?.(unavailable(timestampMs));
        return;
      }

      let state: EyeState;
      if (result.gazeState === "open") state = "open";
      else if (result.gazeState === "closed") state = "closed";
      else state = "unavailable";
      this.listener?.({ state, timestampMs });
    } catch {
      this.listener?.(unavailable(timestampMs));
    }
  }
}
