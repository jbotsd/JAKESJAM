# JAKESJAM — Outreach Templates (press + creators)

Drafted 2026-08-04 against the 66-contact CRM list (21 press / 38 creators +
warehouse `crm_contacts`). Copy base = `docs/marketing-copy.md` (keep the
one-sentence pitch in sync with GDD §0). Sender: jake@intrepiddev.com.au.

**Ground rules (same discipline as the recruiter batch, it works):**
1. Every email gets ONE personalization line up top referencing something
   they actually made (a video, an article, a stream). No line → don't send.
2. One follow-up only, day 3–5, and it must carry something NEW (a fresh
   clip, a player-count milestone, a Fight Night date) — never "checking in."
3. Log every send + reply in the warehouse (`crm_contacts.notes`) same day.
4. Never overclaim: no player-count implications, no "trailer" (none exists
   yet), no publisher-speak. Solo dev, live game, honest.
5. T1 itch-thread creators asked to be contacted IN THEIR THREAD — reply
   there, don't cold-email them.

**The asset every email links:** https://play.elyad.io (zero install — this
is the whole superpower, lead with it) + one pinned clip share page
(`play.elyad.io/c/<uuid>` — pick 2–3 bangers in /ops and reuse them
everywhere; the share pages have proper social unfurls).

---

## A. Creators, T2–T3 (streamers / indie YouTubers)

**Subject:** Browser Stick Fight-style chaos — your viewers can join you in one click

> Hi <name> — <one line: specific recent video/stream of theirs and why it
> made me think of this>.
>
> I'm Jake, solo dev of **JAKESJAM** — a browser 2D multiplayer arena
> shooter in the Stick Fight / Gang Beasts lane: dash-bash physics
> collisions, wall-jump momentum, and a card draft every round so every
> match escalates into a different broken build. The clips write
> themselves because the knockback is real physics, not scripted combos.
>
> The bit that's built for your format: **it runs in the browser, zero
> install** — you drop a link in chat and your viewers are in the lobby
> with you in under 30 seconds. Happy to spin up a private lobby for a
> community night and be on hand while you stream it.
>
> Play in one click: https://play.elyad.io
> 30-second clip: <clip share link>
>
> Cosmetics-only, no pay-to-win, ever. No key needed — it's free and live.
>
> Cheers,
> Jake — Perth, Australia · jake@intrepiddev.com.au

**Follow-up (day 3–5):** new clip + concrete offer: "ran a Fight Night
<date> — <n> players in one lobby / <specific chaotic thing that happened>.
Standing offer on the private lobby."

## B. Press — consumer outlets (PC Gamer, RPS, Eurogamer, Destructoid,
## PCGamesN, TheGamer, Automaton)

**Subject:** Solo-dev browser arena shooter — Stick Fight chaos, no download, live now

> Hi <name> — <one line referencing a specific piece of theirs, ideally
> indie/browser/party-game coverage>.
>
> I'm Jake Colson, a solo dev in Perth. **JAKESJAM** is a browser-first 2D
> multiplayer arena shooter built for the physics-chaos subgenre
> (Stick Fight, Gang Beasts territory): dash-bash collisions and wall-jump
> momentum produce unscripted knockback moments, and a round-end card
> draft means every match escalates differently. Four classes with real
> identity (one is raycast-only, one is melee-first, one heals by
> auto-homing tendrils).
>
> The angle: it's **playable in one click, in the browser, free** — your
> readers can be in a match 30 seconds after the article. Cosmetics-only,
> no pay-to-win ever — the stance the highest-reviewed games in this genre
> (85–97% positive) share.
>
> Play: https://play.elyad.io · Clip: <clip share link>
> Happy to provide anything else — clips, GIFs, a build walkthrough, or a
> private lobby with me in it.
>
> Jake Colson · jake@intrepiddev.com.au

## C. Press — industry/dev outlets (Game Developer, GamesIndustry.biz,
## IndieGameBusiness)

Same skeleton as B, swap the angle paragraph for the tech/business story:

> The angle for <outlet>: a solo dev shipping a browser multiplayer arena
> shooter with a deterministic simulation core — TypeScript-authoritative
> combat with movement physics in Zig/wasm at bit-level parity, replays
> and clip capture server-side, self-hosted on a single Bun process. Happy
> to go deep on any of it — the whole determinism-parity war has receipts.

## D. T1 itch.io thread replies (voidom, PatrickR2020, oDB_GAMING,
## MafazGamer — they ASKED for games)

Reply in their thread, short and specific:

> Made for exactly this thread: **JAKESJAM** — free browser 2D multiplayer
> arena shooter (Stick Fight-ish physics chaos + card drafting). Zero
> install, runs in the tab: https://play.elyad.io — if you stream it, drop
> your channel and I'll hop in the lobby so you're not fighting bots.
> Feedback brutal or otherwise very welcome.

## E. Alpha Beta Gamer (top T2 pick — direct submission pipeline)

Use their site submission route (see contact research table). Their beat is
free/browser games — JAKESJAM is a perfect-fit submission, not a pitch.
Lead with: free, browser, multiplayer, live now, no key needed.

---

## Send-week checklist

- [ ] Pin 2–3 best clips in /ops → grab `/c/<uuid>` links (the one asset
      every template needs; without it nothing sends)
- [ ] Verify play.elyad.io cold-load on a phone + a clean browser profile
      (first impression = the funnel; sizing-on-fleek rule applies)
- [ ] Email gate: confirm signups are landing (server/.signups/signups.json
      on the live host) BEFORE driving traffic at it
- [ ] Batch order: D (itch threads, warmest, free reps) → E (ABG
      submission) → A tier-2 → B/C press → A tier-3 (DougDoug/Jesse Cox
      last, with the best clip we have)
- [ ] PAX Aus 2026 submission via SAE closes **Sun 16 Aug** — separate
      track, do not let outreach eat it
- [ ] Log everything in warehouse `crm_contacts` + mirror to Apollo (CRM
      shell only — enrichment/sequences are Free-plan-blocked, sends go
      through Gmail manually)
