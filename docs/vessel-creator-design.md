# Vessel Creator — deep cosmetic customization design (foundation for future monetization)

**Status:** Design proposal — approved to build the FOUNDATION now ("pave the way"), not a store or payment flow. No pay-to-win, ever; cosmetics only, exactly as already positioned in `docs/marketing-copy.md`.
**Sibling docs:** `docs/visual-language-gnostic-vessel.md` (the visual language this system must extend, not reinvent), `client/src/game/rendering/ProceduralPlayerRig.ts` (the vessel implementation this system layers onto).
**Written:** 2026-07-14.

---

## 0. Why this, why now

Competitor review-sentiment research (see `docs/marketing-copy.md`): across every tracked title in JAKESJAM's genre, premium/no-IAP titles (Stick Fight, ROUNDS, Duck Game, Gang Beasts, Rivals of Aether) sit at **85–97% positive**; titles with real monetization (Brawlhalla, MultiVersus) sit at **76–80% positive**. Not a close call — JAKESJAM's cosmetics-only stance is already on the right side of that line.

The ask: don't touch that positioning. Instead, build the *system* that would let cosmetics-only monetization actually be worth doing later — deep enough that players want to express themselves through it, structured so it can never cross into pay-to-win. Two reference points named explicitly: **Fortnite**'s design language (styles, locker, reactive cosmetics) and **Warframe**'s customization depth ("we want a Warframe designer"). Research summary below; full sourcing available on request.

---

## 1. Grounding research (condensed — see research transcript for full citations)

### 1.1 Warframe (Digital Extremes)

- **Six color channels** per equipped item: Primary, Secondary, Tertiary, Accents, Emissive (+ secondary variant), Energy (+ secondary variant, gated behind a Forma sink). This is a genuine *layered* system — not one skin swap, up to 8 effective color inputs on a fully-invested item.
- **Per-slot attachments**, independently recolorable from the base frame: Armor (Chest/L-Shoulder/R-Shoulder/L-Leg/R-Leg, each a separate swappable piece), Syandanas (back attachment), Sigils (chest/back emblem, adjustable size/position/orientation), Ephemera (persistent particle-effect attachments).
- **Skin tiers**: Default (free) → Detailed → Deluxe (paid, substantial overhaul, sometimes exclusive idle/movement animation) → Prime (cosmetic-only, tied to higher-rarity same-stat frame variants) → TennoGen (community-designed, DE-curated, sold via Steam Workshop with a **30% revenue share to the creator** — a real UGC economy, not just DE-authored content).
- **"Fashion Frame"** — player-coined term for the practice of composing pieces into a coherent aesthetic "fit." Community sourcing frames the *skill of combining* pieces as the actual status marker, not raw ownership — this is the retention mechanism: taste and iteration, not a collection checklist.
- **History matters for our positioning**: Warframe originally *did* sell skill-tree power in early development. Backlash forced a reversal to fully-earnable power + cosmetics-only monetization. This is a stronger data point for our own stance than "always designed this way" — it's "the market corrected this exact mistake once already."

### 1.2 Fortnite (Epic Games)

- **Locker categories**: Outfits, Back Bling, Harvesting Tools, Gliders, Emotes, Wraps.
- **"Styles"** — palette/component variants of ONE base outfit, unlocked and swapped instantly, no separate purchase. The **Boundless** set example: 7 patterns × 4 materials × 25 colors plus independent mask/eye/belt/emblem toggles — a mini character-creator built on top of a single base model. **This is the single most directly-portable idea for JAKESJAM**: one authored "Deluxe" vessel skin, many recolor/component axes on top, for a fraction of the production cost of N fully-separate skins.
- **Reactive cosmetics** — appearance changes dynamically based on in-match performance (eliminations, damage, healing). Critically: earned *within the current match*, not purchased — a way to make cosmetics feel alive and skill-responsive without ever paying for power.
- **Tim Sweeney, on record**: *"There's no pay-to-win. And there is no scenario in which spending a lot of money gives you a benefit over players who haven't spent money."* Same Sweeney, on loot boxes: framed them as gambling-adjacent, and Epic subsequently **removed randomized loot boxes from both Fortnite and Rocket League in favor of transparent, see-the-exact-item-and-price direct purchase**. Real precedent for a "never gate reveals behind randomness" rule in our own design.
- Court-disclosed (Epic v. Apple, high-confidence, not estimation): $5.48B (2018) / $3.71B (2019) Fortnite revenue, ~98% of Epic's total revenue in that window — cosmetics-only monetization at a scale that answers "is this actually worth building" definitively.

### 1.3 The cautionary case (Apex Legends)

Cosmetics-only doesn't automatically mean zero backlash — Respawn faced real player anger over cosmetic *pricing* even with power never for sale. Lesson for later (pricing, not architecture): when monetization eventually happens, price transparency and perceived fairness matter as much as the no-pay-to-win rule itself.

---

## 2. Hard constraints (from the existing visual-language doc — non-negotiable)

Per `docs/visual-language-gnostic-vessel.md` §"Cosmetics bridge": *"Geometry never changes for paid skins — research-true: Autogenes is a mode of generation (light), not a new body schema."*

This system must respect that exactly. Translated into Warframe/Fortnite terms:

| What Warframe/Fortnite do | What we do instead |
|---|---|
| Deluxe skins can change the whole model/silhouette | Never — the vessel hull silhouette is canonical (`art-direction.md`), cosmetics are material/light/attachment only |
| New character "skins" can be a different body entirely | Not applicable — one vessel, reskinned, not replaced |
| Randomized loot boxes for rare items | **Never** — direct selection or earned-and-shown-upfront only, per the Fortnite/Rocket League precedent above |

Everything below is designed inside that fence.

---

## 3. The system: mapping Warframe's channel model onto the vessel's own anatomy

JAKESJAM's vessel (`ProceduralPlayerRig`) already has a documented, distinct anatomy — this is the advantage over building a customization system from nothing: the attachment points already exist in the fiction, they're just not independently configurable yet.

| Existing vessel anatomy (already shipped) | Warframe-equivalent channel | Fortnite-equivalent idea | Proposed cosmetic axis |
|---|---|---|---|
| Hull / body color (`this.color`, `this.colorDark`) | Primary + Secondary | Base Outfit | **Hull tone** — 2 colors, primary + shade |
| Visor seam of light | Emissive | — | **Visor glow color** — independent of hull, matches "aperture, not a face" doctrine |
| Spine energy conduit | Energy (+ secondary) | — | **Spine charge color** — the "I am" vitality signal, most visible in motion |
| Palm projector / energy channel | Energy (shared or split) | Harvesting Tool skin | **Palm channel color** — visible on every shot fired, highest-frequency read |
| Crystal joint seals | Accents | Wrap (pattern) | **Joint seal material** — pattern/finish, not just color (crystal/alloy/void-glass) |
| Mad aura motes | — (novel to us) | — | **Aura mote style** — count/color/behavior, already exists as a field-around-vessel effect, natural earned-cosmetic slot (see §5) |
| Nameplate portrait badge *(shipped this session)* | Sigil | Emblem | **Badge glyph** — already a circular badge with a procedural head/shoulders glyph in the player's identity color; this is a ready-made Sigil equivalent, no new UI needed |
| — (new) | Syandana | Back Bling | **Trailing conduit** — a new back-mounted attachment, the one genuinely new geometry slot (an attachment, not a body change — same rule Warframe applies to Syandanas) |

This is deliberately a **6-channel + 1-attachment-slot** system, matching Warframe's real depth (6 colors) rather than Fortnite's simpler single-skin-plus-styles model — because JAKESJAM's vessel anatomy already has 6+ documented, independently-lit zones. Fortnite's contribution isn't the channel count, it's the **Styles pattern**: one authored "Deluxe" vessel treatment (say, an Autogenes-tier hull material) should ship with several free recolor/pattern variants on top, not force full re-authoring per variant. Production cost stays near-flat as variant count grows.

### 3.1 Tiering (mirrors Warframe's Default → Deluxe, adapted to our existing dual-accent doctrine)

| Tier | What it is | Maps to existing doc |
|---|---|---|
| **Default crystal** | Current shipped look, cyan accent | Already shipped (`0x8ff8ff`) |
| **Detailed** | Same geometry, refined material pass on hull/joints — free, a "you've played enough to notice" tier | New — first thing to actually build, since it's pure asset work no monetization needed |
| **Deluxe (house)** | Full 6-channel customization unlocked, Autogenes gold/teal family | Already documented as `accentColor` gold tier |
| **Deluxe (void)** | Same, violet family | Already documented as "future void" tier |
| **Earned/Reactive** | Aura mote style + palm channel intensity respond to live performance this match (kill streaks, clip-worthy moments) | New — our Reactive-cosmetics equivalent, see §5 |

No tier changes hull silhouette. No tier is randomized. Every tier is either earned by play or, later, a direct selectable purchase — never a loot box.

---

## 4. UI: reuse what already works, don't invent a new interaction language

Two systems shipped *this session* are the natural UI foundation — build the Vessel Creator screen out of these, don't design from scratch:

1. **The card-pick sequenced reveal** (`CardDraftOverlay.ts`, just shipped): spotlight-the-selection + staggered stat/identity reveal + closing glow. A "confirm cosmetic" moment should reuse this exact motion grammar — the player already has one polished "you got/chose something" beat in the game, use it twice, not invent a second.
2. **The nameplate portrait badge** (`ProceduralPlayerRig.drawNameplate`, just shipped): already renders a live badge in the player's own identity color with a procedural glyph. This becomes the in-match "current loadout" preview for free — no new render path needed, the badge already updates from `this.color`/`this.accentColor` every frame.

Per `docs/visual-language-gnostic-vessel.md`'s doctrine (§3 "Withdraw, don't ascend," §5 "Untranslatable charge"): the creator screen previews settle in/out, never fly-to-heaven; channel selection uses the same L-bracket/instrument-panel chrome as the rest of the shell; no XP-bar-climbing metaphor for unlocks even when tiers are earned.

---

## 5. Earned-not-bought layer (the "reactive cosmetics" idea, kept inside our no-pay-to-win fence)

Fortnite's Reactive cosmetics change appearance from *in-match* performance — never purchased power, purely a live skill-signal. JAKESJAM already has the substrate for this:

- **Aura mote intensity/color** — already a field-around-vessel effect (`AURA_MOTE_COUNT`), could respond to a live kill-streak or round win-streak within the SAME match, resetting each match. Zero persistence, zero pay-to-win risk — it's a live scoreboard rendered onto the vessel instead of a HUD number.
- **Palm channel glow** — already the highest-frequency-seen part of the vessel (visible every shot). A brief intensity bump on a confirmed kill is cheap, reads instantly, and is the exact "clip-worthy unscripted moment" positioning already established in the outreach pitch copy.

This is the piece to prototype FIRST, before any tier/channel UI — it's pure gameplay-feel work (juice, not commerce), ships value immediately, and proves out the "vessel responds to you" thesis the whole system depends on.

---

## 6. Phasing (foundation now, monetization later — as instructed)

1. **Now, no monetization involved:** widen `ProceduralPlayerRigOptions`'s single `accentColor` into the 6-channel model (§3), defaulting every existing player to today's exact look (zero visual regression). This is pure engineering — a data-shape change, not new UI.
2. **Now:** reactive aura/palm-glow response to in-match performance (§5) — pure game-feel, ships as a juice pass, no economy needed.
3. **Later, still no payment:** the Vessel Creator screen itself (reuses card-pick sequence UI, §4) — lets players SEE and swap channels using whatever's already unlocked (starts with just Default + Detailed, both free).
4. **Later, when monetization is actually greenlit:** Deluxe tiers as direct-purchase (never loot box, per the Rocket League/Fortnite precedent), TennoGen-style community skin submissions as a stretch goal if a creator economy ever makes sense for a game this size.

Nothing in steps 1–3 requires a store, a payment processor, or a single monetization decision — which is exactly "paving the way" without touching the no-pay-to-win positioning today.
