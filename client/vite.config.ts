import { defineConfig } from "vite";
import { zigPlugin } from "./vite-plugin-zig";

export default defineConfig({
  envDir: "..",
  envPrefix: ["VITE_", "CONVEX_URL"],
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
