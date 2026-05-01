import { defineConfig } from "vite";

export default defineConfig({
  envDir: "..",
  envPrefix: ["VITE_", "CONVEX_URL"],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
  },
});
