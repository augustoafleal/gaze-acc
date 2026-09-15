export type EyeState = "open" | "closed" | "unavailable";

export type EyeObservation = {
  state: EyeState;
  timestampMs: number;
};

export type EyeProviderStartupStep = "compatibility" | "permission" | "camera" | "model" | "engine";

export type EyeProviderStartupStatus = {
  step: EyeProviderStartupStep;
  state: "active" | "ready" | "error";
  message: string;
};

export type EyeProviderStatusListener = (status: EyeProviderStartupStatus) => void;

export interface EyeStateProvider {
  readonly name: string;
  initialize(video: HTMLVideoElement, onStatus?: EyeProviderStatusListener): Promise<void>;
  start(listener: (observation: EyeObservation) => void): void;
  stop(): void;
}
