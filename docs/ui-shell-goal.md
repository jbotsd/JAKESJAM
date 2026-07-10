# GOAL — UI Shell (house architecture, done-done)

**Status:** North star for menus, shell navigation, share/clips product surface, and in-match chrome that is not combat VFX.  
**Supersedes on conflict:** dual front doors (DOM splash + decorative Phaser MainMenu as competing homes); ad-hoc inline-only panel styles without shared shell primitives; toast-as-only-clips-UI; options-as-two-controls forever; **cyan-only shell chrome that ignores the house/gold register**.  
**Does not supersede:** sim authority / deploy / aegis (`CLAUDE.md`); Escalation Engine draft doctrine (`docs/escalation-engine-goal.md`); character silhouette (`docs/art-direction.md` gnostic vessel); FTUE “no modal tutorial” rule (`.agents/skills/onboarding-ftue/SKILL.md` — this goal *implements* the shell that skill assumes).  
**Visual skin (non-negotiable):** `docs/visual-language-gnostic-vessel.md` — **sci‑fi gnostic** (manufactured hull / void dock first; Autogenes formal system underneath: scarce spark, dual accent gold/cyan, withdraw-not-ascend, honest lacunae). Architecture here; **look and motion language there**. Not temple, not soft SaaS sci‑fi.  
**Product face:** **JAKESJAM** is the game title; **Elyad** is the quiet house (domain / imprint); **Autogenes** is the research-tier cosmetic/house gold register — never a lecture. Shell never confuses these.  
**Last written:** 2026-07-09.

---

## Mission

Make the **front of the product as deliberate as the sim and the clip pipeline**.

Today: combat, draft, net, and highlight capture are deep. Arrival, settings, pause, clips-as-product, and death/results as *places* are thin. A player who lands on `play.elyad.io` (or Funnel interim) judges the **house** in five seconds — not the Zig step strategy.

**Done =** one canonical shell architecture; one front door; a small set of named Places with shared chrome; clips and share feel like product features; death and results teach and convert; private room / practice remain second-class but not broken; world join stays under ~10s for a returning player; code is composable so new panels do not re-invent fixed overlays; tests cover shell state transitions and critical panel open/close; live playtest confirms “this feels like a finished game, not a kiosk over a sim.”

---

## What this is not

| Not this | Why |
|----------|-----|
| A multi-game portal / free-games site | One game house; catalog spam is out of scope |
| React / Vue / full SPA rewrite | DOM + TypeScript controllers already own lobby; Phaser owns match. Stay dual-layer by design |
| Rewriting CardDraftOverlay from scratch | Draft is the best UI; polish and shared chrome only |
| TikTok Developer OAuth UI for players | Admin `/tiktok/*` stays ops; players use Watch / Copy / Share |
| Modal tutorial / “Press WASD” | FTUE skill forbids it; shell enables progressive disclosure instead |
| Friends list, ranked ladder, account system | Stealth house + jam scale; identity stays local `playerId` + name |
| Full cosmetics storefront | Stripe catalog may exist server-side; store UI is a **later** Place, not phase 1 |
| Sim / netcode / escalation economics | Orthogonal goals |

---

## The reasoning flaw this kills

**Proxy:** “The game is the match loop → menus are glue.”  
**Product:** “The match is the engine; the shell is the product surface people actually touch first and return to.”

Building deep sim with a thin kiosk produces a paradox: the best work is invisible until after a player has already bounced. Clips without a **place** become debug artifacts. Options with two toggles signal prototype. Two half-menus signal confusion.

---

## Locked doctrine (one page, no alternatives)

### 1. One front door

- **Canonical home** is the **DOM shell** (`#app` host surfaces under `client/src/main.ts` + shell modules).
- **Phaser `MainMenuScene`** is **not** a competing product menu. It either becomes a **passive atmosphere layer** (preview rig / backdrop only, no CTAs) or is retired from navigation. No second set of Join/Host/Practice buttons in Phaser.
- Deep links (`?world=1`, room codes, future `?clips=1`) land through the shell router, not by inventing a third entry path.

### 2. Places, not pages

The shell is a **finite state machine of Places**. Each Place has exactly one job.

| Place | Job | Primary CTA |
|-------|-----|-------------|
| **HOME** | Orient + enter | Hot Lobby |
| **SETTINGS** | Preferences + privacy | Back |
| **CLIPS** | Review / share highlights | Share / Copy / Watch |
| **ROOM** | Private lobby prep (host/join) | Ready / Start / Leave |
| **PRACTICE** | Solo local match (handoff to Phaser) | — (in match) |
| **WORLD** | Always-on FFA (handoff to Phaser) | — (in match) |
| **MATCH** | Combat + draft + death + results (Phaser + match overlays) | — |
| **PAUSE** | Escape hatch without full disconnect story confusion | Resume / Settings / Leave |

`ROOM` is the existing lobby panel, re-homed under shell navigation.  
`MATCH` already exists via `OnlineMatchScene` / `MatchScene` + `HudCompositor`. This goal **extends** compositor contracts; it does not replace them.

### 3. World-first, friction-last (pillar 4)

```
URL → HOME (or auto WORLD if ?world=1 / returning preference)
  → WORLD in <10s for a player who already has a name
```

- **Hot Lobby** is the only primary CTA on HOME.
- Practice, Create Room, Join Room are **secondary** (same visual weight tier as Settings / Clips).
- Name/colour collection: prefer **lazy** — ask only if missing, or use last localStorage values silently. Never force a character-select gauntlet before world.
- Ready buttons stay **private-room only**, never world.

### 4. House vs product naming

| Layer | Copy |
|-------|------|
| Tab / OG / loud title | **JAKESJAM** |
| Quiet kicker / footer | **Elyad** (optional, small) |
| Share text | “JAKESJAM highlight” (not “Elyad clip”) |
| Domain | `play.elyad.io` is infrastructure brand; never replace game title in H1 |

### 5. Shared chrome or it didn’t happen

Every non-match panel (HOME rail, SETTINGS, CLIPS, ROOM, PAUSE, and eventually store) is built from **shell primitives**:

- `ShellFrame` — **sealed hull** panel (kicker + title + body + optional footer) per gnostic vessel grammar
- `ShellButton` — primary / secondary / ghost / danger
- `ShellToast` — ephemeral (clips toast migrates here)
- `ShellDrawer` — side/bottom sheet for CLIPS / SETTINGS on mobile
- Tokens: extend `style.css` with **dual accent** — house gold (`#c9a84c` family from Autogenes Editions) + combat cyan (existing); see `docs/visual-language-gnostic-vessel.md`

Match-critical overlays (draft, death, results, connection) **keep** their specialized layouts but **adopt** shared tokens, type scale, and **withdraw/settle** motion. They do **not** need to become generic frames if that hurts draft readability.

**Motion law:** open = settle inward; close = withdraw. No “level-up ascend” language (Allogenes *anachōrei* correction).

### 6. Clips are a product surface

| Surface | Role |
|---------|------|
| **Consent** | Settings + first-enable explanation (records gameplay to server) |
| **Toast** | Immediate post-upload (“Highlight ready”) |
| **CLIPS Place** | Session list (and later server index): Watch / Copy / Share / Original |
| **Death / Results** | Optional “Share highlight” when a clip URL exists for this life/match |
| **TikTok API** | Out of shell scope (admin) |

No silent recording. Consent remains `clipConsent.ts` as single source of truth.

### 7. Teach without tutorials

Aligned with FTUE skill:

- HOME may show **live atmosphere** (bots / preview) behind UI — show, don’t tell.
- First-fight control legend: only first session, ≤3s, auto-fade (match overlay, not HOME modal).
- First-ever draft: one extra hint line in existing draft overlay.
- Death: **one** contextual tip max; never three.
- No “Skip Tutorial” button. No blocking modal tutorial.

### 8. Dual-layer architecture is intentional

```
┌─────────────────────────────────────────────────────────┐
│  DOM Shell (always mounted under #app)                  │
│  ShellController + Places: HOME, SETTINGS, CLIPS, ROOM  │
│  PAUSE overlay (when match active)                      │
│  Toasts                                                   │
└───────────────────────────┬─────────────────────────────┘
                            │ handoff events
┌───────────────────────────▼─────────────────────────────┐
│  Phaser Game (#game-root)                               │
│  Boot → Preload → atmosphere MainMenu (optional)        │
│  Match / OnlineMatch + HudCompositor overlays           │
└─────────────────────────────────────────────────────────┘
```

- **DOM owns navigation and meta-UI.**  
- **Phaser owns the arena and match HUD.**  
- Cross-boundary communication uses **typed custom events** (existing pattern: `jakesjam:return-to-lobby`, `jakesjam:back-to-splash`) expanded into a small event bus contract — not ad-hoc DOM queries from scenes into splash.

### 9. Performance & safety

- Shell must not run heavy work at 60Hz. Match rAF stays in Phaser / ClipRecorder.
- CLIPS list is session-memory first; no unbounded DOM.
- Leave World / Leave Room must tear down WS cleanly (existing paths).
- Settings and Clips panels are **inert when hidden** (no timers, no media).
- Accessibility baseline: focus trap in modal-like drawers, Esc closes, labels on icon buttons, contrast per existing accent-on-dark.

---

## Current state (baseline, honest)

| Area | Today | Gap |
|------|-------|-----|
| Splash | 5 buttons + thin options | No hierarchy, no atmosphere contract, no clips place |
| Lobby | Large `LobbyController` + DOM | Works; not under a Place router; visual inconsistency |
| MainMenuScene | Decorative Phaser text + rig | Competing mental model; dead CTAs in copy |
| HudCompositor | Good seam for match overlays | Missing pause, death tips, clip CTA hooks |
| ClipShareToast | Ephemeral only | No CLIPS Place; no death bridge |
| Options | Volume + clips checkbox | No sections, no privacy copy, no SFX split |
| DeathOverlay | Title + timer | No tip, no killer, no share |
| MatchResults | Score + rematch | No clip CTA, weak brand cohesion |
| FTUE skill | Written | Unimplemented shell hooks |
| Shared primitives | Partial CSS buttons | No ShellFrame / controller |

---

## Target architecture

### Module layout (new / evolved)

```
client/src/
  shell/                          # NEW — DOM product shell
    ShellController.ts            # FSM + show/hide places + event bus
    places/
      HomePlace.ts
      SettingsPlace.ts
      ClipsPlace.ts
      RoomPlace.ts                # wraps/refactors lobby DOM ownership
      PausePlace.ts
    chrome/
      ShellFrame.ts
      ShellButton.ts              # or CSS component classes only — pick one style
      ShellToast.ts               # absorbs ClipShareToast
      tokens.css                  # or extend style.css with shell section
    clipSession.ts                # in-memory list of {url, kind, atMs, label?}
    types.ts                      # PlaceId, ShellEvent map
  game/ui/
    LobbyController.ts            # slimmed: room domain only, no splash routing
    ClipShareToast.ts             # → re-export / migrate to shell/chrome/ShellToast
    HudCompositor.ts              # + onPauseRequest, death tip, clip share hooks
    DeathOverlay.ts               # + tip slot + optional share action
    MatchResultsOverlay.ts        # + optional share action
    ...
  main.ts                         # bootstrap shell + game; thin glue only
```

**Rule:** `main.ts` stops being a 800-line god-file of HTML strings + listeners. Markup may stay template-literal initially **or** move to constructed DOM in place modules — either is fine if **ownership is clear**. Prefer place modules own their DOM after first PR.

### Shell FSM

```
                    ┌──────────────┐
                    │    HOME      │◄──────────────────────────┐
                    └──────┬───────┘                           │
           Hot Lobby      │     Settings / Clips / Room       │
                           ▼                                   │
                    ┌──────────────┐     Leave / disconnect    │
                    │ WORLD|MATCH  │───────────────────────────┤
                    └──────┬───────┘                           │
                      Esc  │                                   │
                           ▼                                   │
                    ┌──────────────┐  Resume                   │
                    │    PAUSE     │───────────────────────────┘
                    └──────────────┘  Leave → HOME
```

- From HOME: Settings, Clips, Room (private), Practice → MATCH (local), World → MATCH (online).
- SETTINGS and CLIPS open as **drawers/modals over HOME** (or over PAUSE), not full route replacements that destroy home state — except deep link `?place=clips`.
- Only one exclusive full-screen Place at a time among HOME / ROOM; SETTINGS/CLIPS/PAUSE are **layers**.

**PlaceId:**

```ts
type PlaceId =
  | "home"
  | "settings"
  | "clips"
  | "room"
  | "pause";

type MatchMode = "none" | "practice" | "world" | "private";
```

`MatchMode` is orthogonal: shell can show PAUSE only when `matchMode !== "none"`.

### Event bus contract

Extend the existing `window` CustomEvent pattern with a **typed map** (document in `shell/types.ts`):

| Event | Direction | Payload | Meaning |
|-------|-----------|---------|---------|
| `jakesjam:shell-goto` | any → shell | `{ place: PlaceId }` | Open place |
| `jakesjam:enter-world` | shell → main | `{}` | Start world join path |
| `jakesjam:enter-practice` | shell → main | `{}` | Start practice |
| `jakesjam:enter-room` | shell → main | `{ mode: "host" \| "join" }` | Show room place |
| `jakesjam:match-started` | main → shell | `{ mode: MatchMode }` | Hide home chrome |
| `jakesjam:match-ended` | main → shell | `{}` | Allow home return |
| `jakesjam:return-to-lobby` | match → shell | `{}` | **Existing** — route through shell |
| `jakesjam:back-to-splash` | room → shell | `{}` | **Existing** — → HOME |
| `jakesjam:clip-uploaded` | match → shell | `{ url, kind, label? }` | Toast + clipSession |
| `jakesjam:pause-toggle` | match/shell | `{}` | Open/close PAUSE |
| `jakesjam:request-leave-match` | shell → main | `{}` | Tear down match |

No scene imports `ShellController` directly. Scenes emit events; shell listens.

### clipSession (client memory)

```ts
type ClipEntry = {
  id: string;           // uuid client-side
  url: string;          // absolute /clips/...
  kind: "vertical" | "original";
  pairId?: string;      // group vertical+original from same trigger
  label?: string;       // highlight label if known
  atMs: number;
};
```

- Cap **N = 24** entries (evict oldest).
- Pair vertical + original for display (one row, two actions).
- Optional later: `GET /clips/recent` — **out of phase 1** (requires auth story). Phase 1 is upload-path observation only.

### HudCompositor extensions (match layer)

Add optional callbacks / methods — do not break existing callers:

```ts
// conceptual
type HudCompositorCallbacks = {
  onCardPick: ...;
  onRematch: ...;
  onReturnToLobby: ...;
  onShareClip?: (url: string) => void;  // opens native share or copies
  onOpenClips?: () => void;
};

// DeathOverlay
show(remainingSec, opts?: { tip?: string; shareUrl?: string });

// MatchResultsOverlay  
// optional shareUrl on view model
```

**Death tip selection** (pure function, unit-tested):

```
pickDeathTip(events, localPlayer) → string | null
```

Rules (max one):

1. Died to projectile while parry available recently → parry tip  
2. Died at long range with dodge available → dodge tip  
3. Else null (silence is fine)

Do **not** invent tips without signal. Prefer silence over generic “git gud.”

### Pause Place

- Desktop: **Esc** toggles (when not in draft UI — draft eats input first).
- Mobile: small gear / pause hit target in safe corner (does not collide with touch controls; use same band logic as clip toast).
- Contents: Resume · Settings · Clips · Leave World/Match (confirm if world).
- Pausing **does not** freeze the server sim for others (world is live). Copy: “You are still in the world” / leave vs resume only. Local-only visual pause of input is OK; do not claim the match is frozen.

### HOME Place layout (spec)

```
┌──────────────────────────────────────────────┐
│ [atmosphere: dim live canvas or CSS motion]  │
│                                              │
│  ELYAD (kicker, small)                       │
│  JAKESJAM (H1)                               │
│  One-line fantasy                             │
│                                              │
│  [ JOIN WORLD ]  ← primary                   │
│                                              │
│  Practice   Private room   Clips   Settings  │
│                                              │
│  world status badge (players / live)         │
└──────────────────────────────────────────────┘
```

Copy constraints:

- Fantasy line ≤ 90 chars. Example direction: “Crystal-tech arena. Draft between rounds. Spawn in seconds.”
- No feature laundry list.
- World status uses existing `MatchStatusBadge` / `/world/summary` path.

### SETTINGS Place layout

Sections (accordion or stacked headers):

1. **Audio** — music volume, mute (existing); reserve SFX slot disabled or wired if easy  
2. **Clips** — enable toggle, one paragraph privacy, link “Open clips”  
3. **Controls** — static legend (keyboard + touch); not rebinding phase 1  
4. **Display** — optional “Reduce camera juice” if flag already exists (`fx=off` pattern)

### CLIPS Place layout

- Empty: short explanation + “Enable auto-clip in Settings” if off  
- List: newest first; vertical preferred thumb (or icon + time + label)  
- Actions per row: Watch · Copy · Share · Original (if pair)  
- Footer note: clips expire by server quota (honest)

### ROOM Place

- Reuse lobby fields (name, colour, character, chaos, map, code, ready, start).
- Visual restyle into ShellFrame; **behavior** stays `LobbyController` domain logic.
- “← Home” replaces ambiguous splash wording.

---

## Visual system

**Full formal system:** `docs/visual-language-gnostic-vessel.md` (void hull, dual accent, revelation hierarchy, lacuna honesty). Summary only below.

### Tokens

Extend `:root` in `style.css` (source of truth for DOM):

| Token | Role |
|-------|------|
| `--shell-bg` | Midnight void (`#0a0e1a` / `#05080f`) |
| `--shell-surface` | Panel navy (`#161d2f` family) |
| `--shell-border` / `--shell-border-glow` | Gold-dim at rest; brighten on focus |
| `--shell-accent-house` / `--shell-accent-house-dim` | Autogenes gold `#c9a84c` / `#8a7033` |
| `--shell-accent` / `--shell-accent-bright` | Combat cyan (live CTA / crystal) |
| `--shell-danger` | Rose/copper leave |
| `--shell-text` / `--shell-muted` | `#e8ecf4` / `#7a8299` family |
| `--shell-radius` | 8–12px (hull, not sausage) |
| `--shell-z-home` … `--shell-z-toast` | Z ladder |

**Dual-accent rule:** house surfaces lean gold; combat HUD stays cyan/element; primary Hot Lobby = cyan fill + gold outer seam (house holds the combat button).

Phaser match HUD may keep number colors via `palette.ts`; **do not** fork a third palette. When in doubt, map Phaser hex to the same RGB as CSS tokens.

### Type scale

| Role | Size / weight |
|------|----------------|
| Kicker | 11px / 900 / tracking wide / accent |
| Title | 28–38px / 900 |
| Body | 14–16px / 500 |
| Button | 12–14px / 800 / tracking |
| Hint | 12px / muted |

### Motion

- Panel open: 160–220ms opacity + translateY(6px→0), ease-out  
- Button press: existing spring scale in CSS  
- Toast: same as today, auto-dismiss 15s  
- **No** perpetual large animations on HOME that steal GPU from world preview  

### Mobile

- Primary CTA full-width, min-height 48px  
- Secondary actions 2×2 grid or horizontal scroll chips  
- Drawers from bottom for SETTINGS/CLIPS  
- Respect `env(safe-area-inset-*)`  
- Portrait: toast/pause controls above touch band (existing clip toast rule generalizes)

---

## Integration with existing systems

| System | Integration |
|--------|-------------|
| `clipConsent.ts` | Settings toggles; HOME never enables silently |
| `ClipRecorder` / highlights | Emit `jakesjam:clip-uploaded` from OnlineMatchScene onUploaded (already logs) |
| `LobbyController` | Room domain only; navigation via shell events |
| `host-public` / elyad | Absolute clip URLs already origin-based; shell share uses same |
| Music contexts | `menu` vs `world` stay in main; shell fires enter/leave only |
| Escalation draft | Unchanged; draft overlay may take shared type tokens only |
| Stripe / TikTok admin | Not in shell places phase 1–3 |

---

## Phased delivery (done-right without big-bang)

Phases are **mergeable vertical slices**. Each phase leaves the product playable.

### Phase 0 — Architecture spine (must ship first)

- Add `client/src/shell/` with `ShellController`, `PlaceId`, event types  
- Extract splash show/hide + options into shell without visual redesign  
- Route existing buttons through `goto(place)`  
- Document event bus in this file (already here) + short `docs/ui-shell.md` pointer from README if needed  
- **Acceptance:** all current flows still work; no new UI chrome required  

### Phase 1 — HOME + SETTINGS depth

- HOME visual hierarchy + copy + secondary rail  
- SETTINGS sections + clips privacy copy  
- Retire Phaser menu CTAs / relegate MainMenuScene to atmosphere  
- **Acceptance:** new player understands Hot Lobby in &lt;3s of looking; settings explain clips  

### Phase 2 — Clips product

- `clipSession` + CLIPS Place  
- Migrate toast to ShellToast  
- Wire `jakesjam:clip-uploaded`  
- Death/results optional share when URL present  
- **Acceptance:** after one highlight, player can re-open Clips and share without hunting console  

### Phase 3 — Pause + leave clarity

- PAUSE place + Esc / mobile entry  
- Honest “world still live” copy  
- Leave path single-story  
- **Acceptance:** player can open settings mid-world without feeling stuck  

### Phase 4 — Teach hooks

- Death tip pure function + UI slot  
- First-draft hint once (`localStorage` flag)  
- Optional first-session control legend (match only)  
- **Acceptance:** FTUE checklist items for death/draft/legend green without modal tutorial  

### Phase 5 — Polish pass

- Token unification across draft/death/results  
- Motion + focus traps + a11y pass  
- Remove dead splash HTML / unused MainMenu text  
- **Acceptance:** visual QA checklist; no orphaned styles  

---

## Testing strategy

| Layer | What |
|-------|------|
| Unit | Shell FSM transitions; death tip picker; clipSession cap/pair |
| Component | Place open/close; Esc; focus trap (jsdom or happy-dom if already in stack; else lightweight DOM tests with bun:test) |
| E2E (Playwright) | HOME → Hot Lobby happy path; Settings toggles clips; clip toast path with `?clips=1` if stable; Pause open/close |
| Manual | Mobile portrait touch band; Funnel URL share; private room host/join regression |

Do **not** require live TikTok API for shell acceptance.

---

## Anti-patterns (reject in review)

1. **New panel with only inline styles and no tokens**  
2. **Second Hot Lobby button in Phaser**  
3. **Modal “tutorial”**  
4. **Clips without consent copy**  
5. **Pause that claims to freeze a multiplayer world**  
6. **God-file growth in `main.ts`** — new UI goes in `shell/`  
7. **Importing Phaser scenes from shell** — events only  
8. **Building a portal / multi-game home**  
9. **Player-facing TikTok OAuth**  
10. **Generic death tips with no evidence**  
11. **Settings that reset every visit** — persist like today  
12. **Blocking world join on cosmetics / character / chaos**  

---

## Acceptance criteria (goal done-done)

### Product

- [ ] One front door; no competing Phaser product menu  
- [ ] HOME primary CTA is Hot Lobby; secondary actions clear  
- [ ] SETTINGS has Audio + Clips (+ Controls at least as static legend)  
- [ ] CLIPS place lists session highlights; share/copy/watch work  
- [ ] Toast still fires on upload; does not replace CLIPS place  
- [ ] PAUSE available in world/practice/private match  
- [ ] Death can show ≤1 tip; optional share if clip URL known  
- [ ] Returning player with saved name reaches world in &lt;10s after click (network permitting)  
- [ ] Elyad kicker optional; JAKESJAM remains H1  

### Engineering

- [ ] `client/src/shell/` owns navigation FSM  
- [ ] Typed event contract documented and used  
- [ ] `LobbyController` no longer routes splash  
- [ ] Unit tests for FSM + death tips + clipSession  
- [ ] E2E smoke for HOME → world entry  
- [ ] `main.ts` net line count reduced or stabilized (no new features added there)  

### Explicit non-goals remaining OK after done

- No TikTok auto-post UI  
- No server-side clip gallery index  
- No full storefront  
- No control rebinding  
- No friends / chat  

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Shell host | DOM TypeScript modules | Matches lobby/toast/draft pattern; forms & share APIs are web-native |
| Match host | Phaser + HudCompositor | Already deep; do not port arena to DOM |
| Front door | DOM only | Ends dual-menu confusion |
| Nav model | Places + layers FSM | Finite, testable, goal-friendly |
| Cross-layer API | CustomEvent bus | Existing pattern; loose coupling |
| Clips persistence | Session memory phase 1 | No auth; server list is later |
| Pause semantics | Local UI only | World is authoritative and multiplayer |
| Draft UI | Keep specialized overlay | Best-in-class surface; token-share only |
| Tutorials | Progressive disclosure | FTUE skill + pillar 4 |
| Brand | JAKESJAM loud / Elyad quiet | House vs product |
| Phasing | Spine first, beauty second | Architecture before chrome; always shippable |

---

## Open questions (resolved defaults — override only deliberately)

| Question | Default locked by this doc |
|----------|----------------------------|
| Atmosphere behind HOME: live Phaser vs CSS? | **Phaser MainMenu as atmosphere** if cheap; else pure CSS motion. No second control set. |
| clipSession server sync? | **No** until identity exists |
| SFX volume? | **Reserve UI**; wire if audio graph easy, else disabled with “soon” |
| Pause in draft? | **Draft wins** — pause unavailable while draft open |
| Confirm leave world? | **Yes** on Leave from PAUSE |

---

## PR Plan

### PR1 — Shell spine
- **Title:** `shell: Place FSM + event bus + extract splash routing`  
- **Files:** `client/src/shell/**`, `client/src/main.ts` (thin), tests  
- **Deps:** none  
- **Desc:** No visual redesign required; behavior parity  

### PR2 — HOME + SETTINGS
- **Title:** `shell: HOME hierarchy + SETTINGS sections + MainMenu atmosphere-only`  
- **Files:** `HomePlace`, `SettingsPlace`, `style.css`, `MainMenuScene.ts`, `clipConsent` wiring  
- **Deps:** PR1  

### PR3 — Clips product
- **Title:** `shell: clipSession + CLIPS place + toast migration + match emit`  
- **Files:** `ClipsPlace`, `clipSession`, `ShellToast`, `OnlineMatchScene`, `ClipShareToast` migration  
- **Deps:** PR1 (PR2 preferred)  

### PR4 — Pause + leave
- **Title:** `shell: PAUSE place + Esc/mobile + leave confirm`  
- **Files:** `PausePlace`, match scene input hooks, copy  
- **Deps:** PR1  

### PR5 — Death/results + teach hooks
- **Title:** `ui: death tips + share CTAs + first-draft hint`  
- **Files:** `DeathOverlay`, `MatchResultsOverlay`, `HudCompositor`, draft overlay, pure tip helper + tests  
- **Deps:** PR3 for share URLs; PR1 minimum  

### PR6 — Polish + a11y + cleanup
- **Title:** `shell: token unify, focus traps, dead code removal`  
- **Files:** CSS tokens, draft/death/results token pass, delete dead menu CTAs  
- **Deps:** PR2–PR5  

Each PR must keep `bun` client tests green and not break world join.

---

## Success metrics (qualitative + light quantitative)

| Signal | Target |
|--------|--------|
| Time-to-first-shot (returning) | ≤10s after Hot Lobby click (local/funnel) |
| “Where do I share clips?” | Answerable without developer |
| Visual consistency | Shell + draft feel same family |
| Code ownership | New menu work lands in `shell/` |
| Playtest quote | “Feels like a game, not a debug menu” |

---

## Goal one-liner (for `/goal`)

> **Ship a done-right DOM shell architecture: one front door, finite Places (HOME / SETTINGS / CLIPS / ROOM / PAUSE), typed event handoff to Phaser match, clips as a product surface, death/results that teach and share — without portals, modal tutorials, or player TikTok OAuth — so `play.elyad.io` feels like a finished house around the JAKESJAM engine.**

---

## Appendix A — Z-index ladder

| Layer | z-index band |
|-------|----------------|
| Phaser canvas | 0–1 |
| Match HUD (HudSystem) | 10–20 |
| Draft / death / results | 30–40 |
| Connection overlay | 50 |
| Shell HOME/ROOM | 60 |
| SETTINGS/CLIPS drawer | 70 |
| PAUSE | 80 |
| Toast | 90 |
| Orientation hint | 100 |

## Appendix B — File ownership map

| Concern | Owner module |
|---------|----------------|
| Place visibility | `ShellController` |
| World join side effects | `main.ts` glue only |
| Room Convex/WS | `LobbyController` |
| Clip files on disk | `server/src/clipStore.ts` |
| Clip encode | `ClipRecorder` |
| Highlight rules | `highlightRules.ts` |
| Draft offers | sim / Escalation goal |
| Share sheet | `ShellToast` / ClipsPlace |

## Appendix C — Mapping FTUE skill → this goal

| FTUE item | Phase |
|-----------|-------|
| Playground behind menu | Phase 1 (atmosphere) |
| No modal tutorial | Doctrine (all phases) |
| Controls legend first match | Phase 4 |
| First draft hint | Phase 4 |
| Death one tip | Phase 5 |
| Bot warmup matchmaking | **Out of scope** (matchmaker goal) |

---

*End of goal document. Convert the one-liner + Mission + Locked doctrine + PR Plan into `/goal` verbatim if desired; keep this file as the source of truth during execution.*
