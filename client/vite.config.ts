import { defineConfig } from "vite";
import { zigPlugin } from "./vite-plugin-zig";

export default defineConfig({
  envDir: "..",
  envPrefix: ["VITE_", "CONVEX_URL"],
  // Relative, not absolute — the Vercel root deploy works identically either
  // way, but a portal-hosted zip (CrazyGames, Poki) usually isn't served
  // from true domain root, and "/assets/..." 404s the instant it's nested
  // under a subpath. Relative paths are correct at any depth.
  base: "./",
  // Treat .wasm as an asset so `import "./sim.wasm?url"` resolves to a
  // hashed URL in production and the dev server in development. The
  // zigPlugin rebuilds sim.wasm via `cd sim && zig build` whenever a
  // .zig source changes — see ADR-0006.
  assetsInclude: ["**/*.wasm"],
  plugins: [zigPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
  },
});
