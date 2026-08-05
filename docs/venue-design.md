# The Venue — public-mode overhaul design

**Status:** PROPOSAL — awaiting Jake's sign-off on the contested calls in §8.
**Date:** 2026-07-16.
**Evidence base:** `~/Documents/JAKESJAM_HotLobby_Research_20260716/` —
`game_mode_research.md` (8 game studies, 10 cross-cutting patterns, naming
study, all sourced) and `current_flow_map.md` (moment-by-moment audit of the
live flow, 23 numbered seams, file:line-cited). This doc is the synthesis;
read those for the receipts.

---

## 1. The diagnosis in one sentence

Hot Lobby has **match-centric meaning (first-to-3) with .io-style free entry**
— every successful game picks one or gates the other, and every major seam in
the audit (mid-draft joiners in a frozen world, MATCH WINNER modals for
matches you never played, mid-fight fodder spawns, hard-cut recycles) is this
one mismatch surfacing somewhere else. The overhaul picks: **player-centric
meaning inside an always-on arena, with entry gated only at round
boundaries** — and wraps it in a real place.

## 2. The mental model

> **JAKESJAM's public mode is a VENUE — a named place where the fight never
> stops. You walk into the lobby, see the arena roaring through the window,
> touch the totem, and you're in at the next bell. Your RUN — your streak,
> your build, your story — is yours; the venue was here before you and keeps
> going after you. On Fridays, the venue hosts a SHOW.**

Three layers, each doing one job:

| Layer | Model | Job |
|---|---|---|
| **The Venue** (lobby-as-place) | SF6 Battle Hub / TF2 community server | Arrival, presence, waiting-as-play, ceremonies, return loop |
| **The Arena** (always-on combat) | .io eternal world + MK8 boundary entry | The fight itself; personal runs; degrades gracefully to 1 human + bots |
| **Fight Night** (Friday overlay) | Fall Guys episode / fight-card show | Scheduled density; locked card; audience; the community appointment |

Why this composition (research, condensed):
- Always-on arena is the **only structure that survives low population**
  (rooms self-heal via interleaved arrivals; formed-matches queues visibly
  fail below critical mass — the death spiral for a young game).
- Lobby-as-place is the **decided direction**, and the existing HangoutScene
  totem pattern is already the industry-best launch mechanic (SF6's cabinets:
  the spatial act IS the queue, readiness is publicly visible).
- Run framing fixes the root mismatch **without gating harder than round
  boundaries** (≤90s worst case, usually far less).
- The show model is reserved for Friday, the one night scheduled density can
  pay its liveness cost — and weekday lobby spectating trains the audience
  behavior the show needs.

## 3. Design language (the vocabulary)

Every surface, every copy string, every system speaks this vocabulary.
If a screen can't say which word it's serving, it's off-model.

- **The Venue** — the whole public space (lobby + arena). Has a name (see §7),
  a marquee, a weekly board. "The server" never appears in copy.
- **The Lobby** (antechamber) — the walkable staging place you land in and
  return to. Built on HangoutScene. The word "lobby" now names ONLY this.
- **The Arena** — the always-on combat world (today's WorldHost match).
  Rounds forever; maps cycle; it never waits for anyone and never dies.
- **The Run** — one player's arc from entering the arena to leaving it:
  rounds survived, kills, streak, cards drafted. The unit of personal meaning.
  Ends with a score card, never with silence.
- **The Cycle** — one map's worth of rounds (replaces "match"). Ends in a
  ceremony IN THE LOBBY (podium + map vote), not a modal over a frozen world.
  First-to-3 becomes the cycle's win line, not the mode's reason to exist.
- **The Draft** — the between-rounds ritual (kept at 15s), made SHARED and
  VISIBLE: everyone drafts simultaneously, picks are public, losers pick
  first. The strategic heartbeat, not an intermission (TFT carousel lesson).
- **The Bell** — the round boundary. The only moment fighters enter the
  arena. Copy: "in at the next bell — 0:23".
- **Fight Night** — Friday's scheduled show at the Venue. Locked fight card,
  intros, audience in the lobby watching the feed, podium ceremony. Name
  unchanged — "Fight Night at the [Venue]" composes.

## 4. The user flow, end to end

### 4.1 Arrival (cold visitor, play.elyad.io)
1. Email gate (unchanged — it's the business funnel) → **lands IN the lobby
   as an avatar in ≤5s**. No splash menu as the primary path; the menu
   becomes an overlay you can open, not a place you start.
2. First frame: other avatars (or named bots warming up), the **arena feed**
   — a big diegetic screen/scrying-crystal showing the live round, scores,
   and "next bell 0:37" — and **practice dummies** one step away.
   The 8-second promise is honored as *input within 3 seconds in a live
   place*: moving IS playing, hitting a dummy IS playing (Poki/CrazyGames
   conversion guidance; Splatoon test-range precedent).
3. Callsign: a first-timer gets a name prompt IN the lobby (diegetic — sign
   the roster board) before first totem touch. **No one ever fights as
   `player_h3k9d0f1_a4x2` again** (seam #6).
4. The ident/anthem plays ONCE as lore content discoverable from the menu,
   never as a gate (seam #1).

### 4.2 Funnel fast-path (`?fight` / Fight Night links)
`?world=1` → `?fight`: lands in the lobby ALREADY walking toward the totem,
auto-readied; enters at the next bell. Median time-to-combat 8–20s, and the
first 8s were already play. The link promise and the experience finally agree.

### 4.3 The launch (lobby → arena)
- **Totem = ready signal** (existing pattern, kept). Touching it does NOT
  freeze you — keep hitting dummies, keep emoting; the arena pulls you at the
  bell (Splatoon queue-while-playing).
- Totem displays the live countdown ("next bell 0:23") and glows per queued
  player — readiness is social theater (SF6 cabinet visibility).
- **Round-boundary admission, hard rule:** nobody spawns mid-fight, ever
  (kills seams #4, #5, and the fodder-spawn problem in one move — MK8's
  single rule).
- **Dignity guarantee:** entrants get a **starter draft** (one pick from
  three) while waiting at the totem, so they never face drafted veterans
  naked (Rocket League's no-blowout-backfill principle, translated).

### 4.4 Inside the arena (the Run)
- HUD gains a compact **run strip**: rounds survived · kills · streak ·
  cards. The player's own arc is always visible (P1: the arriving player's
  unit of meaning).
- **Death:** the death rite (soul-to-seal camera ride) is already the best
  moment in the game — keep it unobscured. Then a **run-aware death card**:
  streak, kills, best round — honest copy ("NEXT BELL 0:41", never a fake
  "respawning" number — seam #8), and **clear spectate**: dim strip at the
  screen edges only, the fight fully visible, camera following the action
  (seam #9). Dead time is audience time — it trains Fight Night behavior.
- **The Draft (shared, visible):** all fighters draft simultaneously on a
  shared stage — you SEE rivals' picks land (TFT carousel: visible drafts
  generate stories). **Reverse-standings pick order** = built-in comeback
  mechanic. Late-pickers see "waiting on VERA · 0:06"; AFK auto-pick is
  announced ("VERA auto-drafted Quick Parry"), fixing seams #10–12.
- Non-fighting phases NEVER read as a hang: every freeze has a diegetic
  banner (bell countdown, draft stage, round ceremony) — seam #20.

### 4.5 Cycle end (the ceremony)
Someone hits the cycle win line → **everyone returns to the lobby
together** (TF2 return-to-server; never RL's return-to-menu):
1. Podium moment at the totem — winner celebrated, MVP, run cards for all
   (with real names — seam #13).
2. **Map vote** — 10 seconds, nominate-and-vote, next map wins (the cheapest
   community ritual that exists: converts "the server decided" into "we
   decided" — P5, RTV lineage). Kills the hard-cut recycle (seam #15).
3. Totem re-arms; the next cycle's first bell shows on the feed. "One more"
   is two steps away, not a menu rebuild.

### 4.6 Leaving and returning
- Walking out (or Menu → Leave) **closes the socket** (seam #17 — today's
  30s ghosts), with an in-fiction confirm, not a browser `confirm()` (#18).
- Return tomorrow: the lobby remembers you — callsign, last run's best
  streak on the board, the week's leaderboard climaxing Friday ("this week
  at the Venue"). Cheap continuity beats no continuity (seam #19; the .io
  genre's own admitted weakness).

### 4.7 Population honesty & elastic bots
- The funnel badge says **"2 fighters · 1 bot warming up"** — never counts
  bots as players (seam #2). Trust is a conversion feature.
- **Elastic persona bots** (replaces the static 2): maintain ~4 combatants
  minimum; bots enter/exit ONLY at bells; they keep their names/personas
  (they're already good citizens — the audit confirms map-aware AI, honest
  violet plates) so Friday can reuse them as "the undercard."
- Bots idle in the LOBBY when not fighting — the venue never looks abandoned,
  and it's honest: you can see exactly who's a bot before you fight them.

## 5. What this fixes (audit seams → design)

Structurally dissolved by the model: #3, #4, #5 (boundary admission), #6
(lobby callsign), #9 (spectate-first death), #10–12 (shared draft), #13–15
(lobby ceremony), #19 (venue memory), #20 (diegetic phase states), #21–22
(lobby arrival replaces hard-cut connect).

Plain bugs to fix NOW regardless of the overhaul (Phase 0): #2 bot-counting
badge, #8 mislabeled death countdown, #10 never-armed draft timer bar, #13
results-name regression, #16 dead reconnect UI (wire `reconnectUrl` or remove
the lie), #17 leave-never-closes-socket, #18 native confirm().

## 6. Build plan

- **Phase 0 — honesty bugfixes** (small, immediate, no design risk): the
  seven bugs above. Ship this week.
- **Phase 1 — the public lobby host**: singleton always-on hangout tied to
  WorldHost (`hangout_world`), world-token auth (not room membership), the
  portal-totem ATTACHES to the arena instead of minting a match, and
  arena→lobby re-entry as a first-class path (HangoutScene gaps #1–3 in the
  audit §9).
- **Phase 2 — a lobby worth standing in**: arena feed, practice dummies,
  bell-countdown totem, roster board (callsign prompt), presence polish.
- **Phase 3 — arena interior**: round-boundary admission + starter draft,
  run strip + death card + clean spectate, shared visible draft with
  reverse-standings order, cycle ceremony + map vote in the lobby.
- **Phase 4 — naming + funnel**: the rename (§7), `?fight` deep link,
  honest badge, lobby-first landing as default.
- **Phase 5 — Fight Night overlay** (separate design pass): locked card,
  intros, audience mode, podium show.

## 7. Naming

"Hot Lobby" must die — "lobby" now names the antechamber, and keeping it on
the combat mode would sabotage the exact mental model this overhaul builds.
"GAME" (considered) has Poki-grade clarity but is unspeakable ("meet you in
GAME"?) and wastes the naming slot the fiction can own.

The researched convention: when the button is the single primary CTA, use a
pure verb or a fiction name **fused with a verb**. The failure mode is a bare
fiction noun with no action cue.

**Recommended shape:** place-noun for the arena, verb on the button, and the
walkable antechamber just called "the Lobby."

| Candidate | Button copy | Notes |
|---|---|---|
| **THE ARENA** | ENTER THE ARENA | Safest; instantly legible; ownable since we have one public mode. The blinking CTA already says this — the brand has been rehearsing it. |
| **THE SHARD** | ENTER THE SHARD | Most brandable; crystal-native; speakable ("meet you in the Shard"); lobby = the Shardgate. |
| THE PROVING | PROVE YOURSELF | Gnostic trial energy; matches run framing. |
| THE KILN | ENTER THE KILN | Where crystal is fired; distinctive, unclaimed; needs the verb to carry it. |
| THE CRUCIBLE | — | Perfect meaning, but Destiny owns it. |
| THE PLEROMA | — | Actually Gnostic; too obscure for a CTA; save for lore/map names. |

Keep **Fight Night** exactly as is. Reserve deep-gnostic vocabulary (Pleroma,
Archon, Kenoma) for lore, bot personas, and map names.

## 8. Contested calls needing Jake's sign-off

1. **Demote first-to-3 from "the match" to "the cycle win line."** This is a
   real gameplay-meaning change: the mode's unit of meaning becomes the
   player's run, and first-to-3 becomes the rhythm that ends a map. Biggest
   single decision in the doc.
2. **Round-boundary admission** adds up to ~90s (usually much less) before a
   new arrival's first fight. The lobby exists to make that wait *play*, but
   it is a real delay where today there is none.
3. **Starter draft for entrants** — small power injection for joiners;
   changes balance at the margin.
4. **Elastic bots to a floor of ~4 combatants** (from static 2) — more alive,
   more server sim cost, more bot-visible at low pop.
5. **The name** (§7). ARENA is the safe pick; SHARD is the brand pick.
6. **Lobby-first landing as the default path** — the splash menu becomes an
   overlay, not the front door. Biggest UX inversion; the funnel research
   supports it, but it changes the first thing every player ever sees.
