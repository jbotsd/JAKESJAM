// The REAL shader-quality vessel backdrop — a Phaser 4 native `Shader`
// GameObject (GLSL ES 1.00, WebGL1-style: `varying`/`gl_FragColor`/
// `texture2D`, no `#version` pragma — that's what Phaser 4's Shader quad
// pipeline actually expects, confirmed against the installed package
// source, not guessed). Adapts the exact liquid-light techniques already
// proven in client/src/shell/identShader.ts (flow-warp domain distortion,
// hot-core+halo glow falloff, chroma-rolled aberration, warm/teal palette)
// at a MUCH larger, denser scale, reactive to live music bands AND a
// structural "openness" uniform driven by the song's own zones — the
// vessel visibly opening and closing across the whole piece, not a static
// painted backdrop.
//
// Screen-space fixed (scrollFactor 0, sized to the camera viewport) so it
// reads as a true cosmic backdrop the player exists INSIDE, not a world
// object that scrolls away — same convention the boot-ident's shader uses.
//
// Only one of these exists per scene (Shader GameObjects are "stand-alone
// renders" per Phaser's own docs — each one forces a full batch flush and
// costs a real draw call; this is exactly the sparing, single-big-quad use
// case that's meant for, not something to instantiate per-particle).

import Phaser from "phaser";

const FRAG = `
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform float uBass;
uniform float uLead;
uniform float uScream;
uniform float uOpenness;

varying vec2 outTexCoord;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p *= 2.02;
    amp *= 0.55;
  }
  return v;
}

// Liquid flow warp — large-scale coherent molten displacement (see
// identShader.ts's own header note on why this must operate in
// NORMALIZED space: small noise cells = pixel-scale jitter = dust, not
// liquid; large cells = smooth molten sway).
vec2 flowWarp(vec2 p, float t, float amount) {
  float wx = fbm(p * 1.4 + vec2(0.0, t * 0.09)) - 0.5;
  float wy = fbm(p * 1.4 + vec2(5.1, t * 0.076)) - 0.5;
  float mx = fbm(p * 3.6 - vec2(t * 0.17, 1.7)) - 0.5;
  float my = fbm(p * 3.6 - vec2(t * 0.14, 8.2)) - 0.5;
  return p + (vec2(wx, wy) + vec2(mx, my) * 0.35) * amount * 2.0;
}

// Hot-core + soft-halo + wide glare-bleed falloff — a line that genuinely
// reads as emitting light, not painted (same triple-falloff identShader.ts
// uses, tuned wider here since this backdrop is seen from much further
// away in screen-space terms).
// Tighter halo than the first pass: at this screen-filling scale, 9 rings
// each throwing a wide glare-bleed merge into one undifferentiated wash —
// the actual seal geometry (the "motive") disappears into a white blob.
// Keep a real hot core + a modest halo; drop the far glare-bleed tail
// almost entirely so each ring stays a legible RING, not fog.
float glowRing(vec2 p, float r, float w) {
  float d = abs(length(p) - r);
  return exp(-d * d / (w * w)) + exp(-d / (w * 3.2)) * 0.22 + exp(-d / (w * 9.0)) * 0.05;
}
float glowEdge(vec2 p, vec2 a, vec2 b, float w) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  float d = length(pa - ba * h);
  return exp(-d * d / (w * w)) + exp(-d / (w * 3.2)) * 0.22 + exp(-d / (w * 9.0)) * 0.05;
}

vec3 pushChroma(vec3 c, float amount) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(l + (c - l) * amount, 0.0, 4.0);
}

// Deliberately its OWN signature, not the boot-ident's ramp: the ident mark
// resolves ember→gold→white, a clean chrome-logo read. This is the INSIDE
// of that vessel — deeper, wetter, alive — so the low/mid tones run
// rose-amber (not orange) and the top-end blooms toward violet (the void/
// danger family, docs/visual-language-gnostic-vessel.md's dual-accent
// system) instead of pure white-gold, gated by uOpenness so the violet
// bloom only really arrives once the vessel is unfurled deep into the run.
vec3 palette(float t, float openness) {
  vec3 ember = vec3(0.55, 0.1, 0.14);
  vec3 rose = vec3(0.95, 0.28, 0.22);
  vec3 amber = vec3(1.0, 0.68, 0.22);
  vec3 violet = vec3(0.55, 0.42, 0.98);
  vec3 hi = vec3(0.97, 0.93, 1.0);
  vec3 teal = vec3(0.32, 0.95, 0.88);
  vec3 c = mix(ember, rose, smoothstep(0.0, 0.35, t));
  c = mix(c, amber, smoothstep(0.3, 0.6, t));
  c = mix(c, teal, smoothstep(0.6, 0.72, t) * (1.0 - smoothstep(0.82, 0.93, t)) * 0.4);
  c = mix(c, violet, smoothstep(0.78, 0.97, t) * (0.25 + openness * 0.6));
  c = mix(c, hi, smoothstep(0.9, 1.0, t));
  return c;
}

// The seal: 9 Hebdomad-plus rings + one boundary + inscribed triangle,
// scaled and gated by uOpenness (the structural "unfurl" arc — see
// TutorialScene.ZONE_OPENNESS) so the WHOLE construction visibly grows
// across the song, not just brightens.
float sealField(vec2 p, float t, float heat, float openness) {
  vec2 wp = flowWarp(p, t, heat);
  float a = atan(wp.y, wp.x);
  // Filament-thin core: at this quad's scale (2100px tall), 0.010 normalized
  // was a ~21px core per ring — nine fat defocused donuts melting together.
  // ~0.0045 (≈9px) reads as drawn LINES of light with the halo carrying the
  // glow, which is the whole hot-core/soft-halo point.
  float coreW = 0.0045 + heat * 0.012;
  float field = 0.0;

  const int N = 9;
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    float f = fi / float(N - 1);
    // Compressed toward the core, denser at the outer edge (not the
    // boot-ident's even ladder) — reads as something you're INSIDE looking
    // out through, not a flat printed ring-set.
    float baseR = 0.1 + f * f * 0.9;
    float r = baseR * (0.3 + openness * 0.85);
    // Alternating spin direction per ring (even rings forward, odd rings
    // counter) — an even ladder all turning one way reads as a single
    // printed disc; opposed rotation reads as layered depth.
    float spinDir = mod(fi, 2.0) < 0.5 ? 1.0 : -1.0;
    float ph = a - (spinDir * t * (0.15 + fi * 0.035) + fi * 2.3);
    ph = mod(ph + 3.14159265, 6.2831853) - 3.14159265;
    float hi = exp(-ph * ph * 2.0) * (0.6 + uLead * 0.7);
    field = max(field, glowRing(wp, r, coreW) * (0.55 + hi));
  }
  // boundary — the hero ring
  {
    float r = 1.02 * (0.3 + openness * 0.85);
    float ph = mod(a + t * 0.1 + 3.14159265, 6.2831853) - 3.14159265;
    float hi = exp(-ph * ph * 1.3) * (0.55 + uLead * 0.6);
    field = max(field, glowRing(wp, r, coreW * 1.6) * (0.7 + hi));
  }
  // monad — always present, the seed that never leaves
  {
    float d = length(wp);
    float core = exp(-d * d / (0.02 * 0.02)) + exp(-d / 0.08) * 0.15;
    field = max(field, core * (0.7 + uBass * 0.7));
  }
  return field;
}

float triField(vec2 p, float t, float heat, float openness) {
  vec2 wp = flowWarp(p, t, heat);
  float triR = 0.66 * (0.3 + openness * 0.85);
  float rot = -t * 0.04;
  float coreW = 0.0055 + heat * 0.012;
  vec2 v0 = vec2(cos(rot - 1.5708), sin(rot - 1.5708)) * triR;
  vec2 v1 = vec2(cos(rot + 2.0944 - 1.5708), sin(rot + 2.0944 - 1.5708)) * triR;
  vec2 v2 = vec2(cos(rot + 4.18879 - 1.5708), sin(rot + 4.18879 - 1.5708)) * triR;
  return max(max(glowEdge(wp, v0, v1, coreW), glowEdge(wp, v1, v2, coreW)), glowEdge(wp, v2, v0, coreW));
}

// Flower of Life — a geometrically exact 19-circle hex-packed sacred-
// geometry construction (1 seed + 6 first-ring petals + 12 second-ring
// circles, every circle the SAME radius R, each first-ring circle's edge
// passing exactly through the seed's own center — the real construction
// rule, not a decorative approximation). Same hot-core/soft-halo LINE
// treatment as the seal's own rings (glowRing, not a filled disk) so it
// reads as one coherent molten construction, not a sticker pasted over
// the rest of the shader. Slower drift/finer line than the outer rings —
// a deeper, calmer layer the eye finds sitting behind the main seal.
float flowerOfLifeField(vec2 p, float t, float heat, float openness) {
  vec2 wp = flowWarp(p, t * 0.6, heat * 0.7);
  float R = 0.24 * (0.3 + openness * 0.85);
  float coreW = 0.0035 + heat * 0.009;
  float field = glowRing(wp, R, coreW); // the seed circle itself
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.0471975512; // 60 degrees
    vec2 dir = vec2(cos(a), sin(a));
    // Ring 1: 6 petals at distance R.
    field = max(field, glowRing(wp - dir * R, R, coreW));
    // Ring 2: 12 outer circles — 6 at R*sqrt(3) offset 30 degrees between
    // petals, 6 more at 2R continuing straight out through each petal.
    vec2 dirOffset = vec2(cos(a + 0.5235987756), sin(a + 0.5235987756));
    field = max(field, glowRing(wp - dirOffset * (R * 1.7320508076), R, coreW));
    field = max(field, glowRing(wp - dir * (R * 2.0), R, coreW));
  }
  return field;
}

void main() {
  vec2 uv = outTexCoord;
  vec2 p = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);

  float heat = 0.006 + uScream * 0.026 + uBass * 0.012;

  float sG = sealField(p, uTime, heat, uOpenness);
  float sR = sealField(p, uTime + 0.35, heat * 1.15, uOpenness);
  float sB = sealField(p, uTime - 0.35, heat * 1.15, uOpenness);
  float tG = triField(p, uTime, heat, uOpenness);
  float tR = triField(p, uTime + 0.35, heat * 1.15, uOpenness);
  float tB = triField(p, uTime - 0.35, heat * 1.15, uOpenness);
  // PERF: unlike the seal/triangle above, the flower is evaluated ONCE and
  // reused across all three channels instead of 3x with time-offset
  // chromatic aberration — it's a deeper, calmer background layer by
  // design (see flowerOfLifeField's own docblock), so losing its own
  // subtle color-fringe shimmer costs little visually while cutting a
  // real fraction of this shader's total per-pixel cost (each evaluation
  // is a flowWarp() call = 4 fbm() = 16 noise() samples, x19 circles).
  float fG = flowerOfLifeField(p, uTime, heat, uOpenness);
  float fR = fG;
  float fB = fG;

  vec3 warm = vec3(sR, sG, sB);
  vec3 teal = vec3(tR, tG, tB);
  vec3 flower = vec3(fR, fG, fB);

  float lumW = max(warm.r, max(warm.g, warm.b));
  vec3 col = palette(clamp(lumW, 0.0, 1.0), uOpenness) * lumW * 1.15;
  col += warm * 0.16;
  col += vec3(0.30, 1.0, 0.90) * teal * 1.05;
  // Warm gold-white — reads as part of the same molten construction as
  // the seal's own rings, not a separate cooler overlay competing for
  // attention the way the triangle's teal does.
  col += vec3(1.0, 0.86, 0.58) * flower * 0.85;
  col = pushChroma(col, 1.35);

  float lum = max(lumW, max(teal.r, max(flower.r, max(teal.g, teal.b))));
  col += vec3(1.0, 0.97, 0.9) * lum * uScream * uScream * 0.7;

  float energy = clamp(uBass * 0.5 + uScream * 0.65 + uLead * 0.25, 0.0, 1.0);
  col *= mix(0.4, 1.05, energy) * mix(0.35, 0.8, uOpenness);

  // Bottom-of-quad dim (outTexCoord.y is bottom-left-origin): the quad's
  // lower reach overlaps the arena's floor band, so ease the light off
  // toward its bottom edge — the seal reads as hanging IN the void above
  // and behind the terrain, not painted over it.
  float laneMask = smoothstep(0.02, 0.5, uv.y);
  float laneDim = mix(0.28, 1.0, laneMask);

  // Soft circular bound: the field fades out before the quad's own hard
  // rectangular edge — the seal must read as an OBJECT with an extent
  // (something you stand outside of and travel past), never as wallpaper
  // that happens to end at a rectangle. The radial fade ALONE doesn't
  // actually guarantee this on a non-square quad (3400x2100): at the
  // midpoint of the shorter edge, length(p) never reaches the smoothstep's
  // upper bound, so content there was still partially visible right up to
  // the quad's hard clip — a real visible seam where "still fading" met
  // "nothing," confirmed from a live screenshot. This UV-space term is
  // aspect-independent by construction (always reaches exactly 0 at
  // uv.x/y = 0 or 1, the TRUE boundary, regardless of quad shape), layered
  // on top so the radial falloff still shapes most of the interior.
  float edgeFadeRadial = 1.0 - smoothstep(0.78, 1.02, length(p));
  float edgeFadeUvX = 1.0 - smoothstep(0.42, 0.5, abs(uv.x - 0.5));
  float edgeFadeUvY = 1.0 - smoothstep(0.42, 0.5, abs(uv.y - 0.5));
  float edgeFade = edgeFadeRadial * edgeFadeUvX * edgeFadeUvY;

  float alpha = clamp(lum * mix(0.32, 0.58, energy) * (0.28 + uOpenness * 0.45) * laneDim * edgeFade, 0.0, 0.5);
  gl_FragColor = vec4(col * laneDim * edgeFade, alpha);
}
`;

export type VesselShaderBands = { bass: number; lead: number; scream: number };

/** Quad placement — WORLD-space with deep parallax, NOT screen-fixed.
 *
 * The first cut pinned this quad to the camera (scrollFactor 0, sized to
 * the viewport) and it read as total nonsense: a colossal seal that
 * follows your eyes wherever you look has no spatial identity — it's
 * wallpaper, not architecture, and the player reported exactly that
 * ("no idea what this is meant to be"). The fix is the oldest trick in
 * side-scrolling: anchor it in the WORLD at one place, give it a deep
 * parallax factor, and let the player travel PAST it. Now it's a
 * landmark — the blazing heart of the vessel, hanging in the void,
 * drifting slowly against your motion like something miles away.
 *
 * Numbers: with scrollFactor f, displayed-x = worldX - scrollX·f. Camera
 * scrollX spans ~0..6100 across the 8000px arena, so at f=0.22 the seal's
 * center drifts ~1350px leftward across the whole journey — starts
 * right-of-frame at spawn, hangs overhead through the middle fights,
 * slips behind you by the extraction. */
// Exported: TutorialSpiritDescent spawns the opening soul-mote FROM the
// seal's monad core, which (because of the parallax factor) has to be
// re-projected into scrollFactor-1 world space against the live camera.
export const SEAL_WORLD_X = 1620;
export const SEAL_WORLD_Y = 440;
const SEAL_W = 3400;
const SEAL_H = 2100;
export const SEAL_PARALLAX = 0.22;

export function installTutorialVesselShader(
  scene: Phaser.Scene,
): { setOpenness(v: number): void; update(bands: VesselShaderBands): void; destroy(): void } | null {
  // WebGL-only GameObject — scene.add.shader simply doesn't exist under a
  // Canvas-forced renderer (confirmed in the Phaser 4 source: the factory
  // method is registered only inside an `if (typeof WEBGL_RENDERER)`
  // block). Degrade gracefully — the Graphics-based TutorialVesselMotif
  // still covers the backdrop role if this can't run.
  const factory = scene.add as unknown as {
    shader?: (
      config: Phaser.Types.GameObjects.Shader.ShaderQuadConfig,
      x?: number,
      y?: number,
      w?: number,
      h?: number,
    ) => Phaser.GameObjects.Shader;
  };
  if (typeof factory.shader !== "function") return null;

  let openness = 0.08;
  const t0 = performance.now();

  const shader = factory.shader(
    {
      name: "tutorial-vessel",
      fragmentSource: FRAG,
      initialUniforms: {
        uTime: 0,
        uResolution: [SEAL_W, SEAL_H],
        uBass: 0,
        uLead: 0,
        uScream: 0,
        uOpenness: openness,
      },
    },
    SEAL_WORLD_X,
    SEAL_WORLD_Y,
    SEAL_W,
    SEAL_H,
  );
  if (!shader) return null;
  shader.setScrollFactor(SEAL_PARALLAX);
  shader.setDepth(-500); // as far back as anything in this scene ever gets

  return {
    setOpenness(v: number): void {
      openness = Phaser.Math.Clamp(v, 0, 1);
    },
    update(bands: VesselShaderBands): void {
      shader.setUniform("uTime", (performance.now() - t0) / 1000);
      shader.setUniform("uBass", bands.bass);
      shader.setUniform("uLead", bands.lead);
      shader.setUniform("uScream", bands.scream);
      shader.setUniform("uOpenness", openness);
    },
    destroy(): void {
      shader.destroy();
    },
  };
}
