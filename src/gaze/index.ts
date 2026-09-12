import { WebEyeTrackProvider } from "./webeyetrack-provider";

export function createWebEyeTrackProvider(): WebEyeTrackProvider {
  return new WebEyeTrackProvider();
}

export type { GazeProvider } from "./provider";
export type { GazeObservation, GazeSample, GazeStatus } from "./types";
