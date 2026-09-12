export type GazeSample = {
  x: number;
  y: number;
  timestampMs: number;
};

export type GazeStatus = "valid" | "no-face" | "eyes-closed" | "invalid" | "error";

export type GazeObservation = {
  sample: GazeSample | null;
  status: GazeStatus;
  /** Monotonic application time for invalid observations as well as valid samples. */
  timestampMs?: number;
};

export function invalidObservation(
  status: Exclude<GazeStatus, "valid">,
  timestampMs = performance.now(),
): GazeObservation {
  return { sample: null, status, timestampMs };
}
