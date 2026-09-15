const EYE_CLOSED_THRESHOLD = 0.2;
const LEFT_EYE = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE = [133, 158, 160, 33, 144, 153];

let faceLandmarker = null;
let mediaPipe = null;

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeAspectRatio(landmarks, indices) {
  const [outer, upperOuter, upperInner, inner, lowerInner, lowerOuter] = indices.map((index) => landmarks[index]);
  if (!outer || !upperOuter || !upperInner || !inner || !lowerInner || !lowerOuter) return null;
  const width = distance(outer, inner);
  if (!Number.isFinite(width) || width <= 0) return null;
  return (distance(upperOuter, lowerOuter) + distance(upperInner, lowerInner)) / (2 * width);
}

function classifyEyes(landmarks) {
  const left = eyeAspectRatio(landmarks, LEFT_EYE);
  const right = eyeAspectRatio(landmarks, RIGHT_EYE);
  if (left === null || right === null) return "unavailable";

  // Keep the threshold used by WebEyeTrack 0.0.2 so changing the startup
  // pipeline does not also change the gesture semantics.
  return left < EYE_CLOSED_THRESHOLD || right < EYE_CLOSED_THRESHOLD ? "closed" : "open";
}

function errorMessage(reason) {
  return reason instanceof Error ? reason.message : String(reason);
}

function loadMediaPipe(visionBundleUrl) {
  if (mediaPipe) return mediaPipe;
  // vision_bundle.cjs writes its public API to the global `exports` object.
  // Loading it with importScripts is valid because this file is always served
  // to a classic worker, in both Vite development and production builds.
  globalThis.exports = {};
  globalThis.importScripts(visionBundleUrl);
  mediaPipe = globalThis.exports;
  if (!mediaPipe.FaceLandmarker || !mediaPipe.FilesetResolver) {
    throw new Error("A biblioteca local do detector facial não foi carregada corretamente.");
  }
  return mediaPipe;
}

globalThis.onmessage = async (event) => {
  const message = event.data;

  if (message.type === "init") {
    try {
      globalThis.postMessage({ type: "engine-loading" });
      const { FaceLandmarker, FilesetResolver } = loadMediaPipe(message.visionBundleUrl);
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
      globalThis.postMessage({ type: "ready" });
    } catch (reason) {
      globalThis.postMessage({ type: "fatal", message: errorMessage(reason) });
    }
    return;
  }

  if (message.type === "close") {
    faceLandmarker?.close();
    faceLandmarker = null;
    globalThis.close();
    return;
  }

  try {
    if (!faceLandmarker) throw new Error("O detector facial ainda não está pronto.");
    const result = faceLandmarker.detectForVideo(message.frame, message.timestampMs);
    const landmarks = result.faceLandmarks[0];
    const state = landmarks ? classifyEyes(landmarks) : "unavailable";
    globalThis.postMessage({ type: "observation", state, timestampMs: message.timestampMs });
  } catch (reason) {
    globalThis.postMessage({ type: "frame-error", message: errorMessage(reason), timestampMs: message.timestampMs });
  } finally {
    message.frame.close();
  }
};
