/**
 * Additive radial-gradient glow texture, generated once per scene and reused
 * for every glow Image acquired from `ParticlePool.acquireGlow()`. The shape
 * is a soft white blob — tint it at acquire time to colour the glow.
 *
 * Gated defensively for headless tests: if the scene has no textures manager
 * or no `createCanvas`, this is a no-op.
 */
export const GLOW_TEXTURE_KEY = "__glow_radial";

const TEXTURE_SIZE = 128;

type CanvasTextureLike = {
  context: CanvasRenderingContext2D;
  refresh: () => unknown;
};

type TexturesLike = {
  exists?: (key: string) => boolean;
  createCanvas?: (key: string, w: number, h: number) => CanvasTextureLike | null;
};

type SceneLike = { textures?: TexturesLike };

export function ensureGlowTexture(scene: SceneLike): boolean {
  const tex = scene.textures;
  if (!tex || typeof tex.createCanvas !== "function") return false;
  if (tex.exists?.(GLOW_TEXTURE_KEY)) return true;

  const canvas = tex.createCanvas(GLOW_TEXTURE_KEY, TEXTURE_SIZE, TEXTURE_SIZE);
  if (!canvas) return false;

  const ctx = canvas.context;
  const cx = TEXTURE_SIZE / 2;
  const cy = TEXTURE_SIZE / 2;
  const r = TEXTURE_SIZE / 2;

  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  // Bright pinpoint core, fast falloff to mid, soft tail to edge — matches
  // the "rounds" reference: hot centre, halo, faint outer wash.
  gradient.addColorStop(0.0, "rgba(255,255,255,1.0)");
  gradient.addColorStop(0.18, "rgba(255,255,255,0.78)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.28)");
  gradient.addColorStop(0.78, "rgba(255,255,255,0.06)");
  gradient.addColorStop(1.0, "rgba(255,255,255,0.0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  canvas.refresh();
  return true;
}

/** Native diameter of the glow texture in pixels (use to compute scale). */
export const GLOW_TEXTURE_SIZE = TEXTURE_SIZE;
