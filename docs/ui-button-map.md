# JAKESJAM — Button Map

**Status:** Live registry, built 2026-07-15 against the post-fix codebase (after the 2026-07-14/15
UI axioms pass). Every button in the product, one row each. Cross-reference `docs/ui-axioms.md`
§7 for the hierarchy rules (Primary / Secondary / Ghost / Danger) this table classifies against.

**How to keep this current:** any PR that adds, removes, or reclassifies a button updates this
file in the same PR. A button map that's stale is worse than no map — it's the reason `ui-axioms.md`
warns "if this file and the code disagree, the code is wrong unless this file is out of date —
update explicitly."

---

## HOME (splash) — `client/src/main.ts`

| Button | Data attr | Tier | Line | Notes |
|---|---|---|---|---|
| Lobby (was "Hot Lobby", renamed 2026-07-16) | `data-menu-world` | **Primary** | 293 | `primary shell-cta-primary` — the one sanctioned dual-accent button (cyan fill + gold seam). The only Primary on this screen. Lands in the venue lobby since the S2.F flow flip. |
| Practice | `data-menu-practice` | Secondary | 296 | `shell-btn-secondary` |
| Private room | `data-menu-host` | Secondary | 297 | " |
| Join room | `data-menu-join` | Secondary | 298 | " |
| Clips | `data-menu-clips` | Secondary | 299 | " |
| Settings | `data-menu-options` | Secondary | 300 | " |
| Intro | `data-menu-intro` | Secondary | 301 | " |
| Showcase | `data-menu-tutorial` | Secondary | 302 | " |
| Forge | `data-menu-forge` | Secondary | 303 | " |
| Credits | `data-menu-credits` | Secondary | 304 | " |
| "▶ ENTER THE ARENA…" blink banner | `data-splash-cta` | Secondary (decorative dup) | 307 | Re-fires the Lobby click handler — not a second destination. Flagged in the audit as ornamentation duplication (two visually distinct triggers for one action); left as-is, not a hard violation. |

**Fix landed:** `.shell-btn-secondary`'s resting state was cyan-only (systemic C1/C2 violation);
now rests gold-tinted border + warm text, cyan reserved for hover/focus. All 9 rows above inherit
this automatically from the one CSS rule.

---

## ROOM (private lobby) — `client/src/main.ts` + `LobbyController.ts`

| Button | Data attr | Tier | Line | Notes |
|---|---|---|---|---|
| Host private room | `data-create-room` | **Primary** | 501 | Now `primary shell-cta-primary` (was plain cyan `primary` only — fixed to match the Lobby button's dual-accent). |
| Start match | `data-start-match` | **Primary** | 525 | Same fix applied. |
| ← Home | `data-back-to-splash` | Ghost/Secondary | 502 | `shell-btn-secondary` |
| Join | `data-join-room` | Secondary | 511 | " |
| Copy link | `data-room-share` | Secondary | 520 | " |
| Ready | `data-ready-toggle` | Secondary (state-dependent) | 524 | `[data-ready="true"]` keeps a filled cyan/teal "confirmed" look (legitimate live-state cue, not a violation); `[data-ready="false"]`'s redundant cyan-only override was removed — now inherits the same gold-rest/cyan-hover as every other secondary button. |
| Leave | `data-leave-room` | **Danger** | 526 | `btn-danger` — correctly rose/copper, not screaming red fill. |
| Load (custom map code) | `data-custom-map-load` | Secondary | 544 | `shell-btn-secondary` |
| Map picker cards | (per-map, `MapPicker.ts:110`) | Selection tile, not a hierarchy-tier button | — | Heading recolored cyan→gold (house chrome); selected-card cyan highlight kept intentionally as a live/active cue. |

---

## SETTINGS — `client/src/main.ts`

| Button | Data attr | Tier | Line |
|---|---|---|---|
| Back | `data-options-back` | Ghost/Secondary | 360 |

---

## CLIPS — `client/src/main.ts`

| Button | Data attr | Tier | Line | Notes |
|---|---|---|---|---|
| Open clips | `data-open-clips` | Secondary | 334 | |
| Save clip now | `data-clips-save-now` | **Primary** | 370 | Now `primary shell-cta-primary` (was plain cyan `primary` — a house feature's primary CTA had zero gold; fixed). |
| Back | `data-clips-back` | Ghost/Secondary | 372 | |

---

## PAUSE — `client/src/main.ts`

| Button | Data attr | Tier | Line | Notes |
|---|---|---|---|---|
| Resume | `data-pause-resume` | **Primary** | 445 | `primary shell-cta-primary shell-pause-resume` — already correct pre-fix, the one other place besides the Lobby button using the dual-accent pattern natively. |
| Enable auto-clips | `data-pause-toggle-clips` | Secondary | 452 | |
| Save now | `data-pause-save-clip` | Secondary | 453 | |
| Clip library | `data-pause-clips` | Ghost | 455 | `shell-btn-secondary shell-btn-ghost` |
| Settings | `data-pause-settings` | Ghost | 459 | " |
| Leave | `data-pause-leave` | **Danger** | 460 | `btn-danger shell-btn-ghost` |

---

## MATCH chrome (always-visible in-match pills) — `client/src/main.ts`

| Button | Data attr | Tier | Line | Notes |
|---|---|---|---|---|
| Menu | `data-match-menu` | Secondary (nav) | 466 | `match-chrome-btn`. Gold border kept (shell-nav affordance, not combat info — correctly justified exception to "combat HUD stays cyan"). Shape fixed: 999px pill → 10px chamfer. |
| Clips | `data-match-clips` | Secondary (nav) | 467 | `match-chrome-btn match-chrome-clips`. Cyan border kept — Clips is the doctrine's explicit "house feature that must stay reachable in-match" carve-out. Same shape fix. |

---

## CREDITS — `client/src/main.ts`

| Button | Data attr | Tier | Line |
|---|---|---|---|
| Back | `data-credits-back` | Ghost/Secondary | 437 |

---

## MatchStatusBadge — `client/src/game/ui/MatchStatusBadge.ts`

ROOM-ONLY since 2026-07-16: the splash world-status instance was removed (Jake: "remove this add player stats") — the splash slot now renders the button-less player-record strip (`shell/playerStats.ts`, `[data-player-stats]`). The badge class survives for LobbyController's room status card.

| Button | Tier | Line | Notes |
|---|---|---|---|
| Join | **Primary** | 84-89 | `BTN_PRIMARY_STYLE`. Now has an authored disabled-state style (dim opacity + desaturated border/text) — previously relied on default browser `:disabled` styling only (S2 violation: a disabled resource must visually say so). |
| Copy link | Secondary | ~103 | Hollow border, transparent fill — already compliant. |

---

## In-match overlays (Phaser scenes, DOM-rendered popups)

### DeathOverlay — `client/src/game/ui/DeathOverlay.ts`
| Button | Tier | Line | Notes |
|---|---|---|---|
| Share highlight | **Gold CTA** (sanctioned C2 exception) | 94-99 | Only shown when a clip URL exists. Gold `#c9a84c` — correct, share/highlight is a named house-feature exception to "no gold in combat HUD." |

### RoundBanner — `client/src/game/ui/RoundBanner.ts`
No buttons (pure text banner).

### MatchResultsOverlay — `client/src/game/ui/MatchResultsOverlay.ts`
| Button | Tier | Line | Notes |
|---|---|---|---|
| Rematch | **Primary** | via `makeButton()` helper, ~301 | `PRIMARY_BUTTON_STYLE` |
| Back to Lobby | Secondary | via `makeButton()` | `SECONDARY_BUTTON_STYLE` |
| Share highlight | **Gold CTA** | via `makeButton()` | Was neutral grey (missing the sanctioned gold exception) — now matches DeathOverlay's `#c9a84c` treatment. |

### ConnectionOverlay — `client/src/game/ui/ConnectionOverlay.ts`
No buttons (status-only overlay).

### ClipShareToast — `client/src/game/ui/ClipShareToast.ts`
| Button | Tier | Line | Notes |
|---|---|---|---|
| ✕ close | Ghost | 35 | Plain text, no chrome — fine as-is. |
| Watch | Secondary | 49 | |
| Copy link | Secondary | 58 | |
| Share | Secondary | 66 | Only shown if native share / clipboard available. |
| Original (landscape) | Secondary | 77 | Only shown when a paired original-aspect clip exists. |

---

## Explicitly out of scope for this map's compliance claims

The **draft-card system** (`CardDraftOverlay.ts` and its card-selection buttons/chips,
`cardIcons.ts`, `signatureIcons.ts`, `cardSeals.ts`, `elementColors.ts`, `CardBracketFrame.ts`) —
Jake asked for this surface to stay untouched in the 2026-07-14/15 pass. Its buttons exist (card
selection is itself a button-like affordance) but are not classified or fixed here. Audit findings
for that surface are recorded separately in the earlier audit-agent report (not reproduced in this
file) for whenever that pass is greenlit.

**ArenaForgeUI.ts** (map-editor tool) has its own buttons (Save & Share, Test Play, Delete, tool
palette selections) — not enumerated row-by-row here since it's a creator tool rather than the
core player-facing button set, but its panel chrome/color violations were fixed in the same pass
(see git history for `client/src/game/ui/ArenaForgeUI.ts`, 2026-07-15).

---

## Cross-cutting fixes applied in this pass (not button-specific, but affect every row above)

- `.shell-btn-secondary` resting state: cyan-only → gold-tinted border + warm text, cyan reserved
  for hover/focus (the single biggest systemic fix — see `docs/ui-axioms.md` C1/C2).
- Three house-feature primary CTAs (Save clip now, Host private room, Start match) upgraded from
  plain cyan `primary` to the full `shell-cta-primary` dual-accent treatment.
- `.match-chrome-btn` shape fixed from a 999px pill to a 10px chamfer (axiom G1).
- Local-player promotion added to the ROOM roster list (`LobbyController.ts`'s `renderPlayers` —
  `player-row--local` class + "(YOU)" tag), addressing axiom H6 for that surface.

---

*Companion docs: `docs/ui-axioms.md` (the enforceable checklist this map is classified against),
`~/Documents/JAKESJAM_UX_Research_20260715/ux_academic_grounding_report.md` (HCI research backing
the button-hierarchy rules in axioms §7).*
