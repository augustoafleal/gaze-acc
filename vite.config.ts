import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function normalizeBasePath(value: string | undefined): string {
  const basePath = value?.trim() || "/";
  if (!basePath.startsWith("/")) {
    throw new Error("VITE_BASE_PATH must start with '/'.");
  }
  return basePath.endsWith("/") ? basePath : `${basePath}/`;
}

function webEyeTrackModelPathPlugin(base: string): Plugin {
  const packagePath = "/node_modules/webeyetrack/dist/index.js";
  const upstreamRootPath = "/web/model.json";
  const configuredPath = `${base}web/model.json`;

  return {
    name: "webeyetrack-model-path",
    transform(code, id) {
      if (!id.endsWith(packagePath)) return null;
      if (configuredPath === upstreamRootPath) return null;

      const transformed = code.replaceAll(upstreamRootPath, configuredPath);
      if (transformed === code) {
        this.error("webeyetrack@0.0.2 no longer exposes its model URL in the expected form; audit its Pages asset path before building.");
      }
      return { code: transformed, map: null };
    },
  };
}

const MEDIAPIPE_WASM_FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
] as const;

const MEDIAPIPE_SCRIPT_FILES = {
  "blink-worker.js": resolve(process.cwd(), "src/gaze/mediapipe-blink.worker.classic.js"),
  "vision_bundle.js": resolve(process.cwd(), "node_modules/@mediapipe/tasks-vision/vision_bundle.cjs"),
} as const;

function mediapipeWasmAssetsPlugin(base: string): Plugin {
  const sourceDirectory = resolve(process.cwd(), "node_modules/@mediapipe/tasks-vision/wasm");
  const publicPrefix = `${base}mediapipe/wasm/`;
  let isBuild = false;

  return {
    name: "mediapipe-wasm-assets",
    configResolved(config) {
      isBuild = config.command === "build";
    },
    buildStart() {
      if (!isBuild) return;
      for (const filename of MEDIAPIPE_WASM_FILES) {
        this.emitFile({
          type: "asset",
          fileName: `mediapipe/wasm/${filename}`,
          source: readFileSync(resolve(sourceDirectory, filename)),
        });
      }
      for (const [filename, sourcePath] of Object.entries(MEDIAPIPE_SCRIPT_FILES)) {
        this.emitFile({
          type: "asset",
          fileName: `mediapipe/${filename}`,
          source: readFileSync(sourcePath),
        });
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?", 1)[0] ?? "";
        const filename = MEDIAPIPE_WASM_FILES.find((candidate) =>
          pathname === `${publicPrefix}${candidate}` || pathname === `/mediapipe/wasm/${candidate}`,
        );
        if (filename) {
          response.statusCode = 200;
          response.setHeader("Content-Type", filename.endsWith(".wasm") ? "application/wasm" : "text/javascript; charset=utf-8");
          response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          response.end(readFileSync(resolve(sourceDirectory, filename)));
          return;
        }
        const scriptEntry = Object.entries(MEDIAPIPE_SCRIPT_FILES).find(([candidate]) =>
          pathname === `${base}mediapipe/${candidate}` || pathname === `/mediapipe/${candidate}`,
        );
        if (!scriptEntry) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/javascript; charset=utf-8");
        response.setHeader("Cache-Control", "no-cache");
        response.end(readFileSync(scriptEntry[1]));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const { VITE_BASE_PATH } = loadEnv(mode, process.cwd(), "VITE_");
  const base = normalizeBasePath(VITE_BASE_PATH);

  return {
    base,
    plugins: [react(), webEyeTrackModelPathPlugin(base), mediapipeWasmAssetsPlugin(base)],
    server: {
      // Quick Tunnel hostnames change on every run; keep this scoped to the
      // Cloudflare development domain instead of allowing arbitrary hosts.
      allowedHosts: [".trycloudflare.com"],
    },
  };
});
