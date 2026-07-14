# JAKESJAM — UI Axioms (Sci-Fi Gnostic Vessel, enforceable form)

**Status:** Canonical checklist. Every other design doc (`visual-language-gnostic-vessel.md`,
`art-direction.md`, `ui-shell-goal.md`, `themes.md`, `asset-prompts/*`) is prose and rationale;
this file distills them into **checkable axioms** — the thing a reviewer (human or agent) runs
a UI element against in under 10 seconds. If a new panel, HUD element, or overlay doesn't pass
every axiom in its category, it isn't done, however good it looks in isolation.

**One-line identity** (what the user calls it): **gnostic sci-fi wizard ninja**. Formally:
**sci-fi gnostic** (see source doc for the full "why"). This file is the "how to check it" — but
section 0 below is the "why," made concrete enough to actually design from, not just audit
against. Read it before you touch anything, not just when a review already flagged you.

**Last written:** 2026-07-15 (manifesto rewritten — Jake: "redo from the docs up" — the axioms
below were checkable but weren't yet *generative*; this section exists so a designer/agent can
originate a new element from first principles, not just pattern-match against a checklist).

---

## 0. The manifesto — what "gnostic sci-fi wizard ninja" actually means as UI

Four words, four material laws. Each one is a concrete constraint on how pixels behave, not a mood
board adjective.

**Ninja — a blade only catches light when it matters.** A ninja doesn't carry a torch; they move in
near-total dark and the one thing that catches light is the edge doing work right now. This is the
whole light doctrine: **almost total void, one point of light earning its keep, never ambient glow
for its own sake.** If something is glowing and nothing changed, that's not atmosphere — that's a
tell, and a ninja never gives you a tell. (→ H2, C3)

**Wizard — every edge is cut, not poured.** A wand is carved. A shuriken is ground to an edge. A
rounded corner is what injection-molded plastic looks like — soft, mass-produced, apologetic. A
chamfer is what a *cut* looks like — deliberate, forged, made by a hand or a laser with intent.
This isn't a corner-radius preference, it's material logic: **this instrument was forged, not
manufactured for comfort.** (→ G1, G2, G3, G5)

**Ninja again — identity is a mask, not a face.** A ninja's power is that you cannot read them:
silhouette plus one mark is all you get, and that mark means something *only if you already know
how to read it*. This is the actual mechanism behind the visor seam (no face, ever) and the
deterministic per-player sigils — not decoration, concealment that reveals exactly enough and no
more. A mascot with eyebrows is the opposite of this: it's a face performing emotion at you. (→
anti-pattern #2, H3, H6)

**Ninja, third meaning — one motion, no flourish.** A ninja's strike has no windup and no
celebration lap afterward — it commits, lands, and is over. A bouncy spring-overshoot open
animation is a puppy excited to see you. That is not what this instrument does. Ease-out to
settle, ease-in to withdraw, and stop — the "why" behind M1 isn't "calmer feels nicer," it's that
**flourish is a tell.** (→ M1-M4)

**Gnostic — the one layer that isn't "sci-fi ninja" by itself: most of what's true here is hidden
on purpose, and the interface should feel like it knows more than it's telling you.** Not through
lecturing (never explain the lore in a tooltip) but through structure: honest lacunae (say what's
missing, once, quietly, rather than fake a full state), seals that carry real meaning even when
you can't translate them, a spark motif for "there is a ghost operating this machine," never just
"a machine." (→ H3, H4, P1)

**What this is explicitly not, restated in the same key:** not a friendly rounded dark-mode SaaS
dashboard with a cyan-and-gold coat of paint on top. Getting the hex codes and corner radii right
while missing all five of the above is passing the letter of the axioms and failing the manifesto
— checkable is not the same as *generative*. If a new element only exists because a checklist item
told you to add it, and you can't say which of the five laws above it expresses, it isn't done yet.

---

## 0b. The one-sentence test

> **Does it read as a sealed fighter-craft HUD with a soul in the wiring — or as a cathedral, a
> tarot deck, a soft SaaS dashboard, or programmer-art rectangles?**

If you can't answer instantly, it fails. Everything below is that sentence (and the five laws
above it) made checkable.

---

## 1. Geometry axioms — no sausage, no plate

| # | Axiom | Check |
|---|-------|-------|
| G1 | **Corners are chamfered or crystal-cut, never iOS-rounded.** Max radius **12px**, and only on DOM shell chrome (`--shell-radius: 8–12px`). Phaser-canvas game/HUD elements use hard edges, chamfers, or facet cuts — never `strokeRoundedRect`/`fillRoundedRect` with a radius chosen for "friendliness." | grep for `borderRadius` > 12px in DOM CSS; grep for `RoundedRect(` with a radius param > ~6px in Phaser draw code. |
| G2 | **No filled card/plate as primary depth.** Depth comes from **stacked voids** (darker layers) and **seam brightness** (a lit 1px border), never from `box-shadow` elevation or a filled gradient rectangle standing in for a physical card. | Any DOM style with `boxShadow` used for elevation (not glow) + a `background: gradient` fill + a `border-radius` together = the exact "thick card" anti-pattern. Reject. |
| G3 | **Bracket / L-frame / thin filament border over filled box.** Prefer a hollow frame with a bright seam to a solid-fill panel. | Does the element have a filled interior with no void/transparency reasoning, or is the frame itself hollow with content floating in void behind it? |
| G4 | **Faceted, segmented state — not smooth bars/arcs.** Anything that depletes/fills (health, shield, cooldown, timer) draws as discrete faceted segments with hairline gaps (`facetedRing.ts` is the canonical implementation), not a smooth `fillRect`/`arc` sweep. Numeral readout is a secondary confirming signal next to the shape, never the only signal. | Is there a plain rectangular progress bar or smooth pie-wedge anywhere still shipping? That's pre-doctrine debt. |
| G5 | **Surfaces show flat polygonal facets (4-8 planes), 1px highlight on the upper edge, 1px shadow on the lower — never curved/soft shading or procedural noise.** | Applies to AI-generated chrome assets and hand-authored vector chrome alike. |

**Research grounding (2026-07-15, `~/Documents/JAKESJAM_UX_Research_20260715/`):**

- **G2/G3 — correction to the doctrine's own reasoning, not to the rule.** Gestalt "common
  region" research (Palmer & Rock, 1994) shows a *bounded region* — filled or hollow — is a
  strong, well-evidenced grouping cue; the literature does not say a hollow frame groups content
  *better* than a filled card. G2/G3 are correct as an **aesthetic choice** (void-and-seam depth
  language is the vessel identity; a filled card reads as a plate, which is off-doctrine on
  looks, not on usability) — don't cite "usability" as the reason a card fails review, cite the
  identity doctrine. A hollow frame with a lit seam satisfies the same Gestalt grouping job a
  fill would.
- **G4 — the segmented-facet choice is validated indirectly, not directly.** Industrial HMI/gauge
  research shows color-banded (good/warn/crit) segments read faster than plain unbanded
  displays, and that photorealistic gauge ornamentation adds no comprehension benefit over
  simple banded bars. That supports the *color-banding* half of G4 solidly. No study was found
  comparing faceted/segmented rings specifically against smooth arcs — treat "facets read
  clearer than smooth" as **design inference from the banding research, not a directly verified
  claim**, and don't oversell it as "science proved this" in reviews.
- **Circular vs. linear (action-bar orbs, cooldown rings):** comprehension research mildly favors
  linear bars for *precise* value comparison (straight-line lengths compare more accurately than
  curved ones). This is not a reason to change the orbs — G4/H5 already route precise comparison
  through the numeral, not the shape — but the circular choice should be understood as optimized
  for glanceability/compactness, not for precision, so a future reviewer doesn't "fix" it into a
  bar based on a half-remembered rule without this context.

---

## 2. Colour axioms — dual accent, never mixed on one control

| # | Axiom | Check |
|---|-------|-------|
| C1 | **Gold (`#c9a84c` family) = house / self-generated / Autogenes cosmetic tier. Cyan (`#8ff8ff` family) = combat / crystal rounds / live arena.** They never compete as primary on the same control. | Does a combat-HUD element (health, shield, ability, kill-feed, in-match nameplate) use gold as its dominant fill/stroke? That's a violation — gold is "almost never in combat HUD." |
| C2 | **In-match HUD stays cyan / element-colour / HP-lime. Gold is reserved for house surfaces** (HOME, SETTINGS, CLIPS, Elyad kicker, Autogenes cosmetic `accentColor`, share/highlight CTAs — clips are a "house" feature, not combat). | Audit every in-match overlay (draft, death, results, HUD) for stray gold outside a share/highlight button. |
| C3 | **One hot accent per element at a time, 1-2 per palette total** (Mirror's Edge discipline). Never five saturated colours competing in one panel. | Count distinct saturated accent hues in a single component. >2 without a semantic reason (element-colour table is the sanctioned exception) fails. |
| C4 | **HP/status colour ladder is fixed:** good `#b8f05a` (lime) → warn `#fde68a` (amber) → crit `#fb7185` (rose), shield `#93c5fd` (ice blue). Don't invent a fourth health colour language per component. | Grep new health-adjacent code for hex literals outside this ladder. |
| C5 | **Dead/extinguished state is desaturated grey (`#2a3550` family), not black, not the element's own dimmed hue.** An extinguished vessel reads as "off," not "darker." | Every `isDead`/eliminated visual state should converge on this one grey, everywhere it appears (nameplate ring, action-bar orb, world rig). |
| C6 | **Element-colour table is the one sanctioned rainbow** (`art-direction.md` §Colour) — fire/ice/lightning/void/etc each get one fixed hex. Never invent a new element hue outside that table. | New projectile/card-effect colour choices must map to an existing bucket. |
| C7 | **Colour never carries state alone — a second, colour-independent channel (shape, fill-amount, position, glyph) must be able to communicate the same state on its own.** ~8% of men have a color vision deficiency (red-green forms are ~99% of all cases), squarely in the hue range JAKESJAM's HP ladder and cyan/gold dual-accent both live in. | For any state indicator, cover one eye's worth of test: could a player who can't distinguish lime/amber/rose still read the state from shape/fill alone (e.g. the faceted ring's segment count)? If removing colour makes the element unreadable, it fails — and that must survive every future redesign, not just the current implementation. |

**Research grounding:** the faceted-ring's segment-fill-count already satisfies C7 by construction
(a player who can't tell lime from amber can still read "the ring is 40% full") — this was true
by accident of the ring mechanics before this axiom existed. C7 formalizes it as a protected
invariant so a future "prettier" redesign doesn't silently drop the redundant channel. Source:
color-blindness prevalence and redundant-coding accessibility research,
`~/Documents/JAKESJAM_UX_Research_20260715/`.

---

## 3. Chrome & density axioms — plate-less, scarce light

| # | Axiom | Check |
|---|-------|-------|
| H1 | **In-match HUD is plate-less.** Status = outline chips + floating type + thin underlines. No filled candy-plate backgrounds behind HUD text. | Any new HUD text/status element with a filled background box (not a hollow outline) fails. |
| H2 | **Light is scarce and state-driven**, not decorative. Idle = dim seam. Active/primary = steady conduit. Alive/ready/warning = pulse. Bloom is reserved for a genuine moment (pick / kill / draft commit) and is **short**. | Is anything pulsing or glowing with no state behind it (constant particle snow, ambient glow with no meaning)? Fails. |
| H3 | **One seal per card, one imprint per screen, never a wall of glyphs.** Untranslatable/Coptic marks follow the seal-line convention (`ⲪⲰⲤ · phōs` + gloss) when they appear at all — they are never bare, never a paragraph. | Any component using more than one mystic glyph mark, or a Coptic/rune string with no Latin gloss under it, fails. |
| H4 | **Honest lacunae.** Incomplete features say so once, small, dim, or hide entirely. No fake completeness, no lorem-as-content, no placeholder that reads as finished. | Empty states must read as genuinely empty, not styled like populated ones. |
| H5 | **Numbers are a confirming signal, secondary to shape/colour/animation.** A ring, bar, or icon carries the primary read; a numeral sits adjacent as backup, not the only source of truth. | Does the element require reading a number to understand state at a glance? If the shape alone can't tell you "good/warn/crit" or "ready/not," fix the shape first. |
| H6 | **No mass ornamentation on every element.** Reserve the richest treatment (facet count, glyph complexity, glow layering) for the highest-priority object in a view (e.g. local player > remote > bot in a roster); everything else gets the same recipe at lower visual weight, not a different recipe. | Are all rows/entries in a list rendered with identical visual weight regardless of who they are? For rosters/nameplates, the local player should read as primary without literally being a different component. |

**Research grounding:** H2 is directly supported by Feature Integration Theory (Treisman &
Gelade, 1980) — a single changed feature (one light, one pulse) "pops out" pre-attentively and
fast; *combinations* of simultaneously-changing features force slower serial search. Practical
refinement: when a state changes, prefer changing **one** channel at a time (color OR pulse OR
shape) as the primary cue rather than stacking three at once "for emphasis" — stacking slows
recognition rather than speeding it. H4/H5 map directly onto two of Nielsen's ten usability
heuristics (visibility of system status; recognition over recall) and onto the game-specific PLAY
heuristics (Desurvire & Wiberg, 2009) — this isn't just an aesthetic preference, it's a
well-established usability requirement independently arrived at.

---

## 4. Motion axioms — withdraw, don't ascend

| # | Axiom | Check |
|---|-------|-------|
| M1 | **Open = settle in** (opacity + scale 0.98→1, or y+6→0). **Close = withdraw** (fade, never fly/whoosh upward). | Any "slide up and out" / "rocket away" close animation fails — that's ascension language. |
| M2 | **Draft/selection hover = comes forward (depth/scale), not flies to heaven.** | Card hover states check against this specifically. |
| M3 | **Pause/aperture = the world dims**, not "teleport to a menu sky." Panel transitions use `160–220ms` ease-out, nothing longer without a reason. | |
| M4 | **No XP-bar-climbs-to-the-sky, no confetti rockets, no "ASCENDED" copy anywhere**, including flavour text and toasts. | Grep copy strings for level-up/ascend language. |

**Research grounding:** M1/M3's 160-220ms window is independently validated, not just a house
number — it sits inside the 100-300ms range Material Design's motion research recommends, and
comfortably clear of the ~500ms threshold past which transitions measurably disrupt flow and
attention. M1's "settle in / withdraw" language is the prose version of Disney's **Slow In / Slow
Out** principle (Thomas & Johnston, 1981) — ease-out on open, ease-in on close, never constant-
velocity motion (constant velocity reads as mechanical, not alive). When reviewing a new
transition, name the curve explicitly: open = ease-out, close = ease-in, no overshoot/spring
unless it's a genuine "arrival" moment (M2's card-forward hover, not a panel open). This is also
the citable reason `MatchResultsOverlay`'s "slam-in" (340ms+ with an overshoot spring, staggered
80ms per row) was flagged in the 2026-07-15 audit — it's not just louder than the house style, it
measurably exceeds the duration ceiling the research associates with disrupted flow, especially
stacked across a full roster.

---

## 5. Typography axioms

| # | Axiom | Check |
|---|-------|-------|
| T1 | **Combat HUD text is bold, `800–900` weight, monospace (`Space Mono`/`JetBrains Mono`/`Consolas` stack) for glanceability under pressure.** | |
| T2 | **House/shell titles can go lighter (`300–500`)** for kinship with the Autogenes Editions site — but never in-match. | |
| T3 | **Data/codes (room codes, clip ids, build tags) always monospace.** | |
| T4 | **Kicker: 11px / 900 / wide tracking / accent colour. Title: 28–38px (shell) or context-appropriate (match banners bigger). Body: 14–16px / 500. Button: 12–14px / 800 / tracking. Hint: 12px / muted.** | Match against `ui-shell-goal.md` §Type scale for any new shell panel. |
| T5 | **Never body copy in Coptic/Greek script without rule H3's gloss underneath, and never invent an unattested transliteration — see `visual-language-gnostic-vessel.md` "Naming protocol" rule 1 (spelling-confidence gate).** | |

---

## 6. Copy axioms

| # | Axiom | Check |
|---|-------|-------|
| P1 | **Show, don't lecture.** No in-UI gnosis/gnostic-terminology explainer text. Teach by encounter, not tooltip essay. | |
| P2 | **Death gets ≤1 contextual tip, evidence-based, never a generic "git gud."** Silence beats a fabricated tip. | |
| P3 | **Multiplayer honesty:** never claim a live multiplayer world "paused" or "froze" for a local UI action (e.g. Pause). Say "you are still in the world." | |
| P4 | **No feature-laundry-list copy.** One fantasy line ≤90 chars on HOME; no bullet dump of mechanics. | |

---

## 7. Button axioms — one hierarchy, one order, everywhere

Buttons are the highest-frequency touch point in the whole product and the one place
inconsistency is felt fastest ("why does this screen's primary action live in a different
spot/color/weight than every other screen's"). These axioms exist so a player never has to
re-learn where the important button is.

### 7a. The four kinds (visual hierarchy — `ui-shell-goal.md` §Buttons is the source)

| Kind | Look | When |
|------|------|------|
| **Primary** | Filled cyan (combat CTA) or gold (pure house CTA) — never both fighting on one button; 1px bright seam; spring press. Hot Lobby's specific rule: **cyan fill + gold 1px outer seam** (house holds the combat button) — this is the one sanctioned dual-accent button, not a pattern to copy elsewhere. | Exactly one per screen/panel. The single action you want taken. |
| **Secondary** | Hollow hull (no fill), dim seam at rest, brightens on hover/focus. | Alternative but non-primary actions (Practice, Create Room, Settings from HOME). |
| **Ghost** | No fill, no border, muted text only. | Low-commitment/escape actions (Cancel, Maybe later, Back) that shouldn't visually compete with anything. |
| **Danger** | Rose/copper seam (`#fb7185` family), never a screaming solid-red fill. | Leave/Delete/Disconnect-style destructive actions. |

Only one button on a given screen may be Primary. If a designer/agent reaches for a second
filled/bright button on the same panel, one of them is mis-classified — demote it.

### 7b. Spatial & ordering axioms

| # | Axiom | Check |
|---|-------|-------|
| B1 | **Primary CTA position is consistent across every panel of the same Place-tier.** Pick one convention (e.g. "primary sits first/top-left of its group, or centered as its own row above secondary actions" — whichever HOME already establishes) and never swap sides screen-to-screen. | Compare HOME's Hot Lobby placement against every other panel's primary action — same relative position within its panel? |
| B2 | **Secondary actions share one row/group, same visual weight as each other.** Never render two secondary actions at different sizes, weights, or one bordered/one not, on the same screen. | |
| B3 | **Ghost/ escape actions (Cancel, Back, Maybe later) occupy a consistent corner or trailing position** — never the same slot a Primary button uses on another screen. A player's muscle memory for "the button in this spot is safe to misclick" must never be violated by putting a destructive or primary action there instead. | |
| B4 | **Danger actions are always spatially separated from Primary/Secondary** (extra gap, own row, or a confirm step) — never adjacent enough to invite a misclick between "Leave" and "Resume." | |
| B5 | **Consistent spacing unit.** Gaps between buttons in a row/group use one spacing scale, not ad-hoc per-panel pixel values. Pick the value HOME uses and reuse it everywhere (shell CSS: prefer a `--shell-gap` custom property over inline magic numbers). | |
| B6 | **Consistent sizing.** A given button kind (Primary/Secondary/Ghost/Danger) is the same height/padding/font everywhere it appears, mobile min-height 48px per `ui-shell-goal.md`. Two "Secondary" buttons on different screens should be interchangeable if swapped. | |
| B7 | **Icon-only buttons always carry an accessible label** (aria-label or equivalent) and use the same icon-button frame (size, hit-target ≥40px, hover state) everywhere one appears (MENU, gear/settings, fullscreen toggle, share). | |
| B8 | **Order follows importance, not arrival order.** When a panel has multiple secondary actions, their left-to-right (or top-to-bottom) order should reflect actual priority to the player (most-used/most-relevant first), not the order they happened to be coded in. | |

### 7c. Anti-patterns specific to buttons (in addition to §9's general list)

- Two Primary-weight (filled/bright) buttons competing on one screen.
- A destructive action (Leave/Delete) using the same visual weight as Primary, or sitting where a Primary normally lives.
- A button whose color changes meaning between screens (e.g. cyan-fill meaning "confirm" on one screen and "cancel" on another).
- Hover/press feedback present on some buttons and silently absent on others of the same kind.
- A new button shipped without a corresponding compact/mobile sizing check (ties to S5).

**Research grounding:** B6's 48px mobile minimum isn't an arbitrary shell number — it sits inside
the target-size range Fitts's-Law-derived mobile guidelines converge on (Fitts, 1954: movement
time is a function of distance-to-target ÷ target size; small/distant targets cost real,
measured time and errors). B1/B2 ("exactly one Primary, secondary actions share one weight tier")
is the direct interface-design consequence of Hick's Law (Hick, 1952; Proctor & Schneider, 2018
review): choice time grows with the number of *visually competing* alternatives, but grouping and
clear hierarchy measurably cut that cost. B1/B3's "consistent position across screens" is backed
by the UX spatial-memory literature (NN/g and others): breaking a learned button position forces
users to relearn a mental map, the same mechanism as "a Windows user clicking bottom-left out of
habit." Full citations: `~/Documents/JAKESJAM_UX_Research_20260715/`.

---

## 8. Layout & system axioms

| # | Axiom | Check |
|---|-------|-------|
| S1 | **Every player-facing entity in a roster gets the same fused object** (identity + live state), not a split of "badge here, bar somewhere else." If health/shield/status apply to a player, they render on/around that player's own mark — not as a disconnected separate widget elsewhere on screen. | |
| S2 | **A resource/ability that can't act right now must visually say so — never show a "ready" state for something the player can't currently use** (dead, disabled, on a hard lock). | Check every conditional-disabled path (isDead, on-cooldown, not-yet-unlocked) actually branches the render, not just the underlying data. |
| S3 | **Consumable/panic-button input is never sharable with an ability/action slot** — if JAKESJAM ever ships a heal/consumable hotkey, it gets its own dedicated key, full stop (cross-referenced from the Diablo research: every mainline entry keeps this separation). | |
| S4 | **Capped, priority-ordered lists for anything that can grow unbounded** (buff/debuff rows, chip strips, clip lists). State the cap in a comment; log/flag what's dropped, never truncate silently in a way that could read as "that's everything." **Target ≤4 items for anything read under combat time pressure** (Cowan, 2001's better-controlled revision of working memory capacity); Miller's classic 7±2 is the ceiling only for untimed/browsable lists (menus, settings), not live combat state. | `ActionBarSystem.ts`'s `MAX_BUFF_TICKS = 6` sits at the edge of even Miller's original number and above Cowan's — flagged 2026-07-15 as a candidate to tighten, not yet changed. |
| S5 | **Compact/phone layouts are a first-class render path, not an afterthought.** Any new HUD element ships with an explicit compact-size branch (radius/gap/font), verified at ~400px width before it's called done — not just assumed to reflow. | This is a HARD rule from a real caught bug (2026-07-14, ActionBarSystem shipped without one, orbs clipped off-screen). |
| S6 | **The house (DOM shell: HOME/SETTINGS/CLIPS/ROOM/PAUSE) and the match (Phaser: HUD/draft/death/results) are one visual family, not two art styles.** Token values must be the same RGB whether expressed as a CSS custom property or a Phaser hex literal — check `palette.ts` and `style.css` agree. | |

---

## 9. What kills a PR on sight (the anti-pattern list)

Consolidated from every source doc — if a UI element matches ANY line here, it fails review
regardless of how polished it otherwise looks:

1. Robes, staves, pointy hats, scrolls, parchment, stone runes, stained glass, crosses, halos.
2. Big anime eyes, chibi proportions, cel-shaded faces, any face at all besides the visor seam.
3. Realistic gore/blood (crystal shards and rune flashes only).
4. Flat-vector "Dribbble" pastel illustration or tech-startup-mascot cleanliness.
5. 8-bit/NES/scanline chiptune-retro pixel art (unless a deliberate future opt-in theme).
6. "Olive teal charcoal rust scrap" industrial-scrap language (explicitly dead, v0.1 relic).
7. Toy-flat surfaces with no depth, no micro-gradient, no inner glow — "programmer-art rectangles."
8. Desaturated screenshots. World is dark; action is saturated. Grey reads as a failed pass.
9. Gold used as mass fill anywhere in combat HUD.
10. Coptic/gnosis lecture text in the gameplay path.
11. Ascension/level-up motion language (see M4).
12. Fake completeness — lorem-as-content, fake counts, fake store grids on an empty room.
13. A new filled-grey-card panel with a drop shadow and nothing else for depth.
14. Cyan and gold both fighting as primary on the same control (no dual-accent rule applied).
15. Reverting the vessel silhouette toward chunky tank armor.
16. A second competing "Play/Join/Host" control surface outside the one DOM front door.
17. A modal blocking tutorial, or a "Skip Tutorial" button.
18. Any resource/ability bar lying about current availability (see S2).
19. A new HUD element shipped with no verified compact/phone layout (see S5).

---

## 10. Reference tokens (for quick lookup, not the source of truth — that's `palette.ts` / `style.css`)

```
House gold        #c9a84c      Gold dim        #8a7033
Void deep          #0a0e1a      Void edge        #0d1117
Combat cyan        #8ff8ff      Teal support     #50e3c2 / #2d8a7e
HP good (lime)      #b8f05a      HP warn (amber)  #fde68a
HP crit (rose)      #fb7185      Shield (ice)     #93c5fd
Dead/extinguished  #2a3550      Text hi          #e8ecf4
Text mid            #9fe0cb      Text dim         #7a8299
```

Element-colour table (`art-direction.md` §Colour) and per-theme overrides (`themes.md`) are
authoritative for projectile/card element hues — this block is combat-HUD/shell chrome only.

---

## 11. How to use this file

- **Before shipping any new UI element:** run it against sections 1–8 top to bottom. Note any
  axiom it fails and why, in the PR/commit description if the failure is deliberate (rare —
  usually it means fix it).
- **During review/audit passes:** cite the specific axiom number (e.g. "G2 violation" beats
  "this looks off") so the fix is unambiguous.
- **When two docs disagree:** `visual-language-gnostic-vessel.md` wins on *why*; this file wins
  on *is this specific pixel/hex/radius compliant*. If this file and the code disagree, the code
  is wrong unless this file is out of date — update this file explicitly, don't just match stale
  code.
- **When research and identity are in tension:** identity wins on *look* (the vessel silhouette,
  void-and-seam depth, dual accent, scarce gold — none of that is up for a UX-research vote), but
  research wins on *quantified, checkable* parameters within that look (durations, sizes, caps,
  redundant-coding requirements). Research doesn't get a veto on the aesthetic; it gets a vote on
  the numbers inside it. See the "Research grounding" notes under each section, and the full
  report at `~/Documents/JAKESJAM_UX_Research_20260715/ux_academic_grounding_report.md`.

*Companion research doc:* `~/Documents/JAKESJAM_UX_Research_20260715/ux_academic_grounding_report.md`
— sourced HCI/UX literature review (Fitts's Law, Hick's Law, Miller/Cowan working-memory limits,
Gestalt grouping, Nielsen + PLAY game-usability heuristics, Disney animation principles,
colorblindness/redundant-coding research, aviation-HUD glanceability research) checked against
every axiom above. Read it before disputing a "Research grounding" note in this file.

*Companion to `docs/visual-language-gnostic-vessel.md` (source doctrine), `docs/art-direction.md`
(VFX/character numbers), `docs/ui-shell-goal.md` (shell architecture + tokens), `docs/themes.md`
(palette/juicing spec), `docs/asset-prompts/00-prompt-conventions.md` (AI-asset trade dress).*
