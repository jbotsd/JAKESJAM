// Raw WebGL2 fragment shader for the boot ident — the vessel-seal
// geometry (rings + inscribed crystal DIAMOND + boundary, same coordinates
// as the SVG on top of this canvas) ignites with heat-shimmer light;
// chromatic fringing rolls out of the shimmer warp itself rather than
// being a separate hard RGB-split pass. The wisp strands lead a double
// life: on the live-FFT fallback they stay demoted (dim fixed ambient bed
// under the geometry), but when the per-stem envelope JSON is live the
// BASS stem takes ownership and the wisps become the melting-light
// headliner — near-invisible in bass silence, dominant/molten/chromatic
// at bass peaks (owner ask: "cracked up mega, in tune"). Either way they
// composite first, UNDER the crisp geometry glow — this canvas is also
// placed earlier in the ident's DOM than the real seal/logo, so those
// always paint on top and stay legible no matter how bright it gets.
//
// Lives entirely outside Phaser (the ident runs before the game boots),
// owns its own tiny GL context. Degrades to a no-op (returns null) on
// WebGL2-less browsers — the DOM/SVG ident still works fully without it.
//
// SYMBOLISM CONSTRAINT (owner's hard line — docs/IDENT-GRAMMAR.md): no
// Eye-of-Providence composition (eye/pupil under or inside a triangle),
// no triangle capping ring geometry around a focal center, no hexagram/
// pentagram. The centerpiece is a crystal diamond (rotated square) —
// avionics + crystal-munitions grammar. Eyes alone and triangles alone
// are fine elsewhere; the banned thing is the COMBINED Providence read.
//
// Vibrancy model: hard-attack/soft-decay beat impulses driving
// underdamped springs (7.5Hz, ζ≈0.3 — the same craft pattern as
// game/rendering/spring.ts). Spring integration happens JS-side in
// update() and the sprung values ship in as uniforms; the GLSL only
// reads them. A kick snaps the rings outward and they visibly ring
// down with overshoot (radial cascade, inner ring first); a lead stab
// punches the crystal's scale/brightness the same way. "Spark, not
// flood": the springs are transient boosts gated on onsets — the
// resting frame stays as scarce as before.

// spring.ts is a pure math module (no Phaser import) — safe to pull into
// the pre-boot shell bundle.
import { springState, springTo, springKick } from "../game/rendering/spring";

export type IdentBands = {
  bass: number; // 0-1, sub/kick envelope — punchy ring-flare driver
  // (stem mode: the DRUMS stem envelope — rings punch with the drums)
  lead: number; // 0-1, ~1.2-4kHz synth-lead presence (continuous)
  // (stem mode: guitar+piano envelope, clamped — facet glint / highlights)
  air: number; // 0-1, cymbal/noise high band
  scream: number; // 0-1, aggressive high-register energy (the "screaming" content)
  pulse: number; // 0-1, sidechain-gated envelope on the lead band (the stab)
  growth: number; // 0-1, ratchets up across the ~9.3-14.2s stab section
  progress: number; // 0-1, audio-locked position through the ident timeline —
  // drives which rings/boundary/crystal are lit, matching the SVG's own
  // stroke-dashoffset draw-in schedule so the light IS the construction,
  // not a coat of paint over geometry that's already fully there.

  // ── optional per-stem drive (splash-theme-stems.json). When stemLive is
  // true, the fields above are already stem envelopes (main.ts maps them)
  // and the fields below unlock the stem-only channels; when absent/false,
  // everything renders exactly as the live-FFT fallback always did. Both
  // paths feed the SAME uniforms — the stems just stop the guessing. ──
  stemLive?: boolean;
  wisp?: number; // 0-1 BASS stem envelope — the melting-light bed, "cracked
  // up mega": near-invisible in bass silence, dominant/molten at bass peaks.
  chroma?: number; // 0-1 OTHER stem envelope — chroma width/saturation
  // swell, composed WITH (inside) the existing growth escalation.
  kickOnset?: number; // >0 = a drums onset landed this frame (0-1 strength);
  // sample-accurate from the JSON — replaces the FFT rising-edge detector.
  stabOnset?: number; // >0 = a guitar onset landed this frame (0-1 strength).
};

// ── per-stem envelope data (client/public/audio/splash-theme-stems.json):
// 60Hz 0-255 envelopes + onset frame indices from a 6-stem separation of
// the anthem. Indexed by Math.floor(audio.currentTime * fps) — the SAME
// audio clock the rest of the ident slaves to. Loading is non-blocking and
// never fatal: null just means the FFT fallback keeps the frame.
export type IdentStemName = "drums" | "bass" | "guitar" | "piano" | "vocals" | "other";
export type IdentStems = {
  fps: number;
  durationMs: number;
  frameCount: number;
  stems: Record<IdentStemName, Uint8Array>;
  onsets: Record<IdentStemName, number[]>;
};

const STEM_NAMES: readonly IdentStemName[] = ["drums", "bass", "guitar", "piano", "vocals", "other"];

export async function loadIdentStems(url: string): Promise<IdentStems | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const raw = (await res.json()) as {
      fps?: number;
      durationMs?: number;
      stems?: Record<string, number[]>;
      onsets?: Record<string, number[]>;
    };
    if (!raw || typeof raw.fps !== "number" || !(raw.fps > 0)) return null;
    const stems = {} as Record<IdentStemName, Uint8Array>;
    const onsets = {} as Record<IdentStemName, number[]>;
    let frameCount = 0;
    for (const name of STEM_NAMES) {
      const env = raw.stems?.[name];
      if (!Array.isArray(env) || env.length === 0) return null;
      stems[name] = Uint8Array.from(env);
      frameCount = Math.max(frameCount, env.length);
      const on = raw.onsets?.[name];
      onsets[name] = Array.isArray(on) ? on.filter((f) => Number.isFinite(f)).sort((a, b) => a - b) : [];
    }
    return { fps: raw.fps, durationMs: typeof raw.durationMs === "number" ? raw.durationMs : 0, frameCount, stems, onsets };
  } catch {
    return null; // missing/corrupt stems are never fatal — the FFT path owns the frame
  }
}

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uBass;
uniform float uLead;
uniform float uAir;
uniform float uScream;
uniform float uPulse;
uniform float uGrowth;
uniform float uProgress;
uniform float uKick;  // sprung kick impulse (7.5Hz ζ0.3, JS-integrated) — CAN go negative (overshoot)
uniform float uKickT; // seconds since the last kick onset — drives the radial cascade gating
uniform float uStab;  // sprung lead-stab impulse — punches the crystal
uniform float uStemLive; // 1 = per-stem envelopes are driving the bands, 0 = FFT fallback
uniform float uWisp;  // bass-STEM envelope 0-1 — the melting-light bed (stem mode only)
uniform float uWispT; // wisp drift clock, JS-integrated — accelerates with the bass envelope
uniform float uChroma; // other-STEM envelope 0-1 — chroma width swell inside the growth arc
out vec4 fragColor;

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

// liquid flow warp — operates in NORMALIZED space (p spans roughly
// -0.5..0.5) so the noise cells cover 10-25% of the frame: a big, slow,
// coherent molten sway, the way hot air bends light. The old version was
// fed SVG-unit coordinates (p/SCALE, hundreds of units), which shrank
// the noise cells to ~1 PIXEL and blew the displacement up to tens of
// pixels — per-pixel white-noise jitter, i.e. the "dust" look. Liquid
// is smooth LARGE-scale displacement; dust is pixel-scale displacement.
// Same field, three orders of magnitude apart.
vec2 flowWarp(vec2 p, float t, float amount) {
  float wx = fbm(p * 1.7 + vec2(0.0, t * 0.10)) - 0.5;
  float wy = fbm(p * 1.7 + vec2(5.1, t * 0.085)) - 0.5;
  float mx = fbm(p * 4.2 - vec2(t * 0.19, 1.7)) - 0.5;
  float my = fbm(p * 4.2 - vec2(t * 0.16, 8.2)) - 0.5;
  return p + (vec2(wx, wy) + vec2(mx, my) * 0.35) * amount * 2.0;
}

// ── the seal itself, traced ─────────────────────────────────────────
// Same coordinate language as the SVG on top: 7 Hebdomad rings + one
// boundary ring + the inscribed crystal diamond, in the SVG's 0-1000
// space (SCALE converts to this shader's normalized frame). This is what
// "flares up and comes alive" — the existing icon, not a new shape.
#define SCALE 0.00105
// Luminous falloff instead of a flat smoothstep band: a white-hot
// filament core (gaussian), a soft exponential halo tail, and a THIRD
// much wider/dimmer glare bleed — three radii stacked is what an
// overdriven HDR emissive material (bloom baked into the material
// itself, no post-process pass needed) actually looks like: hard core,
// soft glow, faint bleed reaching well past the line. A hard band at
// any brightness still reads as paint, not emission.
float glowRing(vec2 p, float r, float w) {
  float d = abs(length(p) - r);
  return exp(-d * d / (w * w)) + exp(-d / (w * 5.0)) * 0.32 + exp(-d / (w * 16.0)) * 0.1;
}
// The crystal outline: a diamond (rotated square) centered on the origin
// with vertices at distance k along the axes. Euclidean distance from a
// point to that outline is exactly |‖p‖₁ − k| / √2 (each face is a line
// x±y = ±k at 45°), so the same triple-falloff emissive treatment the
// rings get applies verbatim — hard filament core, soft halo, faint bleed.
float glowDiamond(vec2 p, float k, float w) {
  float d = abs(abs(p.x) + abs(p.y) - k) * 0.7071068;
  return exp(-d * d / (w * w)) + exp(-d / (w * 5.0)) * 0.32 + exp(-d / (w * 16.0)) * 0.1;
}
// Volumetric aperture: soft light filling a ring's opening like looking
// down a lit tube/cone throat instead of a flat painted circle — brightest
// hugging the rim, fading toward center. Not a hard disc.
float apertureGlow(vec2 p, float r, float amt) {
  float d = length(p);
  float inside = smoothstep(r * 1.05, r * 0.1, d);
  float rim = exp(-abs(d - r) / (r * 0.45)) * 0.5;
  return (inside * 0.5 + rim) * amt;
}

// Ring/boundary/crystal reveal windows mirror the CSS stroke-dashoffset
// draw-in schedule exactly (style.css dr-h1..dr-h7 / dr-boundary / dr-gem,
// as fractions of the 27.93s timeline) — the shader's light ignites each
// piece of geometry AT THE SAME MOMENT the SVG stroke finishes drawing it,
// so the liquid light reads as the progression itself, not ambience laid
// over a seal that was already fully built from frame one.
//
// Returns (warmField, tealField): rings/boundary/monad halo warm gold,
// the crystal diamond halos its own teal — each glow matches the hue of
// the SVG stroke it's wrapped around, so it reads as THAT line molten,
// not a mismatched gold wash over a teal crystal.
vec2 sealGeometry(vec2 p, float t, float heat) {
  vec2 wp = flowWarp(p, t, heat);
  float a = atan(wp.y, wp.x);
  float coreW = 2.6 * SCALE + heat * 0.10; // filament thickness breathes with heat

  float starts[7] = float[7](0.179, 0.186, 0.240, 0.247, 0.301, 0.308, 0.362);
  float ends[7]   = float[7](0.236, 0.244, 0.297, 0.304, 0.358, 0.365, 0.419);
  float radii[7]  = float[7](95.0, 128.0, 160.0, 196.0, 238.0, 286.0, 340.0);
  // The rings ARE a speaker: excursion profile like a cone's diaphragm —
  // the innermost ring (nearest the "voice coil") pumps hardest, the
  // outer rings (nearest the surround) barely move — not literally
  // drawn as a cone, just moving the way one does. Radius itself
  // breathes with the kick instead of sitting mathematically fixed.
  float depth[7] = float[7](1.0, 0.82, 0.66, 0.52, 0.4, 0.3, 0.22);
  float warm = 0.0;
  for (int i = 0; i < 7; i++) {
    float reveal = smoothstep(starts[i], ends[i], uProgress);
    if (reveal < 0.002) continue;
    float fi = float(i);
    // Beat-impulse flare: the sprung kick (hard attack, overshoot
    // ring-down) cascades OUTWARD — each ring joins ~22ms after the one
    // inside it, a radial shockwave rather than seven rings in lockstep.
    // (Delay is deliberately shorter than the spring's ~250ms ring-down
    // so the outermost ring still catches a live wave.) uKick goes
    // negative on the overshoot, so radius visibly snaps out past target
    // and rings back — geometry punching, not glow tracking.
    float joined = smoothstep(fi * 0.022, fi * 0.022 + 0.04, uKickT);
    float flare = uKick * depth[i] * joined;
    float excursion = 1.0 + uBass * depth[i] * 0.055 + uPulse * depth[i] * 0.03 + flare * 0.05;
    float r = radii[i] * SCALE * excursion;
    // molten highlight orbiting each ring — the moving bright spot a
    // liquid surface throws as it catches the light. Each ring's
    // highlight travels at its own speed/phase; brightness rides the
    // lead line. THIS motion is what sells "liquid": light sliding
    // ALONG the geometry, not the geometry jittering in place.
    float ph = a - (t * (0.22 + fi * 0.05) + fi * 2.4);
    ph = mod(ph + 3.14159265, 6.2831853) - 3.14159265;
    float hi = exp(-ph * ph * 2.2) * (0.7 + uLead * 0.7);
    // bloom ONLY on hits: the flare brightens the ring while the spring
    // is ringing, then it settles back to the scarce resting level.
    warm = max(warm, glowRing(wp, r, coreW) * reveal * (0.62 + hi + max(flare, 0.0) * 0.55));
    // every other ring gets the volumetric aperture treatment — "some
    // circles" open up into soft radial depth instead of staying a
    // thin line, like light pouring through that ring's opening.
    if (int(mod(fi, 2.0)) == 0) {
      warm = max(warm, apertureGlow(wp, r, reveal * (0.16 + uBass * 0.22 + uPulse * 0.12)));
    }
  }
  // boundary ouroboros — the hero ring: thicker, brighter, slower sweep,
  // barely excurses (it's the surround/rim of the "cone")
  {
    float reveal = smoothstep(0.173, 0.232, uProgress);
    // the boundary is the surround/rim — it joins the kick cascade last
    // (after the seventh ring at ~0.15s) and barely moves
    float rB = 490.0 * SCALE * (1.0 + uBass * 0.012 + uKick * 0.008 * smoothstep(0.17, 0.21, uKickT));
    float ph = mod(a + t * 0.16 + 3.14159265, 6.2831853) - 3.14159265;
    float hi = exp(-ph * ph * 1.4) * (0.65 + uLead * 0.6);
    warm = max(warm, glowRing(wp, rB, coreW * 1.5) * reveal * (0.78 + hi));
  }
  // monad — hot white core breathing with the kick. A lone spark inside
  // rings is dial/spark grammar and stays; the banned read was the
  // triangle capping it, and that is gone.
  {
    float reveal = smoothstep(0.065, 0.078, uProgress);
    float d = length(wp);
    float core = exp(-d * d / (0.011 * 0.011)) + exp(-d / 0.045) * 0.14;
    warm = max(warm, core * reveal * (0.7 + uBass * 0.6 + max(uStab, 0.0) * 0.4));
  }

  // THE CRYSTAL — the large inscribed diamond (SVG points 500,160 /
  // 840,500 / 500,840 / 160,500 → vertices at ±340 on the cardinal axes,
  // inscribed in the seventh ring). ONE shape, nothing mirrored beneath
  // it: the old inverted-triangle underdraw (which composited into a
  // hexagram) is deliberately gone and must not come back — owner's hard
  // line, see docs/IDENT-GRAMMAR.md. Reveal window matches CSS dr-gem.
  // Lead stabs (uStab, sprung) punch its scale and brightness with a
  // visible overshoot ring-down — the crystal flinches on the hit.
  float gemReveal = smoothstep(0.501, 0.58, uProgress);
  float gemK = 340.0 * SCALE * (1.0 + uStab * 0.08);
  float teal = glowDiamond(wp, gemK, coreW) * gemReveal
             * (0.75 + uLead * 0.6 + max(uStab, 0.0) * 0.85);

  return vec2(warm, teal);
}

// ── background wisps: the melting-light bed. Fallback = demoted ambient
// (softer, dimmer, under the geometry glow). Stem mode = the BASS stem's
// instrument — gain/reach/drift/chroma all ride the envelope (see the
// compositing block in main() for the exact curves). Always UNDER the
// geometry glow either way. ──
#define N_STRANDS 8
float strands(vec2 p, float t, float growth) {
  float r = length(p) + 1e-4;
  float a = atan(p.y, p.x);
  float maxLen = 0.95 + growth * 0.4;
  float field = 0.0;
  for (int i = 0; i < N_STRANDS; i++) {
    float fi = float(i);
    float side = fi < float(N_STRANDS) * 0.5 ? -1.0 : 1.0;
    float k = fract(fi / float(N_STRANDS) * 2.0);
    float baseAngle = side * mix(0.4, 2.0, k);
    float phase = fi * 12.9;
    float speed = 0.35 + hash(vec2(fi, 1.0)) * 0.22;
    float curl = 0.5 * sin(r * 2.1 - t * speed + phase) * smoothstep(0.0, 0.25, r);
    float theta = baseAngle + curl;
    float angDist = a - theta;
    angDist = mod(angDist + 3.14159265, 6.2831853) - 3.14159265;
    float pseudoDist = abs(angDist) * r;
    // soft but NARROW — 8 wide overlapping bands read as milky fog,
    // not ambience; thin faint strands leave the geometry as the star
    float width = mix(0.08, 0.035, clamp(r / maxLen, 0.0, 1.0));
    float lenFalloff = smoothstep(maxLen, maxLen * 0.5, r) * smoothstep(0.0, 0.1, r);
    field += smoothstep(width, 0.0, pseudoDist) * lenFalloff;
  }
  return clamp(field, 0.0, 1.0);
}

// push chroma beyond the source color — pulls each channel away from
// the luminance midpoint, amount > 1.0 = hyper-saturated. This is what
// makes the gold read as MOLTEN GOLD instead of a washed cream/beige —
// brightness alone (multiplying col) lightens toward white; this instead
// widens the gap between channels, which is what saturated color IS.
vec3 pushChroma(vec3 c, float amount) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(l + (c - l) * amount, 0.0, 4.0);
}

vec3 palette(float t) {
  // hotter + more saturated across the board: the falloff tail sits in
  // deep ember, mids burn true orange, cores hit rich gold before white
  vec3 ember = vec3(0.72, 0.16, 0.04);
  vec3 orange = vec3(1.0, 0.5, 0.08);
  vec3 gold = vec3(1.0, 0.82, 0.25);
  vec3 hi = vec3(1.0, 0.98, 0.92);
  vec3 teal = vec3(0.32, 0.95, 0.88);
  vec3 c = mix(ember, orange, smoothstep(0.0, 0.35, t));
  c = mix(c, gold, smoothstep(0.3, 0.62, t));
  c = mix(c, teal, smoothstep(0.6, 0.72, t) * (1.0 - smoothstep(0.82, 0.93, t)) * 0.45);
  c = mix(c, hi, smoothstep(0.83, 1.0, t));
  return c;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  // WebGL's gl_FragCoord.y increases UPWARD from the bottom of the drawing
  // buffer; SVG/CSS y increases DOWNWARD from the top. sealGeometry's
  // coordinates are literal SVG coordinates — keep this flip so the traced
  // light always sits exactly on the SVG strokes above it (any asymmetric
  // geometry would otherwise render mirrored under the real seal, i.e. a
  // second phantom shape — the failure mode that once composited a banned
  // hexagram out of two triangles).
  p.y = -p.y;
  float t = uTime;

  // Warp amplitude in NORMALIZED units (fractions of frame height): a
  // visible molten sway at rest, real surges on scream/stab/kick. (The
  // old numbers were applied in SVG-unit space — same values there meant
  // tens of pixels of pixel-scale jitter, which is where the dust came
  // from. In the right space, small numbers are all liquid needs.)
  float heat = 0.0035 + uScream * 0.014 + uPulse * 0.009 + uBass * 0.006;

  // chromatic aberration still rolls out of the flow itself: R/G/B ride
  // the same warp at small phase offsets, so the fringing widens exactly
  // when the liquid moves hardest — tasteful at rest, hot on screams.
  vec2 sG = sealGeometry(p, t, heat);
  vec2 sR = sealGeometry(p, t + 0.35, heat * 1.15);
  vec2 sB = sealGeometry(p, t - 0.35, heat * 1.15);

  float ringGain = 1.05 + uBass * 0.55;
  // ── the melting-light bed. Stem mode (uStemLive=1): the BASS stem
  // envelope IS the light — no free-running brightness anywhere in here.
  //   brightness: gain rides a 1.5-power curve of uWisp. Bass silence
  //     (env≈0.05) → gain≈0.019, DARKER than the old fixed bed — "spark,
  //     not flood" still holds at rest. Full bass → gain≈1.38, ~10x the
  //     old 0.14: the wisps go dominant, molten, the headline layer.
  //   amplitude/reach: strand length stretches with the same envelope
  //     (up to ~half a frame further at peak).
  //   drift speed: lives in uWispT — JS integrates a clock that crawls in
  //     bass silence and rushes at peaks, so speed changes never snap.
  //   chroma: the R/B time offsets widen with the envelope — rest stays
  //     clean (the old ±0.35), peaks fringe hard chromatic.
  // Fallback (uStemLive=0): every mix() collapses to EXACTLY the old
  // demoted fixed dim bed (gain 0.14, offsets ±0.35, reach uGrowth).
  float wispGain = mix(0.14, pow(uWisp, 1.5) * 1.3 + uWisp * 0.08, uStemLive);
  float wispReach = uGrowth + uStemLive * uWisp * 0.55;
  float chromaSep = 0.35 * (1.0 + uStemLive * uWisp * 2.2);
  float stG = strands(p, uWispT + 0.7, wispReach) * wispGain;
  float stR = strands(p, uWispT + 0.7 + chromaSep, wispReach) * wispGain;
  float stB = strands(p, uWispT + 0.7 - chromaSep, wispReach) * wispGain;

  vec3 warm = vec3(sR.x, sG.x, sB.x) * ringGain + vec3(stR, stG, stB);
  vec3 teal = vec3(sR.y, sG.y, sB.y) * ringGain;

  float lumW = max(warm.r, max(warm.g, warm.b));
  // saturation boost: push the palette color harder than the raw
  // luminance so the gold reads as MOLTEN GOLD, not pale cream —
  // vibrancy comes from color intensity, not just brightness.
  vec3 col = palette(clamp(lumW, 0.0, 1.0)) * lumW * 1.35;
  col += warm * 0.22; // literal per-channel fringe
  col += vec3(0.30, 1.0, 0.90) * teal * 1.3; // the crystal blazes its own teal
  // overdriven emissive: push chroma past the source color BEFORE the
  // whiteout, so the geometry itself reads like a hot HDR material —
  // bloom baked into the color values, not a post-process haze on top.
  // The growth band (the 9.3-14.2s stab section) progressively WIDENS the
  // chroma — the rite visibly escalates in saturation, not just loudness:
  // it starts a touch tamer than the old fixed 1.6 and overshoots it at
  // full growth. Stem mode adds the OTHER stem's envelope as a swell
  // INSIDE that arc — growth stays the macro escalation, the stem
  // modulates within it (uChroma is 0 in fallback → identical output).
  col = pushChroma(col, 1.45 + uGrowth * 0.65 + uChroma * 0.55);

  float lum = max(lumW, max(teal.r, max(teal.g, teal.b)));
  // scream band: a hard, brief whiteout on the geometry itself — the
  // "screaming" moments genuinely blaze, everything else stays modest.
  col += vec3(1.0, 0.97, 0.9) * lum * uScream * uScream * 0.9;

  // real dynamic range: quiet passages still GLOW (the floor is a lit
  // seal, not a dim one), hits blaze well past nominal — HDR headroom
  // intentional, values over 1.0 are what "overdriven" means.
  float energy = clamp(uBass * 0.5 + uScream * 0.7 + uPulse * 0.5 + uLead * 0.2, 0.0, 1.0);
  col *= mix(0.85, 2.3, energy);

  float alpha = clamp(lum * mix(0.6, 0.97, energy), 0.0, 0.97);
  fragColor = vec4(col, alpha);
}`;

// Underdamped spring tuning for the beat impulses: ~7.5Hz with ζ≈0.3
// rings down over 3-4 visible oscillations (~250ms) — a snap with real
// overshoot, not a fade. Matches the craft pattern established across
// this session's animation work (secondOrderDynamics/ActionCamera).
const IMPULSE_HZ = 7.5;
const IMPULSE_DAMPING = 0.3;
// Velocity kick sized so a full-strength onset peaks the spring near 1.0
// (for ω≈47rad/s, ζ0.3 the impulse response peaks at ≈v×0.014).
const KICK_VEL = 70;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("[identShader] compile failed:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function installIdentShader(
  canvas: HTMLCanvasElement,
): { update(bands: IdentBands): void; dispose(): void } | null {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: false, antialias: false });
  if (!gl) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("[identShader] link failed:", gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

  const uRes = gl.getUniformLocation(prog, "uRes");
  const uTime = gl.getUniformLocation(prog, "uTime");
  const uBass = gl.getUniformLocation(prog, "uBass");
  const uLead = gl.getUniformLocation(prog, "uLead");
  const uAir = gl.getUniformLocation(prog, "uAir");
  const uScream = gl.getUniformLocation(prog, "uScream");
  const uPulse = gl.getUniformLocation(prog, "uPulse");
  const uGrowth = gl.getUniformLocation(prog, "uGrowth");
  const uProgress = gl.getUniformLocation(prog, "uProgress");
  const uKick = gl.getUniformLocation(prog, "uKick");
  const uKickT = gl.getUniformLocation(prog, "uKickT");
  const uStab = gl.getUniformLocation(prog, "uStab");
  const uStemLive = gl.getUniformLocation(prog, "uStemLive");
  const uWisp = gl.getUniformLocation(prog, "uWisp");
  const uWispT = gl.getUniformLocation(prog, "uWispT");
  const uChroma = gl.getUniformLocation(prog, "uChroma");

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const resize = () => {
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const t0 = performance.now();
  let disposed = false;

  // ── beat-impulse springs (JS-side integration; GLSL just reads the
  // sprung values). Onset detection = hard attack: a band leaping past
  // its previous frame value kicks the spring's VELOCITY (springKick),
  // then springTo relaxes it back to 0 with underdamped overshoot —
  // the soft decay. A short refractory window stops one sustained note
  // from machine-gunning kicks.
  const kickSpring = springState(0);
  const stabSpring = springState(0);
  let prevBass = 0;
  let prevPulse = 0;
  let kickAge = 10; // seconds since last kick onset (starts "long ago")
  let lastNow = 0;
  let wispT = 0; // wisp drift clock — see below; tracks uTime in fallback

  return {
    update(bands: IdentBands) {
      if (disposed) return;
      resize();
      const now = performance.now();
      const dtMs = lastNow ? Math.min(50, now - lastNow) : 16.7;
      lastNow = now;
      const stemLive = bands.stemLive === true;
      if (stemLive) {
        // Stem mode: sample-accurate onsets from the JSON replace the FFT
        // rising-edge detectors — SAME springs, SAME 130ms refractory on
        // the kick, so hits keep the exact overshoot ring-down grammar.
        const kOn = bands.kickOnset ?? 0;
        if (kOn > 0 && kickAge > 0.13) {
          springKick(kickSpring, KICK_VEL * (0.5 + kOn * 0.5));
          kickAge = 0;
        }
        const sOn = bands.stabOnset ?? 0;
        if (sOn > 0) {
          springKick(stabSpring, KICK_VEL * (0.55 + sOn * 0.45));
        }
      } else {
        // FFT fallback: kick/bass onset → ring-flare cascade
        if (bands.bass > 0.4 && bands.bass - prevBass > 0.1 && kickAge > 0.13) {
          springKick(kickSpring, KICK_VEL * (0.5 + bands.bass * 0.5));
          kickAge = 0;
        }
        // lead-stab onset (pulse is already a gated envelope from main.ts —
        // its rising edge IS the note-on) → crystal punch
        if (bands.pulse - prevPulse > 0.2) {
          springKick(stabSpring, KICK_VEL * (0.55 + bands.pulse * 0.45));
        }
      }
      prevBass = bands.bass;
      prevPulse = bands.pulse;
      kickAge += dtMs / 1000;
      // wisp drift clock: fallback tracks the shader wall-clock exactly
      // (today's drift, unchanged); stem mode INTEGRATES a rate that rides
      // the bass envelope — crawl in silence, molten rush at peaks — so
      // speed changes are continuous (an instantaneous rate change on an
      // integrated clock never pops the phase the way scaling t would).
      const wisp = Math.max(0, Math.min(1, bands.wisp ?? 0));
      wispT = stemLive ? wispT + (dtMs / 1000) * (0.3 + wisp * 2.6) : (now - t0) / 1000;
      springTo(kickSpring, 0, dtMs, IMPULSE_HZ, IMPULSE_DAMPING);
      springTo(stabSpring, 0, dtMs, IMPULSE_HZ, IMPULSE_DAMPING);
      gl.useProgram(prog);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (performance.now() - t0) / 1000);
      gl.uniform1f(uBass, bands.bass);
      gl.uniform1f(uLead, bands.lead);
      gl.uniform1f(uAir, bands.air);
      gl.uniform1f(uScream, bands.scream);
      gl.uniform1f(uPulse, bands.pulse);
      gl.uniform1f(uGrowth, bands.growth);
      gl.uniform1f(uProgress, bands.progress);
      gl.uniform1f(uKick, Math.max(-1.5, Math.min(1.5, kickSpring.value)));
      gl.uniform1f(uKickT, kickAge);
      gl.uniform1f(uStab, Math.max(-1.5, Math.min(1.5, stabSpring.value)));
      gl.uniform1f(uStemLive, stemLive ? 1 : 0);
      gl.uniform1f(uWisp, wisp);
      gl.uniform1f(uWispT, wispT);
      gl.uniform1f(uChroma, Math.max(0, Math.min(1, bands.chroma ?? 0)));
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      disposed = true;
      ro.disconnect();
      const lose = gl.getExtension("WEBGL_lose_context");
      lose?.loseContext();
    },
  };
}
