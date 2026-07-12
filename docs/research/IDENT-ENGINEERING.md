# IDENT ENGINEERING — the craft behind a butter-smooth 27.93s boot ident

*Research date: 2026-07-12. Grounded against the actual implementation:
`client/src/style.css` (anthem ident block, ~35 `@keyframes` tracks at 27.93s) and
`client/src/main.ts` (`runIdent()`, `IDENT_MS = 27_930`, `splashTheme.play()` fire-and-forget,
`.run` class added inside a `requestAnimationFrame`).*

The question this doc answers: **what separates a premium, frame-perfect, audio-locked
28-second ident from one that visibly janks and drifts on a mid-range phone** — using only
CSS keyframes, SVG, and the Web Animations API (WAAPI). No frameworks.

---

## 1. Compositor vs main-thread: where each of our tools actually runs

The browser rendering pipeline is style → layout → paint → composite. Animations that the
compositor thread can run alone survive main-thread stalls (GC, Phaser boot work, decode);
anything that needs paint or layout re-enters the main thread every frame.
([web.dev: Why are some animations slow?](https://web.dev/articles/animations-overview),
[web.dev: High-performance CSS animations](https://web.dev/articles/animations-guide))

Per-property verdict for the properties **this ident actually animates**:

| Property (as used) | Pipeline stage | Verdict for a 28s ident |
|---|---|---|
| `opacity` (flash, rays, name, plate, logo, seal) | **Composite only** | Free. Keep everything possible here. |
| `transform: translate(...)` (ident-shake-anthem) | **Composite only** | Free. |
| Individual `rotate` / `scale` / `translate` props (rays, seal, plate, diamonds) | **Composite only** — individual transform properties are compositor-eligible the same as `transform` in Chrome/Firefox/Safari ([motion.dev tier list](https://motion.dev/magazine/web-animation-performance-tier-list), [Lighthouse: non-composited animations](https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations)) | Free, and cleaner than matrix composition. Keep. |
| `filter: brightness()` (logo stamp/sheen) | **Compositor-eligible in Chromium** — `filter`/`backdrop-filter` are in the small set mutable on the compositor thread ([Blink animation README](https://chromium.googlesource.com/chromium/src/+/master/third_party/blink/renderer/core/animation/README.md), [Chromium: Filter Effects](https://www.chromium.org/developers/design-documents/image-filters/)) but *"sometimes composited, sometimes expensive — profile first"* per browser/device. `brightness()` is a cheap per-pixel op (unlike `blur()`, whose cost explodes with radius × layer size — [Chrome: Animating a blur](https://developer.chrome.com/blog/animated-blur)). | OK on the logo `<img>` (bounded area). Never animate `blur()` full-screen. |
| `stroke-dashoffset` (c1–c4, tri, spokes) | **Paint**, main thread. Triggers repaint every frame, not layout. Chrome's 2021 "GPU-accelerated SVG animations" work covers **transform/opacity on SVG elements**, *not* geometry/paint properties like dash offset ([CSS-Tricks platform news](https://css-tricks.com/platform-news-rounded-outlines-gpu-accelerated-svg-animations-how-css-variables-are-resolved/)); high CPU with animated `stroke-dashoffset` is a known Chromium report ([crbug 167569](https://bugs.chromium.org/p/chromium/issues/detail?id=167569)). | Repaints the SVG's layer every frame *while the offset is moving*. Manageable if draws are staggered (ours are) and the repaint is confined to a promoted seal layer — see §2. |
| `r` and `fill` on the monad `<circle>` (monad-ignite) | Geometry + paint on the SVG. | Tiny element, brief windows — acceptable; a `scale` on a wrapper `<g>` would be the purist swap. |
| `conic-gradient` background (rays) | The gradient itself is **painted once** into the layer; animating only `rotate`/`opacity` on the element keeps per-frame work compositor-only ([Melanie Richards: Fun with animated gradients](https://melanie-richards.com/blog/animating-gradients/)). Animating gradient *stops/angle* (via `@property`) would repaint the full element every frame — never do that at 240vmax. | Rotation approach is correct. The problem is the layer *size*, not the gradient — §4. |

**Verification workflow:** DevTools → Performance recording during the ident; Summary tab
"Rendering" should be near zero outside stroke-draw phases; Rendering tab → Paint Flashing to
see exactly what repaints; Layers panel for memory per layer. Lighthouse flags every
non-composited animation by element and reason ([Lighthouse audit](https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations),
[web.dev animations-guide](https://web.dev/articles/animations-guide)).

## 2. SVG stroke-draw at scale + layer strategy

- **Dash cost model:** an animating `stroke-dashoffset` invalidates the paint of the path's
  bounds every frame. With a ~740px seal and dasharrays up to 3330, the repaint area is
  effectively the whole seal × devicePixelRatio. Cost is per-frame *while moving* — a
  finished draw (offset held at 0) costs nothing.
- **Our choreography already amortizes this:** c1 is a 1-frame strike (essentially zero
  animated-draw frames — the cheapest possible "draw"), and c2 → c3 → c4 → tri → spokes run
  *sequentially*, so at most ~1–2 dash tracks paint per frame. This is the right shape; keep
  draws staggered, never overlap 6 simultaneous dash animations.
- **Confine the damage:** because `.ident-seal` runs `seal-anthem` (rotate/scale/opacity) for
  the full 27.93s, Chrome promotes it to its own composited layer for the whole run — so
  dash repaints rasterize into the seal's layer only, not the full-screen stacking context.
  This is the good kind of layer promotion. Don't break it by removing seal-anthem.
- **`will-change` discipline:** web.dev's explicit warning — layer creation causes its own
  problems; add `will-change` only after profiling shows a promotion gap, and remove it when
  the animation ends ([web.dev animations-guide](https://web.dev/articles/animations-guide)).
  Elements already running compositor animations get promoted automatically; blanket
  `will-change` on the ~60 SVG children would be textbook abuse.
- **Layer budget:** every layer costs RAM + GPU memory (texture ≈ width × height × 4 bytes ×
  DPR²), which is "particularly limited on mobile"; Blink squashes overlapping layers to
  avoid "layer explosion" but you should keep deliberate promotions to a handful
  ([web.dev: Stick to compositor-only properties and manage layer count](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count),
  [web.dev: Accelerated Rendering in Chrome](https://web.dev/articles/speed-layers),
  [webperf.tips: Layers and Compositing](https://webperf.tips/tip/layers-and-compositing/)).
  The ident promotes roughly: root (shake), rays, flash, name, plate, logo, seal ≈ **7
  layers**. That's a sane budget. The concern is not the count — it's that one of them is
  240vmax² (§4).

## 3. Audio-visual sync: the real drift model for a 28s ident

**What actually causes desync (in likelihood order for our code):**

1. **Start offset, not clock rate.** `splashTheme.play()` is async: decode + hardware
   pipeline latency means first audible sample lands 50–300ms after the call, *while the CSS
   animations start the frame after `.run` is added*. Today `runIdent()` adds `.run` in a rAF
   and calls `play()` fire-and-forget — the two starts are uncorrelated within ~±200ms.
   That's the whole "the drop doesn't land" budget gone before frame one. (Autoplay/play
   semantics: [MDN Autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay).)
2. **Mid-flight stalls.** Buffer underrun (`waiting`/`stalled`), iOS audio-session
   interruptions (call, Siri, Control Center), OS pausing audio while CSS animations — which
   run on the *document timeline*, a wall clock from page load
   ([MDN: Web Animations API Concepts](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Web_Animations_API_Concepts)) —
   keep advancing. CSS has no idea audio stopped.
3. **Clock-rate drift proper** is minor over 28s on desktop, but the document timeline and
   the audio hardware clock are genuinely *different clocks*; nothing reconciles them.
4. **Output latency:** on Bluetooth audio, sound is *heard* 100–300ms after
   `audio.currentTime` says it played (`AudioContext.outputLatency` exposes this). Optional
   polish, but it's why "perfect" sync code can still feel late on AirPods.

**Why CSS-keyframes-alone can't fix it:** CSS animations have no seekable clock from CSS.
But every CSS animation *is* a WAAPI `Animation` object —
[`document.getAnimations()` / `element.getAnimations({subtree:true})`](https://developer.mozilla.org/en-US/docs/Web/API/Document/getAnimations)
returns them, and their `currentTime` / `startTime` / `playbackRate` are writable. This is
the escape hatch: **keep all 35 keyframe tracks in CSS, but make JS the timing authority.**

**The sync pattern (composite of the sources):**

- All animations sharing one timeline + one `startTime` "won't drift or go off-beat" against
  each other — set identical `startTime` on every track instead of hoping they all started
  the same frame ([Smashing: Precise Timing With Web Animations API](https://www.smashingmagazine.com/2022/06/precise-timing-web-animations-api/),
  [MDN: Animation.startTime](https://developer.mozilla.org/en-US/docs/Web/API/Animation/startTime)).
- Make the **audio the master clock** — the demoscene/JS13k standard is to drive visuals
  from the audio time every frame, because the audio clock is hardware-backed
  ([Cyril Pereira: How to handle making a demo in JavaScript](https://medium.com/@cyrilgeorgespereira/how-to-handle-making-a-demo-in-javascript-7fe574ba27bd),
  [Hans Garon: Synchronize Animation To An Audio File](https://hansgaron.com/articles/web_audio/animation_sync_with_audio/part_one/),
  [MDN: Advanced techniques — sequencing audio](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques)).
- Don't set `anim.currentTime = audio.currentTime * 1000` every rAF — `timeupdate` only
  fires at 4–66Hz (~250ms typical, [MDN: timeupdate](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/timeupdate_event))
  and `audio.currentTime` between events is a sampled estimate (precision further reduced to
  2ms+ in Firefox for fingerprinting — [MDN: currentTime](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime)).
  Per-frame hard-setting also re-introduces jitter from the sampling. Instead:
  **sync-on-threshold** — measure `drift = anim.currentTime − audio.currentTime*1000` on
  each `timeupdate`; if `|drift| > ~45ms` (≈3 frames), snap all tracks' `currentTime`
  together. Below that, leave the compositor alone. Best achievable audiovisual alignment
  is one display frame, 16.7ms @60Hz, anyway ([MDN sequencing](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques)).
- Pause/resume: on `waiting`/`stalled`/`pause` → `getAnimations().forEach(a => a.pause())`;
  on `playing` → resync then `play()`. This is the piece pure CSS fundamentally cannot do.
- `requestVideoFrameCallback` is the analogous tool when the media is a **video** — its
  `mediaTime` is populated from presentation timestamps and Chromium backs `currentTime`
  with the audio clock ([web.dev: rVFC](https://web.dev/articles/requestvideoframecallback-rvfc)).
  For our `<audio>`-driven ident it's not applicable; the `timeupdate`-threshold pattern is
  the right analog.

## 4. Frame pacing: what would jank this ident, and the fixes

- **Style-recalc storms:** 35 simultaneous tracks is fine *if* they're compositor
  properties — the compositor ticks them without main-thread style recalc. The main-thread
  tracks (stroke-dashoffset, `r`, `fill`) each force style + paint while active. Our
  choreography staggers them; preserve that invariant when re-choreographing.
- **The 240vmax conic-gradient is the single biggest hardware risk.** On a 926px-tall phone,
  240vmax ≈ 2222px square → at DPR 3 that's a ~6700×6700 texture ≈ **170MB+ of GPU memory
  for one decorative layer**, plus tile rasterization while it rotates. Browsers mitigate
  with tiling/downscaling, but this is exactly the "large layers hit memory" failure mode
  ([web.dev: manage layer count](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count)).
  Fixes, in order of preference:
  1. **Pre-rasterize the rays once** — draw the conic gradient into a ~1024px offscreen
     canvas (or ship a PNG/WebP), set it as the element background, size the element
     ~120vmax, and let the compositor upscale. Rays are low-frequency light shafts;
     upscaling is invisible. Rotation/opacity stay compositor. This is the "pre-rendered
     texture beats live gradient" swap.
  2. At minimum: cap the element (`min(150vmax, 2048px)`) and keep animating only
     `rotate`/`opacity` — never gradient stops via `@property`
     ([Melanie Richards](https://melanie-richards.com/blog/animating-gradients/)).
- **Full-screen flash layers:** `boot-ident-flash` at `inset:0` animating opacity is
  composite-only — cheap. Correct as-is.
- **Contain the ident:** `contain: strict` (or `layout paint`) on `.boot-ident` guarantees
  none of its 60 elements can dirty the Phaser canvas/splash behind the opaque layer.
- **Don't fight Phaser for the main thread during the ident:** any heavy boot work
  (WASM compile, asset decode) scheduled during the 28s will stall the stroke-draw phases.
  Either front-load before the ident, defer past it, or chunk it — the compositor tracks
  will survive, the paint-bound tracks won't.

## 5. Mobile, battery, lifecycle, accessibility

- **iOS audio unlock:** playback requires a user gesture; the "tap to start" gate is the
  canonical pattern ([Matt Montag: Unlock Web Audio in Safari](https://www.mattmontag.com/web/unlock-web-audio-in-safari-for-ios-and-macos),
  [MDN Autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)).
  Our boot gate already does this — the same gesture must unlock both the `<audio>` element
  and the `AudioContext` (it does). Note iOS 17+ reports of the *first* touch not unlocking
  reliably ([miniaudio #759](https://github.com/mackron/miniaudio/issues/759)) — resuming
  the context inside the gate handler and re-checking `state` on the next touch is the
  defensive pattern.
- **`visibilitychange` correctness:** in a hidden tab, rendering/rAF stop but the document
  timeline keeps advancing; audio may keep playing (desktop) or be suspended (iOS). Either
  way sync is destroyed silently. Correct behavior for an ident: on `hidden`, pause audio +
  all animations; on `visible`, resync-and-resume — or simply skip to the title. A 28s
  brand moment nobody is watching has no claim on battery.
- **`prefers-reduced-motion` is an obligation here, not a nicety:** a 28s sequence with
  full-screen shake, flashes, and a rotating 240vmax ray field is a textbook vestibular
  trigger; WCAG 2.2.2 additionally requires a pause/stop/hide affordance for anything moving
  longer than 5 seconds ([web.dev: prefers-reduced-motion](https://web.dev/articles/prefers-reduced-motion),
  [W3C technique C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39),
  [MDN: prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)).
  Accepted pattern for idents: under `reduce`, replace the choreography with a static (or
  gently cross-fading) card — logo + plate + name — for a few seconds while the audio still
  plays, then proceed. Don't set durations to literal 0s; near-zero (`0.01ms`) keeps
  `animationend`/`finished` firing so completion logic still runs
  ([CSS-Tricks: prefers-reduced-motion](https://css-tricks.com/almanac/rules/m/media/prefers-reduced-motion/)).
- **Skip affordance:** the 1.5s-armed pointerdown skip is the right classic-ident behavior
  (every console ident is skippable); make it discoverable ("press any key / tap to skip"
  fading in at ~2s) and bind keyboard (`keydown`) too, not just pointer — that also
  satisfies the WCAG pause/stop/hide requirement in one move.

## 6. Reference implementations worth stealing from

- **Demoscene/JS13k doctrine:** one master clock, and it's the audio's. Demos pass
  `audio.currentTime` into the scenario renderer every frame; the visual state is a *pure
  function of audio time*, so a dropped frame can never accumulate error — the next frame
  re-derives from truth ([Cyril Pereira demo writeup](https://medium.com/@cyrilgeorgespereira/how-to-handle-making-a-demo-in-javascript-7fe574ba27bd),
  [awesome-demoscene](https://github.com/psykon/awesome-demoscene)). Our WAAPI-seek pattern
  is exactly this, with the compositor interpolating between corrections.
- **Fender Engineering** (near-realtime animations with synchronized audio): same
  conclusion from a product team — schedule against the Web Audio clock, treat rAF
  timestamps as render-only ([Medium/Fender](https://medium.com/fender-engineering/near-realtime-animations-with-synchronized-audio-in-javascript-6d845afcf1c5)).
- **Smashing's WAAPI clock:** the multi-hand clock that stays beat-perfect for 24 hours by
  sharing one `startTime` across all tracks — the direct template for our 35 tracks
  ([Smashing](https://www.smashingmagazine.com/2022/06/precise-timing-web-animations-api/)).
- **SitePoint / GeeksforGeeks CSS-audio sync articles** document the naive approach (start
  both, pray) and its failure — useful as the anti-pattern we're currently shipping
  ([SitePoint](https://www.sitepoint.com/syncing-css-animations-with-html5-audio/)).
- **Chrome's "Animating a blur"** — the reference for why the specular sweep uses
  `brightness()` and never `blur()` ([Chrome blog](https://developer.chrome.com/blog/animated-blur)).

---

## ENGINEERING PRESCRIPTIONS — checklist for OUR ident

**P1 — Make audio the master clock; keep the keyframes in CSS. (Highest impact.)**
Keep all `@keyframes` exactly as choreographed. In `runIdent()`, after adding `.run`:
`const tracks = ident.getAnimations({ subtree: true })`. Await `splashTheme.play()`
*and* the first `playing`/`timeupdate` event, then set every track's `currentTime` to
`splashTheme.currentTime * 1000`. From then on, on each `timeupdate`, compute drift and
**snap only when `|drift| > 45ms`**. On `waiting`/`stalled`/`pause` → pause all tracks; on
`playing` → resync + resume. Kiosk/no-audio path: leave tracks free-running (current
behavior). This converts "two clocks, no reconciliation" into "one clock, compositor
interpolates between corrections" — and it also makes the skip trivially exact
(`audio.currentTime = END; tracks.forEach(t => t.finish())`).

**P2 — Shrink or pre-rasterize the ray field.**
`boot-ident-rays` at 240vmax is a potential 100MB+ GPU texture on a DPR-3 phone. Either
pre-render the conic gradient to a ~1024px canvas/PNG and upscale via the compositor, or cap
the element at `min(150vmax, 2048px)`. Keep animating only `rotate`/`opacity` (already
correct); never animate gradient stops.

**P3 — Preserve the compositor-only discipline on every beat hit.**
Everything that lands on a musical hit (flash opacity, shake transform, stamp
scale + brightness, diamond pops) must stay `transform`/`opacity`/individual-transform
(+ bounded `filter: brightness` on the logo only). No blur animations, no `will-change`
sprinkling — the 7 auto-promoted layers are the budget; do not promote SVG children.
Verify with Lighthouse's non-composited-animations audit + Performance panel (Rendering ≈ 0
outside draw phases).

**P4 — Keep stroke draws sequential and confined.**
The staggered c1→c2→c3→c4→tri→spokes schedule (≤2 dash tracks painting at once) and the
full-run `seal-anthem` transform animation (which keeps the seal on its own layer, confining
dash repaints) are load-bearing performance features — document them as invariants. The
1-frame c1 "strike" is the cheapest draw possible; prefer strikes/step-reveals over long
dash sweeps if adding elements. Add `contain: strict` to `.boot-ident`.

**P5 — Lifecycle: `visibilitychange` + stall = pause or bail.**
On `document.hidden` during the ident: pause audio + all tracks (or jump straight to
`ident-done`). On return: resync from `audio.currentTime`, resume. Never let the document
timeline advance against suspended audio (iOS interruptions, background tabs).

**P6 — Reduced-motion variant + discoverable skip.**
`@media (prefers-reduced-motion: reduce)`: replace shake/flash/ray/draw choreography with a
static card (seal fully drawn, logo + plate cross-fade, `0.01ms` durations so `finished`
still fires), audio untouched; or shorten to a ~4s card. Surface the existing ≥1.5s skip as
a visible "tap / press any key to skip" hint at ~2s and add `keydown`. This satisfies WCAG
2.2.2 (pause/stop/hide for >5s motion) and matches every console-ident convention.

**P7 (polish) — Bluetooth ear-lag compensation.**
If chasing perfection: subtract `audioCtx.outputLatency` (when available) from the visual
clock so hits land when the sound is *heard*, not when it's queued. Gate behind a check —
values are 0 on most wired/speaker paths, 100–300ms on Bluetooth.

**P8 (guard) — Keep the main thread idle during the ident.**
Any Phaser/WASM boot work scheduled inside the 28s window stalls the paint-bound stroke
phases (compositor tracks survive; draws don't). Front-load before the gate or defer past
`ident-done`.

---

### Source index

- [web.dev — Why are some animations slow?](https://web.dev/articles/animations-overview)
- [web.dev — How to create high-performance CSS animations](https://web.dev/articles/animations-guide)
- [web.dev — Stick to compositor-only properties and manage layer count](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count)
- [web.dev — Accelerated Rendering in Chrome (layers)](https://web.dev/articles/speed-layers)
- [web.dev — prefers-reduced-motion](https://web.dev/articles/prefers-reduced-motion)
- [web.dev — requestVideoFrameCallback](https://web.dev/articles/requestvideoframecallback-rvfc)
- [Lighthouse — Avoid non-composited animations](https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations)
- [Chrome Developers — Animating a blur](https://developer.chrome.com/blog/animated-blur)
- [Chromium — Filter Effects design doc](https://www.chromium.org/developers/design-documents/image-filters/) · [GPU Accelerated Compositing](https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/) · [Blink core/animation README](https://chromium.googlesource.com/chromium/src/+/master/third_party/blink/renderer/core/animation/README.md) · [crbug 167569 (stroke-dashoffset CPU)](https://bugs.chromium.org/p/chromium/issues/detail?id=167569)
- [CSS-Tricks — Platform news: GPU-accelerated SVG animations](https://css-tricks.com/platform-news-rounded-outlines-gpu-accelerated-svg-animations-how-css-variables-are-resolved/) · [prefers-reduced-motion almanac](https://css-tricks.com/almanac/rules/m/media/prefers-reduced-motion/)
- [Smashing Magazine — Precise Timing With Web Animations API](https://www.smashingmagazine.com/2022/06/precise-timing-web-animations-api/)
- [MDN — Animation.startTime](https://developer.mozilla.org/en-US/docs/Web/API/Animation/startTime) · [Animation.timeline](https://developer.mozilla.org/en-US/docs/Web/API/Animation/timeline) · [Web Animations API Concepts](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Web_Animations_API_Concepts) · [Document.getAnimations](https://developer.mozilla.org/en-US/docs/Web/API/Document/getAnimations) · [HTMLMediaElement.currentTime](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime) · [timeupdate event](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/timeupdate_event) · [Autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay) · [Web Audio advanced sequencing](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques) · [prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
- [W3C WCAG technique C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39)
- [motion.dev — Web Animation Performance Tier List](https://motion.dev/magazine/web-animation-performance-tier-list)
- [webperf.tips — Layers and Compositing](https://webperf.tips/tip/layers-and-compositing/)
- [Melanie Richards — Fun with animated gradients](https://melanie-richards.com/blog/animating-gradients/)
- [Matt Montag — Unlock Web Audio in Safari](https://www.mattmontag.com/web/unlock-web-audio-in-safari-for-ios-and-macos) · [miniaudio iOS 17 issue #759](https://github.com/mackron/miniaudio/issues/759)
- [Hans Garon — Synchronize Animation To An Audio File](https://hansgaron.com/articles/web_audio/animation_sync_with_audio/part_one/)
- [Cyril Pereira — How to handle making a demo in JavaScript](https://medium.com/@cyrilgeorgespereira/how-to-handle-making-a-demo-in-javascript-7fe574ba27bd)
- [Fender Engineering — Near-realtime animations with synchronized audio](https://medium.com/fender-engineering/near-realtime-animations-with-synchronized-audio-in-javascript-6d845afcf1c5)
- [SitePoint — Syncing CSS animations with HTML5 audio](https://www.sitepoint.com/syncing-css-animations-with-html5-audio/)
- [awesome-demoscene](https://github.com/psykon/awesome-demoscene)
