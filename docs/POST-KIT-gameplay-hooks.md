# POST KIT — gameplay-hooks batch (7 clips, built 2026-07-06, shipped 2026-07-20)

Source: `~/jakesjam-tiktok/` (raw `src/*.webm` + `build.sh`). All 7 outputs already rendered,
vertical 1080x1920, silent gameplay + hook-text overlay + shared "FIGHT NIGHT" end-card +
trimmed BassRadian track (real recordings, no synthesized audio, no browser chrome — verified
by frame inspection 2026-07-20). These sat finished and unposted for two weeks; this batch winds
that up. The link, everywhere, always: **https://play.elyad.io**

**Cadence note — two prior docs disagree, flagging rather than silently picking:**
`docs/CLIPPING-PROFESSION.md` recommends "1/day". `~/Documents/JAKESJAM_TikTok_Research_20260715/`
(sourced, 63-citation research report) recommends **2-4 posts/week, not daily** — daily posting
diluted engagement in the precedents it checked. This kit schedules on the research report's
number. If you want daily instead, there's 7 ready to go out same-day.

## Pre-flight (do once, before the first post)

1. Game server — already confirmed live and current as of today's session (all balance/menu/
   aspect-ratio fixes included); no restart needed.
2. `https://play.elyad.io` — confirmed responding 200 today.
3. Upload NATIVELY to each platform. No watermarked cross-posts.
4. One link, never rotate the CTA. Reply to every comment in the first hour.

---

## Post 0 (NEW lead, supersedes Post 1 below) — fresh kill-reel

File: `~/Downloads/jakesjam-fresh-kill-reel.mp4` (45.3s, 1920x1080, real gameplay from a live
session on `play.elyad.io` today, 2026-07-20 — genuinely new, not the Jul 6 batch below).

Four real players' auto-rendered broadcast-grade killcams (`docs/clip-goal.md` pipeline),
concatenated in escalating order, ORIGINAL captured game audio kept (not stripped/replaced —
it's real, already good, no reason to cover it): BINGUS double kill → GWAD double kill →
GWAD triple kill → SHADY_BASS_MAN triple kill → branded end card. Each clip already carries
its own baked-in player-name + kill-count lower third from the game's own render, so no extra
per-clip captioning was needed — just a 1.8s hook-text intro on the open.

Source clip IDs (server/.clips/, real 2026-07-20 gameplay, for provenance):
`1a6934d6-57d6-432f-bade-699b2208c14f`, `6a0c3025-f390-4636-840f-bee555115722`,
`885b9c81-a3ef-4592-9806-5583b7e76ec6`, `386163c4-8091-4bb8-b037-36197a534e48`.

### TikTok
> random people found my game today and this happened 🕹️ link in bio
#indiegame #gamedev #browsergame #multiplayer

### YouTube (native 16:9, works as a regular upload or Short)
**Title:** Random players found my game today and it went off
**Description:**
> Real players, real matches, tonight, on the live build: https://play.elyad.io
> Fight Night every Friday.

### Instagram Reels
Same caption as TikTok. Bio link → play.elyad.io.

Native 1920x1080 (landscape) — kept as the auto-render pipeline output it, since re-cropping
to vertical risks cutting off side-screen action; landscape uploads natively on all three
platforms today.

---

## Post 1 — parry-multikill (Jul 6 batch, now second in the queue)

File: `~/Downloads/jakesjam-parry-multikill.mp4` (12.0s, 1080x1920)

### TikTok
> bro really pulled off a parry-kill combo 🕹️ link in bio, come try it
#indiegame #gamedev #browsergame #multiplayer

### YouTube Shorts
**Title:** He parried the rocket back and it was a kill
**Description:**
> Ten space wizard ninjas, one arena, zero downloads — plays in your browser in about
> eight seconds: https://play.elyad.io
> Fight Night every Friday.
Pinned comment (post immediately after upload):
> the arena: https://play.elyad.io — parry timing is real, come get me

### Instagram Reels
Same caption as TikTok + "also on YT/TikTok @<handle>". Bio link → play.elyad.io.

---

## Post 2 — tower-clutch (post ~3-4 days after Post 1)

File: `~/Downloads/jakesjam-tower-clutch.mp4` (11.8s)

**TikTok:** clutched it with 2 HP left, no notes 🕹️ link in bio
#indiegame #gamedev #browsergame #clutch
**YT Shorts title:** 2 HP. One shot. Round saved.

---

## Post 3 — round9-finale (week 2)

File: `~/Downloads/jakesjam-round9-finale.mp4` (11.8s)

**TikTok:** this is ROUND 9 and it is still not over — link in bio
#indiegame #gamedev #browsergame #multiplayer
**YT Shorts title:** Round 9 and neither of us will die

---

## Post 4 — spark-kill (week 2)

File: `~/Downloads/jakesjam-spark-kill.mp4` (13.8s)

**TikTok:** click a link, spawn in, start shooting — that's the whole onboarding
#indiegame #gamedev #browsergame #nodownload
**YT Shorts title:** My game's entire tutorial is "click the link"

---

## Post 5 — piston-aoe-blast (week 3)

File: `~/Downloads/jakesjam-piston-aoe-blast.mp4` (12.9s)

**TikTok:** one card pick and now my gun does THIS 🕹️ link in bio
#indiegame #gamedev #browsergame #roguelite
**YT Shorts title:** One card pick turned my gun into a war crime

---

## Post 6 — green-theme-aoe (week 3)

File: `~/Downloads/jakesjam-green-theme-aoe.mp4` (12.2s)

**TikTok:** every match looks completely different — that's the point
#indiegame #gamedev #browsergame #proceduralart
**YT Shorts title:** No two matches of my game look the same

---

## Post 7 — fanspread-explosion (week 4)

File: `~/Downloads/jakesjam-fanspread-explosion.mp4` (14.3s)

**TikTok:** stacked the wrong card and it is now a war crime — link in bio
#indiegame #gamedev #browsergame #chaos
**YT Shorts title:** I stacked the wrong card and this happened

---

## Post-run

Drop URLs back in the session for tracking after each post.

## Known gaps not covered by this batch (see `docs/SHOOT-LIST.md`)

The larger VO-narrated devlog/shorts campaign (Short 01-07, "IT'S HERE" / "the parry" / "1v1 me")
is separately tracked and still blocked on live TO-RECORD gaps (parry hero shot, players-online-1
dashboard, funnel timer take, 1v1 duel) — several of the clip UUIDs it references have likely
since been evicted from `server/.clips/` by the normal storage quota (only 5 pins + 8 kept clips
remain live, none matching those UUIDs). That campaign needs a fresh live-capture session to
re-shoot, which is currently blocked by a real bug (see below) — not part of this batch.

## Bug found while trying to shoot fresh footage for this task (not fixed, flagging for later)

`tools/promo-clip-session.mjs` (Playwright bot that auto-plays the live world and force-triggers
highlight clips) got stuck on two separate fresh runs today: `window.__simPhase()` froze on
`"round-over"` immediately after joining and never advanced, while the server's own `/health`
kept moving normally in the background. Root cause (traced, not fixed): `ClientLoop` has no
watchdog for a WebSocket that goes silent without firing a `close`/`error` event — the server
already guards the mirror-image case (`MatchHost.sweepStaleConnections()`,
`server/src/matchHost.ts:1136`) but nothing on the client side detects "transport says open,
nothing has arrived in N seconds" outside of a mobile-only `visibilitychange` hook
(`clientLoop.ts:699`). Worth a real fix — add a `lastMessageAtMs` staleness timer to `ClientLoop`
that force-closes and lets `ReconnectSupervisor` take over — but that's separate work from this
task and likely related to today's in-flight venue/lobby admission changes.
