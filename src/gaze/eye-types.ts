export type EyeState = "open" | "closed" | "unavailable";

export type EyeObservation = {
  state: EyeState;
  timestampMs: number;
};

export interface EyeStateProvider {
  readonly name: string;
  initialize(video: HTMLVideoElement): Promise<void>;
  start(listener: (observation: EyeObservation) => void): void;
  stop(): void;
}
