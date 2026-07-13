// Self-heals a real, confirmed production failure (2026-07-13 telemetry
// audit): on some GPU/driver combinations — every crash sample found so
// far shares one fingerprint, ANGLE's Vulkan backend — Phaser's OWN core
// WebGL shaders (sprite batching etc., not any of this game's custom
// shaders) fail to compile. Phaser.AUTO's renderer-type detection only
// checks "can a WebGL context be created," which passes; the actual
// compile failure only surfaces once Phaser attempts its first real draw,
// by which point Phaser has already committed to the WebGL path and has
// no built-in recovery. The observed result: an uncaught error, then
// "WebGL Context lost. Renderer disabled" — a permanently black screen,
// silently, for every visitor who hits it. Nobody who hit this in the
// wild ever saw an error message; they just saw the game fail to load.
//
// Fix shape: detect Phaser's own shader-compile-failure signature (see
// WebGLProgramWrapper.js's `throw new Error('Vertex '/'Fragment '/'Link
// Shader failed:' + ...)` — every one of Phaser's own throws for this
// class of failure contains the literal substring "Shader failed", which
// none of this game's own code or copy ever does, so it's a safe,
// low-false-positive match) and respond by reloading ONCE with
// GameConfig.ts's `?renderer=canvas` override, which forces Phaser's
// Canvas2D backend instead. Canvas mode has no shader effects and lower
// performance, but "playable, plainer" beats "permanently blank."
//
// Guarded against a reload loop via sessionStorage — if Canvas mode ALSO
// fails for some other reason, this fires at most once per tab session
// and lets the real error surface normally afterward instead of fighting
// the browser forever.

const RECOVERY_FLAG_KEY = "jakesjam.rendererRecoveryAttempted";
/** Only auto-recover from a failure this early in boot — a shader
 *  compile failure genuinely happens during Phaser's first few frames;
 *  matching this same substring from something that throws deep into an
 *  hour-long play session would almost certainly be a different, unrelated
 *  bug that a reload should NOT paper over. */
const RECOVERY_WINDOW_MS = 15_000;

function isPhaserShaderCompileFailure(message: string): boolean {
  return message.includes("Shader failed");
}

function alreadyOnCanvasRenderer(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("renderer") === "canvas";
  } catch {
    return false;
  }
}

function recoverToCanvasRenderer(): void {
  try {
    sessionStorage.setItem(RECOVERY_FLAG_KEY, "1");
  } catch {
    // Storage unavailable (private mode etc.) — proceed anyway; worst case
    // is one extra reload attempt instead of a guaranteed single one.
  }
  const url = new URL(window.location.href);
  url.searchParams.set("renderer", "canvas");
  window.location.replace(url.toString());
}

/** Call once, as early as possible in boot — ideally before
 *  `new Phaser.Game(...)`, so there's no race between Phaser's first
 *  render attempt and this listener attaching. */
export function installRendererRecovery(): void {
  if (alreadyOnCanvasRenderer()) return; // already on the fallback path — nothing to recover TO
  let alreadyAttempted = false;
  try {
    alreadyAttempted = sessionStorage.getItem(RECOVERY_FLAG_KEY) === "1";
  } catch {
    // Treat storage failures as "never attempted" — see recoverToCanvasRenderer's own note.
  }
  if (alreadyAttempted) return;

  const bootAtMs = performance.now();
  const handleFatal = (message: string): void => {
    if (performance.now() - bootAtMs > RECOVERY_WINDOW_MS) return;
    if (!isPhaserShaderCompileFailure(message)) return;
    recoverToCanvasRenderer();
  };

  window.addEventListener("error", (e) => {
    handleFatal(String(e.message ?? e.error?.message ?? ""));
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    handleFatal(r instanceof Error ? r.message : String(r ?? ""));
  });
}
