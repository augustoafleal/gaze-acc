import type {
  EyeObservation,
  EyeProviderStartupStatus,
  EyeProviderStatusListener,
  EyeStateProvider,
} from "./eye-types";

const CAMERA_START_TIMEOUT_MS = 20_000;
const ENGINE_START_TIMEOUT_MS = 45_000;
const MIN_FRAME_INTERVAL_MS = 50;
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: { ideal: "user" } },
  audio: false,
};
const DEFAULT_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

type WorkerMessage =
  | { type: "engine-loading" }
  | { type: "ready" }
  | { type: "fatal"; message: string }
  | { type: "frame-error"; message: string; timestampMs: number }
  | { type: "observation"; state: EyeObservation["state"]; timestampMs: number };

export type MediaPipeBlinkProviderOptions = {
  modelUrl?: string;
  wasmBaseUrl?: string;
};

function humanFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

function reasonName(reason: unknown): string {
  return typeof reason === "object" && reason !== null && "name" in reason ? String(reason.name) : "";
}

function cameraError(reason: unknown): Error {
  const name = reasonName(reason);
  if (name === "NotAllowedError" || name === "SecurityError") {
    if (!window.isSecureContext) {
      return new Error("A câmera exige uma página segura. Abra o endereço por HTTPS e tente novamente.");
    }
    return new Error("O navegador ou o Android bloqueou a câmera para este site. Revise a permissão do site e tente novamente.");
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return new Error("Nenhuma câmera compatível foi encontrada. Verifique se a câmera frontal está disponível no Android.");
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return new Error("A câmera foi autorizada, mas o aparelho não conseguiu abri-la. Feche outros apps que usam a câmera e reinicie o navegador.");
  }
  return new Error("O navegador não conseguiu abrir a câmera neste aparelho.");
}

export class MediaPipeBlinkProvider implements EyeStateProvider {
  readonly name = "MediaPipe Face Landmarker 0.10.18 blink";

  private readonly modelUrl: string;
  private readonly wasmBaseUrl: string;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private listener: ((observation: EyeObservation) => void) | null = null;
  private onStatus: EyeProviderStatusListener | null = null;
  private animationFrame: number | null = null;
  private frameInFlight = false;
  private lastFrameAt = 0;
  private consecutiveFrameErrors = 0;
  private stopped = false;

  constructor(options: MediaPipeBlinkProviderOptions = {}) {
    const base = import.meta.env.BASE_URL;
    const configuredModelUrl = import.meta.env.VITE_FACE_LANDMARKER_MODEL_URL?.trim();
    this.modelUrl = options.modelUrl ?? (configuredModelUrl || DEFAULT_MODEL_URL);
    this.wasmBaseUrl = options.wasmBaseUrl ?? new URL(`${base}mediapipe/wasm`, window.location.origin).toString();
  }

  async initialize(video: HTMLVideoElement, onStatus?: EyeProviderStatusListener): Promise<void> {
    this.video = video;
    this.onStatus = onStatus ?? null;
    this.stopped = false;

    try {
      this.report("compatibility", "active", "Verificando o navegador…");
      this.verifyCompatibility();
      this.report("compatibility", "ready", "Navegador compatível");

      this.report("permission", "active", "Aguardando a permissão da câmera…");
      this.stream = await this.openCamera();
      this.report("permission", "ready", "Permissão concedida");

      this.report("camera", "active", "Abrindo a câmera frontal…");
      await this.attachCamera(video, this.stream);
      const settings = this.stream.getVideoTracks()[0]?.getSettings();
      const dimensions = settings?.width && settings?.height ? ` (${settings.width}×${settings.height})` : "";
      this.report("camera", "ready", `Câmera transmitindo${dimensions}`);

      const modelBuffer = await this.downloadModel();
      await this.initializeEngine(modelBuffer);
    } catch (reason) {
      this.stop();
      throw reason instanceof Error ? reason : new Error(String(reason));
    }
  }

  start(listener: (observation: EyeObservation) => void): void {
    if (!this.worker || !this.video || !this.stream) throw new Error("O detector deve ser inicializado antes de começar.");
    this.listener = listener;
    this.scheduleFrame();
  }

  stop(): void {
    this.stopped = true;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.worker?.postMessage({ type: "close" });
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
    this.listener = null;
    this.onStatus = null;
    this.frameInFlight = false;
    this.consecutiveFrameErrors = 0;
  }

  private report(step: EyeProviderStartupStatus["step"], state: EyeProviderStartupStatus["state"], message: string): void {
    this.onStatus?.({ step, state, message });
  }

  private verifyCompatibility(): void {
    if (!window.isSecureContext) {
      this.report("compatibility", "error", "A página não está em HTTPS");
      throw new Error("A câmera só funciona em HTTPS (ou localhost). Abra o endereço seguro da aplicação.");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.report("compatibility", "error", "getUserMedia indisponível");
      throw new Error("Este navegador não oferece acesso à câmera para esta página. Atualize-o ou use outro navegador.");
    }
    if (typeof Worker === "undefined" || typeof WebAssembly === "undefined" || typeof createImageBitmap === "undefined") {
      this.report("compatibility", "error", "Recursos de processamento local indisponíveis");
      throw new Error("Este navegador não possui os recursos necessários para processar a câmera localmente.");
    }
  }

  private openCamera(): Promise<MediaStream> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        settled = true;
        this.report("permission", "error", "O navegador não respondeu ao pedido de câmera");
        reject(new Error("A solicitação da câmera não foi concluída. Confirme a permissão no navegador e tente novamente."));
      }, CAMERA_START_TIMEOUT_MS);

      navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS).then((stream) => {
        if (settled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        resolve(stream);
      }, (reason) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        const error = cameraError(reason);
        this.report("permission", "error", error.message);
        reject(error);
      });
    });
  }

  private async attachCamera(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
    video.srcObject = stream;
    try {
      const firstFrame = new Promise<void>((resolve, reject) => {
        const ready = () => {
          if (video.videoWidth === 0) return;
          window.clearTimeout(timeout);
          video.removeEventListener("loadeddata", ready);
          resolve();
        };
        const timeout = window.setTimeout(() => {
          video.removeEventListener("loadeddata", ready);
          reject(new Error("A câmera abriu, mas não entregou nenhum quadro de vídeo em 10 segundos."));
        }, 10_000);
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) ready();
        else video.addEventListener("loadeddata", ready);
      });
      await Promise.all([video.play(), firstFrame]);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      this.report("camera", "error", message);
      throw new Error(`A câmera foi autorizada, mas o vídeo não começou: ${message}`);
    }

    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (this.stopped) return;
      this.report("camera", "error", "A transmissão da câmera foi encerrada pelo sistema");
      this.listener?.({ state: "unavailable", timestampMs: performance.now() });
    }, { once: true });
  }

  private async downloadModel(): Promise<ArrayBuffer> {
    this.report("model", "active", "Baixando o modelo de detecção…");
    let response: Response;
    try {
      response = await fetch(this.modelUrl, { cache: "force-cache" });
    } catch {
      this.report("model", "error", "Falha de rede ao baixar o modelo");
      throw new Error("A câmera abriu, mas o modelo de detecção não pôde ser baixado. Verifique a conexão e recarregue a página.");
    }
    if (!response.ok) {
      this.report("model", "error", `Modelo indisponível (HTTP ${response.status})`);
      throw new Error(`O arquivo do modelo não está disponível (HTTP ${response.status}).`);
    }

    const total = Number(response.headers.get("content-length")) || 0;
    const reader = response.body?.getReader();
    if (!reader) {
      const buffer = await response.arrayBuffer();
      this.report("model", "ready", `Modelo baixado (${humanFileSize(buffer.byteLength)})`);
      return buffer;
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    let lastPercent = -1;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      const percent = total > 0 ? Math.floor((received / total) * 100) : -1;
      if (percent !== lastPercent && (percent < 0 || percent % 5 === 0)) {
        lastPercent = percent;
        this.report("model", "active", percent >= 0 ? `Baixando o modelo… ${percent}%` : `Baixando o modelo… ${humanFileSize(received)}`);
      }
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.report("model", "ready", `Modelo baixado (${humanFileSize(received)})`);
    return bytes.buffer;
  }

  private initializeEngine(modelBuffer: ArrayBuffer): Promise<void> {
    this.report("engine", "active", "Preparando o detector no aparelho…");
    this.worker = new Worker(new URL("./mediapipe-blink.worker.ts", import.meta.url), { type: "module" });

    return new Promise((resolve, reject) => {
      const worker = this.worker!;
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        this.report("engine", "error", "O detector demorou demais para iniciar");
        reject(new Error("O modelo foi baixado, mas o detector não iniciou neste aparelho. Tente fechar outras abas ou reiniciar o navegador."));
      }, ENGINE_START_TIMEOUT_MS);

      const fail = (message: string) => {
        this.report("engine", "error", message);
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error(`O modelo foi baixado, mas não pôde ser executado neste aparelho: ${message}`));
        } else {
          this.listener?.({ state: "unavailable", timestampMs: performance.now() });
        }
      };

      worker.onerror = (event) => fail(event.message || "falha interna do processador local");
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type === "fatal") {
          fail(message.message);
          return;
        }
        if (message.type === "ready") {
          if (!settled) {
            settled = true;
            window.clearTimeout(timeout);
            this.report("engine", "ready", "Detector pronto (processamento local)");
            resolve();
          }
          return;
        }
        if (message.type === "observation") {
          this.frameInFlight = false;
          this.consecutiveFrameErrors = 0;
          this.listener?.({ state: message.state, timestampMs: message.timestampMs });
          return;
        }
        if (message.type === "frame-error") {
          this.handleFrameFailure(`Falha ao processar os quadros da câmera: ${message.message}`, message.timestampMs);
        }
      };

      worker.postMessage({ type: "init", wasmBaseUrl: this.wasmBaseUrl, modelBuffer }, [modelBuffer]);
    });
  }

  private scheduleFrame(): void {
    const tick = async (now: number) => {
      if (this.stopped || !this.video || !this.worker) return;
      this.animationFrame = requestAnimationFrame(tick);
      if (this.frameInFlight || now - this.lastFrameAt < MIN_FRAME_INTERVAL_MS || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

      this.frameInFlight = true;
      this.lastFrameAt = now;
      try {
        const frame = await createImageBitmap(this.video);
        if (this.stopped || !this.worker) {
          frame.close();
          this.frameInFlight = false;
          return;
        }
        this.worker.postMessage({ type: "frame", frame, timestampMs: performance.now() }, [frame]);
      } catch {
        this.handleFrameFailure("O navegador não conseguiu enviar os quadros da câmera ao detector.", performance.now());
      }
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  private handleFrameFailure(message: string, timestampMs: number): void {
    this.frameInFlight = false;
    this.consecutiveFrameErrors += 1;
    if (this.consecutiveFrameErrors === 3) this.report("engine", "error", message);
    this.listener?.({ state: "unavailable", timestampMs });
  }
}

/** @deprecated Prefer MediaPipeBlinkProvider. Kept for callers of the old factory. */
export const WebEyeTrackBlinkProvider = MediaPipeBlinkProvider;
