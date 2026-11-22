import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Strict CSP for production builds only (the dev server needs inline scripts
 * for React refresh). Remote scripts are never allowed; images only from
 * Data Dragon; connections only to the local Hub.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "img-src 'self' data: https://ddragon.leagueoflegends.com",
  "connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

const cspPlugin: Plugin = {
  name: "lol-viewer-csp",
  apply: "build",
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
  ],
};

export default defineConfig({
  plugins: [react(), cspPlugin],
  // Relative asset paths so the same build loads from file:// in Electron
  // and from any sub-path on a static PR preview host.
  base: "./",
  server: { fs: { allow: ["../.."] } },
  build: { outDir: "dist", emptyOutDir: true },
});
