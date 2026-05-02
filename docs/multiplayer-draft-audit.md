# Multiplayer Draft Round-Trip Audit

**Branch:** `feat/multiplayer-draft-verify`
**Scope:** Static + automated audit of the online draft pick path. Manual
two-window verification is the user's job; this doc concludes with the
checklist for that.

**Verdict:** Ready for user manual verification. No bugs found.

## Automated results

- `bun run --filter client typecheck` — pass (after `bun install` in worktree)
- `bun run --filter server typecheck` — pass
- `bun test` — 103 pass / 0 fail / 3558 expects across 11 files

## Code path trace

1. Server enters draft once per round in `client/src/sim/round.ts:158`
   (`roundOver → drafting`) by calling `enterDrafting`. Offers are rolled
   from the deterministic sim RNG and stored on
   `state.round.draftingOffers[playerId]`.
2. The next snapshot carries both `state.round.phase = "drafting"` and the
   `card-offered` SimEvent in the same atomic msgpack frame
   (`server/src/matchHost.ts:719-734`). State and events cannot interleave —
   `broadcastSnapshot` builds one `Snapshot` payload `{ state, events }` and
   `ws.send(payload)` ships it as a single message.
3. Client `OnlineMatchScene.ts:516-520` reacts to the `card-offered` event
   (filtered to `event.playerId === this.localPlayerId`) and opens
   `CardDraftOverlay` via `showCardDraft`.
4. On click, `OnlineMatchScene.ts:545` calls
   `loop.sendCardPick(roundIndex, card.id)`.
5. `client/src/net/clientLoop.ts:309-313` encodes
   `{ t: "card-pick", roundIndex, cardId }` and sends it over the transport.
6. `server/src/matchHost.ts:287-346` receives and validates:
   - `round.phase === "drafting"`
   - `round.roundIndex === message.roundIndex` (rejects stale picks across
     a round flip)
   - `cardId` is in `round.draftingOffers[playerId]` (rejects forged picks)
   - `round.draftingPicked[playerId]` undefined (rejects double-clicks)
   On success, mirrors into `player.cards` AND
   `state.round.draftingPicked[playerId]`.
7. `stepRound` at `client/src/sim/round.ts:178-232` (next tick) emits
   `draft-resolved` once per player (guarded by the `__draftResolvedFired`
   marker — race-safe across multi-tick pick landings) and transitions
   `drafting → countdown` when `allPicked`.

## Audit checklist findings

### 1. Race (A picks at T+100ms, B at T+5s)
**Pass.** `firedKey="__draftResolvedFired"` (round.ts:190-207) keeps a
per-player marker on the round state itself; `draft-resolved` is emitted
exactly once per player. The `drafting → countdown` transition at line 225
fires only on the tick where `allPicked` is true, after which
`draftingPicked` and `draftingOffers` are cleared.

### 2. Auto-pick on tab close
**N/A — by design.** Plan reference assumed `tick >= draftingExpiresAtTick`
auto-pick exists, but `round.ts:177-181` explicitly removed it: "No
expiry / no auto-pick — players don't respawn until they commit a card."
The drafting-holds-past-legacy-window test in
`round.test.ts:312` enforces this. If a player closes their tab,
`disconnectedAt` (matchHost.ts:114) starts a `RECONNECT_GRACE_MS = 10_000`
eviction timer; after eviction, the player is removed from `state.players`
so `draftingIds` shrinks and `allPicked` can resolve on the survivors.
This is the safety net, not auto-pick.

### 3. Snapshot ordering
**Pass.** `broadcastSnapshot` (matchHost.ts:719-734) packs `state` and
`events` into one `Snapshot` message. The wire is a single
`ws.send(payload)`. The `card-offered` event therefore lands in the same
frame as the `phase = "drafting"` transition — never reversed, never
flickered.

### 4. Reconnect resilience
**Pass.** `enterDrafting` is called from exactly one site (`round.ts:158`)
on the `roundOver → drafting` branch. On reconnect (matchHost.ts:161-166),
the only mutation is `disconnectedAt.delete(playerId)` — no draft
re-roll. The reconnecting client's next snapshot carries the unchanged
`state.round.draftingOffers[playerId]` and the overlay's
`lastCardOfferKey` short-circuit (OnlineMatchScene.ts:531) avoids
re-opening if it's already up.

### 5. Type alignment
**Pass.** `CardPick` is byte-identical:
- `client/src/net/protocol.ts:39-43`:
  `{ t: "card-pick"; roundIndex: number; cardId: string }`
- `server/src/protocol.ts:51-55`: same shape.
Both are listed in their respective `ClientMessage` unions.

### 6. Offline (MatchScene) fallback
**Pass.** Offline `MatchScene` runs `World.step` locally via `roomClient`,
so it sees the same `draftingOffers` on its own state. The offline draft
flow does not depend on the network protocol layer.

## Manual verification checklist (for the user)

**Two-window procedure to exercise the online draft round-trip:**

1. Start the local stack from this worktree:
   ```bash
   cd .worktrees/feat-multiplayer-draft-verify
   bun run dev:online
   ```
   (per `package.json` — runs Convex + Bun WS server + Vite client.)
2. Open **two** browser windows at the dev URL with `?netcode=new`
   appended (e.g. `http://localhost:5173/?netcode=new`). The query
   parameter is required: `client/src/main.ts:187` reads it and
   `GameConfig.ts:15` registers `OnlineMatchScene`. Without
   `?netcode=new` you land in the legacy offline `MatchScene`.
3. Sign in as **two different** accounts (one per window). Use
   incognito for the second window so Convex auth is isolated.
4. Both clients queue + start the match. You should both land in
   `OnlineMatchScene` (HUD shows the online round banner).
5. Play one round to completion. One player dies; the round ends.
6. **Verify**: both windows pop the `CardDraftOverlay` simultaneously
   showing 3 cards. Each window's offers should be different (rolled
   per-player by the deterministic sim RNG) but stable — the same
   offers if the page is reloaded mid-draft.
7. **Race test**: have window A pick within ~1s; leave window B open
   for 5–10s before picking. The next round must NOT start until B
   picks. After B picks, the countdown banner appears in both windows
   on the same tick (within snapshot interpolation jitter).
8. **Reconnect test**: while overlay is open in both windows, kill the
   network on window B for ~2s (DevTools → Network → Offline), then
   bring it back. Window B's overlay should still show the SAME three
   offers (server-authoritative, no re-roll). Pick and confirm the
   round advances.
9. **Tab close test**: open the overlay in both windows; close window
   B entirely. Window A's overlay stays open. After
   ~10s (`RECONNECT_GRACE_MS`), B is evicted; A's pick alone resolves
   the draft and the round advances.
10. **Determinism check**: rematch with the same lobby — first round's
    draft offers should differ from match-1 (new rngSeed in
    `ServerHello`).

If any step fails, capture the failing window's devtools console +
network tab and reopen this audit.
