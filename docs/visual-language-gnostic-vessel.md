# Visual Language — Sci‑Fi Gnostic Vessel (UI + arena reskin north star)

**Status:** Living design language. Owns **how the product looks and feels**.  
**Locked hybrid:** **sci‑fi gnostic** — manufactured future first; gnostic research as *formal system* (light, void, vessel, withdraw), never as temple, church, or occult costume.  
**Consumes:** Autogenes Editions research (`/Projects/autogenes-editions`, fidelity meta-analysis, Allogenes / Philip / James), Nag Hammadi corpus notes (`game2lol/nag-hammadi-library`), existing **Gnostic Vessel** rig (`ProceduralPlayerRig`, `docs/art-direction.md` v0.3), crystal-tech / cyberpunk-sorcerer baseline.  
**Feeds:** `docs/ui-shell-goal.md` (shell chrome), `docs/visual-overhaul/*` (arena/draft), cosmetics (`accentColor` skins), Elyad house quiet branding.  
**Last written:** 2026-07-09.

---

## Mission

Finish the pivot that the character already started:

> A **ghost operating a manufactured vessel** — self-generated light in a lean **sci‑fi** frame —  
> and extend that grammar from the **sprite** to the **entire UI shell**.

**Sci‑fi gnostic** means:

| Layer | Job |
|-------|-----|
| **Sci‑fi (what you see)** | Hulls, conduits, projectors, void docks, HUD seams, crystal munitions, arena hardware |
| **Gnostic (how it’s structured)** | Inner spark vs shell, scarce revelation, withdraw-not-ascend, honest lacunae, untranslatable charge |

JAKESJAM stays a **crystal-tech arena shooter**. Autogenes / Nag Hammadi work is the **engineering philosophy** of light and enclosure — the same system that named **Autogenes** (self-begotten, not inherited programming) and that the Editions brand expresses as **midnight + gold + thin instrument chrome** (read: *avionics / relic interface*, not altar).

**Done (language level) =** every new panel, button, draft frame, and death screen can be checked against this document; a player feels *vessel, spark, void, seal, dock, withdraw* — **Warframe × Hyper Light × instrument panel** — never *Bible quiz*, *occult Hot Topic*, or *generic soft sci‑fi SaaS*.

---

## Sci‑fi gnostic in one glance

```
SCI-FI SURFACE                    GNOSTIC STRUCTURE
─────────────────                 ─────────────────
biomechanical hull                ghost in the frame (spark ≠ shell)
palm projector / cannon           activity of the vessel
spine energy conduit              vitality / “I am”
visor seam of light               aperture, not a face of flesh
void-black docks / panels         world as enclosure (temporary)
gold instrument rules (house)     self-generated tier / Autogenes
cyan combat glow (arena)          crystal rounds / live fire
bracket frames, mono codes        seals & unparsed charge
settle / dock animations          anachōrei = withdraw, not ascend
```

**If it reads as a cathedral, church, tarot deck, or “ancient aliens History Channel,” it failed.**  
**If it reads as a sealed fighter-craft HUD with a soul in the wiring, it passed.**

---

## What this is not

| Not this | Why |
|----------|-----|
| In-game scripture / sermon UI | Research is for *form*, not preach |
| Coptic wallpaper spam | One optional glyph max (Elyad/Autogenes imprint); never walls of letters |
| Robes, halos, crosses, stained glass | Wrong genre — this is **sci‑fi** gnostic |
| Replacing crystal-tech | Crystal-tech **is** the sci‑fi material language |
| Soft corporate sci‑fi (rounded white glass) | Too sterile; we want **void + filament + hull** |
| Dropping ROUNDS draft lessons | Bracket frames, dim/bright cards stay; vessel / instrument chrome |
| Full Autogenes Editions site clone | Serif body for books; game stays Inter / system + mono accents |
| Explaining *gnosis* in tooltips | Teach by encounter; keep technical charge in chrome |

---

## Source map (research → design)

### A. Autogenes (name + imprint)

| Research | Design consequence |
|----------|-------------------|
| **Autogenes** = self-generated / self-begotten (not from pairing or inherited code) | Characters and UI read as **manufactured shells with an inner spark**, not inherited “armor classes” |
| Triple: **Invisible Spirit → Barbelo → (Kalyptos / Protophanes / Autogenes)** | Visual hierarchy of revelation (below) — not a skill tree named after aeons |
| Distinct from the Invisible Spirit itself | Loud product = **JAKESJAM**; quiet source/house = **Elyad** / Autogenes cosmetic tier |

### B. Allogenes — the central motion fix

| Research | Design consequence |
|----------|-------------------|
| **anachōrei = withdraw**, not “ascend” | UI motion is **inward / settle / still**, never “level-up ladder” energy |
| Existence / Being / Activity kept distinct | Three chrome registers (below) — don’t collapse all glows into one cyan soup |
| Lacunae marked honestly | Empty states, damaged features, “not yet” copy — **no fake completeness** |
| Voces magicae left unparsed | Rare ritual marks (card rarity ticks, chaos sigils) can be **opaque glyphs** that *feel* charged without decoding |

### C. Fidelity meta-analysis (50-text audit)

| Research | Design consequence |
|----------|-------------------|
| *gnosis / archon / ousia* mishandled when flattened to plain English | Prefer **show** (light, enclosure, spine) over **label** (“Knowledge +3”) |
| Best translators flag damage | Settings, clips, pause: **honest constraints** (“records your play,” “world still live”) |
| Technical terms collapse kills meaning | Rarity / element / chaos keep **distinct visual axes** (shape / colour / trail already in art-direction) |

### D. Autogenes Editions brand chrome (shipped aesthetic)

From `autogenes-editions/site` + `meta-analysis.html`:

| Token | Hex | Role in game UI |
|-------|-----|-----------------|
| Gold | `#c9a84c` | **Autogenes tier** accent, sacred-thin rules, kicker |
| Gold dim | `#8a7033` | Borders at rest, secondary rules |
| Deep blue / midnight | `#0a0e1a` / `#0d1117` | Void fields (HOME, panels) |
| Navy / panel / slate | `#141b2d` / `#161d2f` / `#1e2740` | Surface steps |
| Text / dim | `#c8cdd8` / `#7a8299` | Body / mute |
| White | `#e8ecf4` | Titles |
| Teal | `#2d8a7e` | Bridge toward **gameplay cyan** (see dual accent) |
| Copper / rose / violet | supporting | Danger / void element cousins |

**Game still needs play-readability cyan** for projectiles and live combat (`#8ff8ff` / `#50e3c2`).  
**Rule:** **Gold = house / self-generated / cosmetic Autogenes.** **Cyan = combat / crystal rounds / live spark in the arena.** They meet on the vessel spine and draft brackets, never fight for the same job.

### E. Already shipped in JAKESJAM (do not reverse)

From `ProceduralPlayerRig` + art-direction v0.3:

- Visor **seam of light** (face = aperture, not eyes)
- Slim **hull**, not tank armor
- **Spine conduit** = vitality / “I am”
- Crystal joint seals
- Palm projector / energy channel
- `accentColor` reskin seam (Autogenes gold/teal tier called out in art-direction)
- Mad aura motes (field around vessel)

The UI reskin **extends** these, it does not invent a second mythology.

---

## Doctrine: five formal principles

### 1. Vessel, not plate (sci‑fi hull)

UI is a **manufactured hull** around content — thin sealed edges, hollow interior, light in the seams. Think **cockpit instrument**, not parchment.

- Prefer **bracket / L-frame / 1px filament border** over filled grey boxes  
- Prefer **void depth** behind panels over flat material  
- Corners: **chamfer or crystal cut**, not iOS sausage radius (8–12px max; gold rules can be hard-edged)  
- Materials read as **alloy + crystal + energy**, never wood, cloth, or stone-temple

*Anti:* thick white cards, Material elevation shadows as primary depth, neon everything, marble/gold “luxury mysticism.”

### 2. Spark, not flood

Inner light is **scarce and meaningful**.

| Intensity | Use |
|-----------|-----|
| Dim seam | Idle panel edge, muted secondary |
| Steady conduit | Primary CTA border, focused card |
| Pulse | Alive states: world live, clip ready, low HP warning (already on visor) |
| Bloom | Only on pick / kill / draft commit — short |

*Anti:* full-panel gradients that scream; constant particle snow on HOME.

### 3. Withdraw, don’t ascend

Motion grammar from Allogenes:

- Open panel: content **settles in** (opacity + slight scale from 0.98→1 or y+6→0)  
- Close: **withdraws** (fade, don’t whoosh upward like a level-up)  
- Draft hover: card **comes forward** (depth), not flies to heaven  
- Pause: world **dims** (aperture narrows); you do not “teleport to menu sky”

*Anti:* confetti rockets, XP bars that climb to the sky, “ASCENDED” copy.

### 4. Honest lacunae

From the fidelity project’s best practice:

- If a feature is incomplete, **say so once**, small, dim — or hide the entry  
- Empty CLIPS: plain truth (“No highlights this session”)  
- Don’t invent fake friend counts, fake store grids, fake lore scrolls  

*Anti:* placeholder lorem that looks like content; fake 5-star polish on empty rooms.

### 5. Untranslatable charge

Some marks **should not explain themselves** — but when Coptic appears, it is **never bare**:

| Layer | Rule |
|-------|------|
| **Seal line** | One Coptic phrase + Latin transliteration on the same line (`ⲪⲰⲤ  ·  phōs`) |
| **Gloss** | Short English under it (`light`) — instrument label, not a sermon |
| **Density** | **One seal per card**; draft header may use one house imprint (`ⲤⲪⲢⲀⲄⲒⲤ` seal) |
| **Accent** | Legendary → Autogenes **gold** (`ⲀⲨⲦⲞⲄⲈⲚⲎⲤ` / self-begotten); combat seals → cyan; void/defense → violet |

- Chaos modifier icons can stay abstract seals  
- Autogenes cosmetic imprint: gold seam + tiny seal — never gameplay tutorial walls of letters  
- Rarity: bracket colour + weight + **one** seal, not a paragraph  

Implementation: `client/src/game/ui/cardSeals.ts` (bucket/rarity → seal).  
Gameplay still needs **readable** card benefits (`+` / `−` lines). Charge lives in **chrome**; clarity lives in **copy that must be acted on**.

### 5b. Card aura (draft plates)

Cards are **vessel plates**, not tarot:

- Void field + radial **spark aura** from `visual.glowColor`  
- Dual-accent rim: gold (house / legendary) or cyan (combat) or violet (void/defense)  
- Soft pulse on the aperture orb (withdraw/settle, not XP rocket)  
- Orthodox *icon* influence is **composition only**: central spark, quiet margins, gold as scarce self-generated light — never robes, halos, or scripture panels

---

## Dual-accent system (the reskin key)

```
                    HOUSE / SELF-GENERATED          ARENA / COMBAT
                    ─────────────────────          ──────────────
Accent              Autogenes gold #c9a84c         Crystal cyan #8ff8ff
Support             gold-dim #8a7033                teal #50e3c2 / #2d8a7e
Field               midnight void                   arena theme voids
Typography quiet    thin gold kicker               cyan status / HP lime
```

| Surface | Dominant accent |
|---------|-----------------|
| HOME, SETTINGS, CLIPS, Elyad kicker | **Gold family** |
| Hot Lobby primary CTA | Gold fill **or** cyan fill with gold rule — pick one and keep forever: **recommended cyan fill + gold 1px outer seam** (house holds the combat button) |
| Draft brackets / hero | Cyan brackets (ROUNDS + crystal); gold only on Autogenes-owned cosmetics |
| In-match HUD | Cyan / element colours / HP lime — gold almost absent (keep combat pure) |
| Death | Void + single gold or cyan seam; tip in muted text |
| Autogenes cosmetic skin | Gold `accentColor` on vessel glows |

This is how **research brand** and **game readability** coexist without greying each other out.

---

## Three registers of chrome (Existence / Vitality / Mentality)

Map the Allogenes triad to UI *function* (not labels on screen):

| Register | Allogenes echo | UI expression |
|----------|----------------|---------------|
| **Existence** (hyparxis) | That it *is* | Panel presence, void field, silhouette frame — structure without glow |
| **Vitality** (life) | That it *lives* | Spine-like 1px filaments, pulse on live world, HP/conduit metaphors |
| **Mentality** (nous) | That it *knows* | Typography, draft choices, tips, settings — the only place words dominate |

Checklist for any new component:

1. Existence: does it sit in void with a clear hull?  
2. Vitality: is there **one** living light, not five?  
3. Mentality: is the text only what the player must decide?

---

## Revelation hierarchy (Kalyptos → Protophanes → Autogenes)

Use for progressive disclosure and visual state — **never** print these names in UI.

| Stage | Meaning | UI state |
|-------|---------|---------|
| **Kalyptos** (hidden) | Veiled | HOME atmosphere dim; secondary actions quiet; tutorials absent |
| **Protophanes** (first-appearing) | Coming into view | Hover/focus: bracket brightens, card undims, CTA seam ignites |
| **Autogenes** (self-generated) | Fully present / chosen | Selected, owned, equipped cosmetic, committed draft pick — stable bright, not frantic |

Draft overlay already dims inactive cards — that **is** Protophanes logic. Formalize it across shell lists (clips rows, settings sections).

---

## Component grammar (shell + match)

### ShellFrame (“sealed hull”)

```
┌─ 1px gold-dim / cyan seam ─────────────────┐
│  KICKER (11px, tracking, gold or cyan)     │
│  Title (white, weight 300–900 by context)  │
│  ── hairline ──                            │
│  Body (text / controls)                    │
│  Footer actions                            │
└────────────────────────────────────────────┘
```

- Background: `panel` / navy at 92–96% opacity over void  
- No drop-shadow blob; depth = **stacked voids** + seam brightness  
- Optional top-center micro-imprint (Autogenes Coptic or “ELYAD”) at 40–55% opacity — HOME only

### Buttons

| Kind | Look |
|------|------|
| Primary | Filled teal/cyan gradient **or** gold for pure house CTAs; 1px bright seam; spring press |
| Secondary | Hollow hull, dim seam, text bright on hover |
| Ghost | No fill, muted text |
| Danger | Rose/copper seam, no screaming red fill |

### Draft (keep ROUNDS structure, vessel-skin the metal)

- Cyan L-brackets stay (combat crystal)  
- Title float, dim others, +/− hierarchy stay  
- Backdrop: **void + blurred arena** (withdraw field), not bright brick unless theme asks  
- Hero presenter: **vessel rig**, not a separate mascot species  
- Optional: thin gold hairline under “BETWEEN ROUNDS” kicker (house holding the rite)

### HUD (plate-less, already directed)

- Floating type + thin underlines  
- Status = outline chips (existence), not candy plates  
- Gold almost never in combat HUD  

### Death / results

- Full void wash (aperture)  
- Single centered seal mark (✦ or thin diamond — already used)  
- One tip (mentality); optional share (vitality of the clip spark)  
- No “YOU DIED” soulless-souls clone; keep ELIMINATED / clean recovery pillar  

### Clips toast / CLIPS place

- Toast = temporary **Protophanes** of a highlight (seam bright, 15s withdraw)  
- List rows = hulls; vertical clip is the spark thumbnail  

---

## Typography

| Context | Face | Notes |
|---------|------|-------|
| Game UI | Inter / system UI sans (current) | Keep for readability at 12–14px |
| House imprint only | Optional Cormorant or similar **only** for Elyad/Autogenes wordmarks at large sizes | Never body copy in-match |
| Data / codes | JetBrains Mono (Autogenes site already uses it) | Room codes, clip ids, build tags |

Weight: house titles can go **lighter** (300–500) for Autogenes-site kinship; combat UI stays **800–900** for glanceability.

---

## Sound & motion (light touch)

- Open/close: soft “seal” — short, dry, not holy choir  
- Draft pick: crystal tick (existing juice)  
- Withdraw: volume dip on pause, not silence of death  

---

## Cosmetics bridge

| Tier (example) | `accentColor` | Seam language |
|----------------|---------------|---------------|
| Default crystal | `0x8ff8ff` | Cyan vessel (current) |
| Autogenes | gold `#c9a84c` + teal support | Gold visor/spine; house-tier |
| Future void | violet | Already element-adjacent |

Geometry never changes for paid skins — **research-true**: Autogenes is a mode of generation (light), not a new body schema.

---

## Relationship to other docs

| Doc | Relationship |
|-----|----------------|
| `art-direction.md` | Character silhouette remains canonical; this doc extends **UI + dual accent** |
| `visual-overhaul/DIRECTION.md` | Pillars 1–4 still valid; Pillar 5 vessel already landed; **chrome tokens here override “only cyan everywhere”** for shell |
| `ui-shell-goal.md` | Architecture/Places; **this doc is the skin and soul of those Places** |
| `themes.md` | Arena themes remain; shell HOME uses Autogenes midnight void regardless of arena |
| Autogenes Editions site | Brand sibling; game borrows tokens, not layout density of essays |

---

## Reskin priority (when executing UI shell)

Order for maximum “we meant this” signal:

1. **CSS tokens** — add gold family + void steps beside existing cyan (do not delete cyan)  
2. **HOME** — gold kicker ELYAD / thin imprint; void gradient; primary CTA with dual-accent rule  
3. **SETTINGS / CLIPS frames** — ShellFrame hull + hairlines  
4. **Draft kicker + backdrop void** — without rewriting card logic  
5. **Death/results void wash**  
6. **Autogenes cosmetic** — wire gold `accentColor` path for showcase  
7. **Optional** loading / boot Coptic micro-imprint  

---

## Acceptance checks (visual language)

A reviewer can fail a PR for:

- [ ] Gold used as mass fill on combat HUD  
- [ ] Coptic or “gnosis” lecture text in gameplay path  
- [ ] Ascension/level-up motion language  
- [ ] Fake completeness / lorem as content  
- [ ] New panel that is a filled grey card with drop shadow only  
- [ ] Cyan and gold both fighting as primary on the same control without the dual-accent rule  
- [ ] Reverting vessel silhouette toward chunky armor  

A reviewer passes when:

- [ ] Shell feels like **same house** as Autogenes Editions midnight/gold without becoming a book site  
- [ ] Arena still **reads crystal combat** at a glance  
- [ ] Vessel rig and UI seams feel like **one manufactured system**  
- [ ] Empty and partial states are honest  

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Myth in UI | Formal system, not story dump | Research depth without alienating players |
| Dual accent | Gold house / cyan combat | Bridges Autogenes brand and play readability |
| Motion | Withdraw/settle | Allogenes *anachōrei* correction as UX law |
| Honesty | Lacuna-grade empty states | Fidelity project ethics → product trust |
| Typography | Sans for game, serif only imprint | Don’t sacrifice HUD legibility |
| Names on screen | JAKESJAM loud; Elyad/Autogenes quiet | Stealth house + product clarity |
| Draft | Keep ROUNDS grammar, vessel chrome | Best UI preserved |

---

## One-liner

> **Sci‑fi gnostic: reskin shell and chrome as manufactured vessel UI — void docks, filament seams, scarce inner light, dual accent (Autogenes gold house / crystal cyan combat), withdraw-not-ascend motion, honest lacunae — Warframe-grade hull with Autogenes structure, zero temple, zero sermon.**

---

## Naming protocol — historical vs. invented

When a new figure/entity needs a name, decide in this order. Don't default to "always use the real ancient name" — a clunky-but-authentic name and a great invented one are BOTH on the table; pick whichever actually reads better on screen.

1. **Spelling confidence gate (hard rule, no exceptions).** Never render an invented Coptic/Greek script transliteration for a name you aren't independently confident is correctly attested. If unsure, use the Latin transliteration only (plain English letters), or invent an original name instead. Guessing at ancient orthography and presenting it as authoritative is worse than admitting uncertainty — see Estaphaios: named after a real, well-attested archon, but rendered in Latin only rather than fabricated Coptic glyphs.
2. **Does the real name actually sound good said out loud, in this game's register?** Short, punchy, pronounceable on first read wins. A five-syllable theological compound that a player will silently mangle every time isn't earning its "authenticity" — swap it for an original name inspired by the same mythological *function* instead.
3. **Does using the real name serve the mystery, or just flex research?** The payoff of a real name is "this could genuinely mean something — it's not just a made-up game word." If that numinous weight isn't landing (the term is too obscure to register as anything, real or invented), an original name serves the moment just as well without the research being wasted — the underlying myth-logic still informs the design even if the label is ours.
4. **High-frequency, UI-critical names lean invented.** Anything said constantly, or that has to work in a HUD/health-bar/marketing context, should win on brand fit first, correctness second. Anything named ONCE, at a special beat (a gasp, a manifestation), can afford to spend real scholarly weight since it's not competing with legibility fatigue.
5. **Always keep the mythological FUNCTION real even when the LABEL is invented.** An original name for "the third lesser ruler under the Demiurge, hyena-faced, governing a day of chaos" is still built from real Gnostic cosmology — the substance doesn't have to be sacrificed just because the label changes. Document the real referent in a code comment either way, so the design intent survives even if the on-screen name doesn't literally match it.

Applied so far: Yeldabaoth (real, short, sounds genuinely alien — kept). Sephia (real, universally recognizable even to non-specialists — kept, one-shot naming). Estaphaios (real, confirmed as the third archon with a hyena's face in the Apocryphon of John — kept as Latin-only per rule 1; the hyena-face detail is real source material worth folding into the design even though the boss doesn't currently show it).

---

## Appendix — Phrase bank (internal only; not player-facing)

Use in design reviews, not splash copy:

- sealed hull · seam of light · spine conduit · scarce spark  
- withdraw / settle · first-appearing / fully present  
- honest lacuna · untranslatable charge · self-generated accent  
- house gold · combat cyan · aperture pause  

Player-facing splash stays plain:

- “Crystal-tech arena. Draft between rounds. Spawn in seconds.”

---

*Sibling to `docs/ui-shell-goal.md`. Execute shell architecture with this language as the non-negotiable skin.*
