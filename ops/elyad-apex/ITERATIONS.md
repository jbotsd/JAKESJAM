# Elyad apex landing — 30 design iterations + Elm rewrite

**Stack:** Elm 0.19.1 (`src/Main.elm`) + `styles.css` (sci-fi gnostic chrome) + thin shell `index.html`.  
Build: `elm make src/Main.elm --optimize --output=elm.js`  
Live: `https://www.elyad.io/` (apex DNS may still need CNAME fix).

Sci-fi gnostic house face for advertising; CTA → JAKESJAM.

| Elm structure | Role |
|---------------|------|
| `Model` | reducedMotion flag, CTA pressed state |
| `view` | Full page: atmosphere, frame, vessel, CTAs, chips |
| `Msg` | CtaDown / CtaUp (squash class) |
| flags | `prefers-reduced-motion` from JS |

CSS keeps the 30 visual/juice passes; structure and interaction are typed Elm.

| # | Pass | What changed |
|---|------|----------------|
| 1 | Direction | Sci-fi gnostic void dock, not SaaS template |
| 2 | Palette | Autogenes gold `#c9a84c` + midnight void + combat cyan |
| 3 | Type | Syne display + Cormorant tagline + IBM Plex Mono UI |
| 4 | Hierarchy | Elyad H1 loud; house kicker small gold |
| 5 | CTA dual | Cyan fill primary + gold seam (house holds combat button) |
| 6 | Corner seals | L-brackets on panel hull |
| 7 | Top filament | Gold hairline gradient on frame |
| 8 | Vessel glyph | Procedural hull + spine + visor (matches game language) |
| 9 | Spine pulse | Vitality register (3.5s breath) |
| 10 | Vessel drift | Idle atmosphere float |
| 11 | Settle-in | Withdraw-not-ascend entrance (translateY + scale) |
| 12 | Stagger rise | Kicker → title → lede → CTA → chips → foot delays |
| 13 | Grid floor | Perspective mask, gold micro-grid |
| 14 | Grid pulse | Slow opacity atmosphere |
| 15 | Orbs | Soft gold + cyan blooms with breath |
| 16 | Grain | Film noise overlay |
| 17 | Sky mesh | Multi radial gradient depth |
| 18 | Chip cards | Three meta facts: live / product / join time |
| 19 | Chip hover | Border gold + lift |
| 20 | CTA hover | Lift, glow stack, brightness |
| 21 | CTA active | Squash scale 0.94 |
| 22 | Shimmer | Gold-leaf sweep on primary CTA |
| 23 | Ghost secondary | play.elyad.io text button |
| 24 | Cursor glow | Soft gold field follows pointer |
| 25 | Frame tilt | Subtle 3D parallax on card |
| 26 | Audio pluck | WebAudio triangle on hover/tap (gesture-safe) |
| 27 | Haptic | Short vibrate pattern on Play (Android) |
| 28 | Status dot | Live teal pulse on world chip |
| 29 | Coptic micro | Quiet ⲁⲩⲧⲟⲅⲉⲛⲏⲥ imprint (opacity 0.45) |
| 30 | A11y | `prefers-reduced-motion` kills motion; safe-area padding |

## Non-goals kept
- No multi-game portal
- No TikTok OAuth
- No sermon / lore dump
- Apex advertises; play hosts the game
