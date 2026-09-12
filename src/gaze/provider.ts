import type { GazeObservation } from "./types";

export type CalibrationPoint = {
  x: number;
  y: number;
};

export interface GazeProvider {
  readonly name: string;
  initialize(video: HTMLVideoElement): Promise<void>;
  start(listener: (observation: GazeObservation) => void): void;
  stop(): void;
  calibrate(point: CalibrationPoint): Promise<void>;
}
