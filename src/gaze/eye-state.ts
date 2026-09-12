export function hasUsableFaceLandmarks(result: unknown): boolean {
  const landmarks = (result as { facialLandmarks?: unknown } | null)?.facialLandmarks;
  return Array.isArray(landmarks) && landmarks.length > 0 && landmarks.every((landmark) =>
    landmark !== null && typeof landmark === "object"
      && Number.isFinite((landmark as { x?: unknown }).x)
      && Number.isFinite((landmark as { y?: unknown }).y),
  );
}
