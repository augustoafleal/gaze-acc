import { describe, expect, it } from "vitest";

import { normalizedPointInRectToViewport, normalizedToViewportCss, orientationForViewport, pointInCssRect, webEyeTrackToNormalized } from "./mapping";

describe("WebEyeTrack mapping", () => {
  it("maps the centered origin to the normalized center", () => {
    expect(webEyeTrackToNormalized([0, 0])).toEqual({ x: 0.5, y: 0.5 });
  });

  it("preserves top-left, top-right, bottom-left and bottom-right", () => {
    expect(webEyeTrackToNormalized([-0.5, -0.5])).toEqual({ x: 0, y: 0 });
    expect(webEyeTrackToNormalized([0.5, -0.5])).toEqual({ x: 1, y: 0 });
    expect(webEyeTrackToNormalized([-0.5, 0.5])).toEqual({ x: 0, y: 1 });
    expect(webEyeTrackToNormalized([0.5, 0.5])).toEqual({ x: 1, y: 1 });
  });

  it("rejects non-finite and out-of-domain values", () => {
    expect(webEyeTrackToNormalized([Number.NaN, 0])).toBeNull();
    expect(webEyeTrackToNormalized([-0.51, 0])).toBeNull();
    expect(webEyeTrackToNormalized([0, 0.51])).toBeNull();
    expect(webEyeTrackToNormalized([0])).toBeNull();
  });

  it("hit-tests CSS viewport rectangles without DPR scaling", () => {
    expect(pointInCssRect({ x: 100, y: 100 }, { left: 0, top: 0, right: 200, bottom: 200 })).toBe(true);
    expect(pointInCssRect({ x: 201, y: 100 }, { left: 0, top: 0, right: 200, bottom: 200 })).toBe(false);
    expect(normalizedToViewportCss({ x: 1, y: 1 }, { width: 800, height: 600, dpr: 2 })).toEqual({ x: 800, y: 600 });
  });

  it("maps a calibration field point into viewport coordinates", () => {
    expect(normalizedPointInRectToViewport(
      { x: 0.5, y: 0.5 },
      { left: 100, top: 80, right: 900, bottom: 680 },
      { width: 1000, height: 800, dpr: 1 },
    )).toEqual({ x: 0.5, y: 0.475 });
  });

  it("uses landscape as the required active-session orientation", () => {
    expect(orientationForViewport({ width: 844, height: 390 })).toBe("landscape");
    expect(orientationForViewport({ width: 390, height: 844 })).toBe("portrait");
  });

  it("maps points from the fixed interaction region without applying DPR twice", () => {
    const viewport = { width: 844, height: 390, dpr: 2 };
    const interactionRegion = { left: 0, top: 144, right: 844, bottom: 354 };
    expect(normalizedPointInRectToViewport({ x: 0, y: 0 }, interactionRegion, viewport)).toEqual({ x: 0, y: 144 / 390 });
    expect(normalizedPointInRectToViewport({ x: 1, y: 1 }, interactionRegion, viewport)).toEqual({ x: 1, y: 354 / 390 });
  });
});
