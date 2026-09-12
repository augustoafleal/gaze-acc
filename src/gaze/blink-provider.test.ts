import { describe, expect, it } from "vitest";

import { hasUsableFaceLandmarks } from "./eye-state";
import type { GazeResult } from "webeyetrack";

const result = (facialLandmarks: unknown) => ({ facialLandmarks } as GazeResult);

describe("WebEyeTrack blink face evidence", () => {
  it("requires non-empty finite facial landmarks before accepting eye state", () => {
    expect(hasUsableFaceLandmarks(result([]))).toBe(false);
    expect(hasUsableFaceLandmarks(result([{ x: Number.NaN, y: 0 }]))).toBe(false);
    expect(hasUsableFaceLandmarks(result([{ x: 0.2, y: 0.3 }]))).toBe(true);
  });
});
