/// <reference lib="webworker" />

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

const EYE_CLOSED_THRESHOLD = 0.2;
const LEFT_EYE = [362, 385, 387, 263, 373, 380] as const;
const RIGHT_EYE = [133, 158, 160, 33, 144, 153] as const;

type InitMessage = {
  type: "init";
  wasmBaseUrl: string;
  modelBuffer: ArrayBuffer;
};

type FrameMessage = {
  type: "frame";
  frame: ImageBitmap;
  timestampMs: number;
};

type IncomingMessage = InitMessage | FrameMessage | { type: "close" };

let faceLandmarker: FaceLandmarker | null = null;

function distance(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeAspectRatio(landmarks: NormalizedLandmark[], indices: readonly number[]): number | null {
  const [outer, upperOuter, upperInner, inner, lowerInner, lowerOuter] = indices.map((index) => landmarks[index]);
  if (!outer || !upperOuter || !upperInner || !inner || !lowerInner || !lowerOuter) return null;
  const width = distance(outer, inner);
  if (!Number.isFinite(width) || width <= 0) return null;
  return (distance(upperOuter, lowerOuter) + distance(upperInner, lowerInner)) / (2 * width);
}

function classifyEyes(landmarks: NormalizedLandmark[]): "open" | "closed" | "unavailable" {
  const left = eyeAspectRatio(landmarks, LEFT_EYE);
  const right = eyeAspectRatio(landmarks, RIGHT_EYE);
  if (left === null || right === null) return "unavailable";

  // Keep the threshold used by WebEyeTrack 0.0.2 so changing the startup
  // pipeline does not also change the gesture semantics.
  return left < EYE_CLOSED_THRESHOLD || right < EYE_CLOSED_THRESHOLD ? "closed" : "open";
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;

  if (message.type === "init") {
    try {
      self.postMessage({ type: "engine-loading" });
      const fileset = await FilesetResolver.forVisionTasks(message.wasmBaseUrl);
      faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetBuffer: new Uint8Array(message.modelBuffer),
          // CPU/WASM is slower than GPU on some devices, but is substantially
          // more portable across Android browsers and runs off the UI thread.
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      self.postMessage({ type: "ready" });
    } catch (reason) {
      self.postMessage({ type: "fatal", message: errorMessage(reason) });
    }
    return;
  }

  if (message.type === "close") {
    faceLandmarker?.close();
    faceLandmarker = null;
    self.close();
    return;
  }

  try {
    if (!faceLandmarker) throw new Error("O detector facial ainda não está pronto.");
    const result = faceLandmarker.detectForVideo(message.frame, message.timestampMs);
    const landmarks = result.faceLandmarks[0];
    const state = landmarks ? classifyEyes(landmarks) : "unavailable";
    self.postMessage({ type: "observation", state, timestampMs: message.timestampMs });
  } catch (reason) {
    self.postMessage({ type: "frame-error", message: errorMessage(reason), timestampMs: message.timestampMs });
  } finally {
    message.frame.close();
  }
};

export {};
