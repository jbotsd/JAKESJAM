import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SIM_DIR = resolve(__dirname, "..", "sim");

export function zigPlugin(): Plugin {
  let server: ViteDevServer | undefined;
  let building = false;
  let pending = false;

  const runBuild = async (): Promise<void> => {
    if (building) {
      pending = true;
      return;
    }
    building = true;
    await new Promise<void>((res) => {
      const proc = spawn("zig", ["build"], { cwd: SIM_DIR, stdio: "inherit" });
      proc.on("exit", (code) => {
        building = false;
        if (code !== 0) console.error(`[zig] build failed (code=${code})`);
        res();
      });
      proc.on("error", (err) => {
        building = false;
        console.error("[zig] spawn failed:", err.message);
        res();
      });
    });
    if (pending) {
      pending = false;
      await runBuild();
      return;
    }
    server?.ws.send({ type: "full-reload", path: "*" });
  };

  return {
    name: "vite-plugin-zig",
    configureServer(s) {
      server = s;
      s.watcher.add(resolve(SIM_DIR, "src"));
      s.watcher.add(resolve(SIM_DIR, "build.zig"));
      s.watcher.add(resolve(SIM_DIR, "build.zig.zon"));
      s.watcher.on("change", (path) => {
        if (
          path.startsWith(SIM_DIR) &&
          (path.endsWith(".zig") || path.endsWith(".zon"))
        ) {
          void runBuild();
        }
      });
    },
    async buildStart() {
      await runBuild();
    },
  };
}
