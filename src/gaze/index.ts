import { WebEyeTrackProvider } from "./webeyetrack-provider";
import { WebEyeTrackBlinkProvider } from "./blink-provider";

export function createWebEyeTrackProvider(): WebEyeTrackProvider {
  return new WebEyeTrackProvider();
}

export function createWebEyeTrackBlinkProvider(): WebEyeTrackBlinkProvider {
  return new WebEyeTrackBlinkProvider();
}

export type { GazeProvider } from "./provider";
export type { GazeObservation, GazeSample, GazeStatus } from "./types";
export type { EyeObservation, EyeState, EyeStateProvider } from "./eye-types";
