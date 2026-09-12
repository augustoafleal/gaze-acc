import type { GazeSample } from "./types";

export type NormalizedPoint = {
  x: number;
  y: number;
};

export type Viewport = {
  width: number;
  height: number;
  dpr: number;
};

export type CssRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isNormalizedPoint(point: NormalizedPoint): boolean {
  return (
    finite(point.x) &&
    finite(point.y) &&
    point.x >= 0 &&
    point.x <= 1 &&
    point.y >= 0 &&
    point.y <= 1
  );
}

export function webEyeTrackToNormalized(value: unknown): NormalizedPoint | null {
  if (!Array.isArray(value) || value.length !== 2 || !finite(value[0]) || !finite(value[1])) {
    return null;
  }

  const [x, y] = value;
  if (x < -0.5 || x > 0.5 || y < -0.5 || y > 0.5) {
    return null;
  }

  const point = { x: x + 0.5, y: y + 0.5 };
  return isNormalizedPoint(point) ? point : null;
}

export function normalizedToViewportCss(point: NormalizedPoint, viewport: Viewport): NormalizedPoint {
  return { x: point.x * viewport.width, y: point.y * viewport.height };
}

export function normalizedPointInRectToViewport(
  point: NormalizedPoint,
  rect: CssRect,
  viewport: Viewport,
): NormalizedPoint | null {
  if (!isNormalizedPoint(point) || rect.right <= rect.left || rect.bottom <= rect.top || viewport.width <= 0 || viewport.height <= 0) {
    return null;
  }

  return {
    x: (rect.left + point.x * (rect.right - rect.left)) / viewport.width,
    y: (rect.top + point.y * (rect.bottom - rect.top)) / viewport.height,
  };
}

export function sampleToViewportCss(sample: GazeSample, viewport: Viewport): NormalizedPoint {
  return normalizedToViewportCss(sample, viewport);
}

export function pointInCssRect(point: NormalizedPoint, rect: CssRect): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

export function viewportFromWindow(): Viewport {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
  };
}

export function orientationForViewport(viewport: Pick<Viewport, "width" | "height">): "portrait" | "landscape" {
  return viewport.height >= viewport.width ? "portrait" : "landscape";
}
