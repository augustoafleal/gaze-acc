import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

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

export default defineConfig(({ mode }) => {
  const { VITE_BASE_PATH } = loadEnv(mode, process.cwd(), "VITE_");
  const base = normalizeBasePath(VITE_BASE_PATH);

  return {
    base,
    plugins: [react(), webEyeTrackModelPathPlugin(base)],
    server: {
      // Quick Tunnel hostnames change on every run; keep this scoped to the
      // Cloudflare development domain instead of allowing arbitrary hosts.
      allowedHosts: [".trycloudflare.com"],
    },
  };
});
