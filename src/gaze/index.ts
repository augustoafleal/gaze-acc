import { WebEyeTrackProvider } from "./webeyetrack-provider";
import { MediaPipeBlinkProvider } from "./blink-provider";

export function createWebEyeTrackProvider(): WebEyeTrackProvider {
  return new WebEyeTrackProvider();
}

export function createMediaPipeBlinkProvider(): MediaPipeBlinkProvider {
  return new MediaPipeBlinkProvider();
}

export function createWebEyeTrackBlinkProvider(): MediaPipeBlinkProvider {
  return createMediaPipeBlinkProvider();
}

export type { GazeProvider } from "./provider";
export type { GazeObservation, GazeSample, GazeStatus } from "./types";
export type { EyeObservation, EyeProviderStartupStatus, EyeState, EyeStateProvider } from "./eye-types";
