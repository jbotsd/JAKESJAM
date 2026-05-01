import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "client", "dist");
const outputDir = path.join(rootDir, "standalone");
const sourceHtmlPath = path.join(distDir, "index.html");

const sourceHtml = await readFile(sourceHtmlPath, "utf8");
const scriptMatch = sourceHtml.match(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/);
const stylesheetMatch = sourceHtml.match(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/);

if (!scriptMatch || !stylesheetMatch) {
  throw new Error("Could not find built JS/CSS assets in client/dist/index.html.");
}

const scriptPath = resolveDistAsset(scriptMatch[1]);
const stylesheetPath = resolveDistAsset(stylesheetMatch[1]);
const [scriptSource, stylesheetSource] = await Promise.all([
  readFile(scriptPath, "utf8"),
  readFile(stylesheetPath, "utf8"),
]);
const inlineScriptSource = scriptSource.replace(/<\/script/gi, "<\\/script");

await mkdir(outputDir, { recursive: true });
await cp(path.join(distDir, "audio"), path.join(outputDir, "audio"), {
  recursive: true,
  force: true,
});

for (const role of ["host", "player"]) {
  const title = role === "host" ? "JAKESJAM Host" : "JAKESJAM Player";
  const runtimeConfig = [
    `window.__JAKESJAM_DEFAULT_ROLE__ = "${role}";`,
    `window.__JAKESJAM_CONVEX_URL__ = location.protocol.startsWith("http") && location.hostname ? location.protocol + "//" + location.hostname + ":3210" : "http://127.0.0.1:3210";`,
    `window.__JAKESJAM_ASSET_BASE__ = new URL("./", location.href).toString();`,
  ].join("\n");

  const html = sourceHtml
    .replace("<title>JAKESJAM</title>", `<title>${title}</title>`)
    .replace(
      stylesheetMatch[0],
      () => `<style>\n${stylesheetSource}\n</style>`,
    )
    .replace(scriptMatch[0], "")
    .replace(
      "</body>",
      () => `    <script>\n${runtimeConfig}\n</script>\n    <script type="module">\n${inlineScriptSource}\n</script>\n  </body>`,
    )
    .replace(
      "JAKESJAM local development scaffold for Phaser and Convex multiplayer rooms.",
      `JAKESJAM standalone ${role} client for local and cross-platform playtesting.`,
    );

  const outputPath = path.join(outputDir, `JAKESJAM-${role}.html`);
  await writeFile(outputPath, html, "utf8");
  console.log(`Wrote ${path.relative(rootDir, outputPath)}`);
}

function resolveDistAsset(assetPath) {
  const normalized = assetPath.startsWith("/") ? assetPath.slice(1) : assetPath;
  return path.join(distDir, normalized);
}
