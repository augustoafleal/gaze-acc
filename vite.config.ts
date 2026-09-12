import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Quick Tunnel hostnames change on every run; keep this scoped to the
    // Cloudflare development domain instead of allowing arbitrary hosts.
    allowedHosts: [".trycloudflare.com"],
  },
});
