# SHORTS — direct scripts (15–25s each)

Rule: no story, no journey, no cave. IT'S HERE → what it is in one breath →
COME PLAY → Fight Night. One CTA, always the same: **link in bio, plays in
your browser, eight seconds.** Rotate hooks, never the CTA. Best-take
gameplay under every second of voice; the announcer chain (epic FX from the
devlog VO) on the opening line of each.

Every short ends on the same two beats:
> **Plays in your browser. Link in bio — you're in the arena in eight seconds.**
> **And Friday night? IT'S FIGHT NIGHT.** *(announcer)*

---

## 01 — IT'S HERE
[best 2s of chaos, announcer]
**JAKESJAM is live.**
Ten space wizard ninjas. One arena. Zero downloads.
[kill on screen]
That's it. That's the pitch.
→ CTA

## 02 — the build
[late-game screen full of projectiles]
**This gun started polite.**
Every card you grab mutates it — homing, bouncing, splitting.
Ten picks later it's a war crime.
Come build yours.
→ CTA

## 03 — the parry
[clip: rocket deflected back into sender]
**You can parry rockets back into people's faces.**
That's the whole video.
That's the feature.
→ CTA

## 04 — eight seconds
[stopwatch overlay, screen-record the real flow: link → email → in-game]
**From this link to shooting geometry: eight seconds.**
No install. No launcher. No 40-gig download.
Browser. Arena. Go.
→ CTA

## 05 — fight me
[webcam or seal avatar, deadpan]
**We built a game at our own game jam, and I will personally shoot you in it.**
Every Friday night the server goes live, the stream goes live,
and everyone on the list gets the arena link.
Come make me regret this.
→ CTA

## 06 — one player (the honest one)
[dashboard: PLAYERS ONLINE: 1 — live, true at time of capture]
**Players online right now: one. Me.**
It's ten-player arena chaos in your browser and I am so alone in here.
Fix this.
→ CTA

## 07 — 1v1 me (the positioning one)
[private-room duel footage, tense]
**Somebody in your chat says "1v1 me"?**
This is where you take them.
One link. No download. No excuses.
You're both in the arena in eight seconds,
and one of you is about to eat a parried rocket.
[announcer]
**JAKESJAM. The ultimate 1v1-me destination.**
→ CTA

## Tagline (use everywhere)
**JAKESJAM — the ultimate 1v1-me destination.**
Candidates: video descriptions, splash copy, channel bio, the gate copy.
Mechanically true: private rooms + browser + zero install = "1v1 me" is a
link you send, not an argument.

## Production notes
- 9:16, gameplay ALWAYS moving, cut on every sentence.
- Announcer FX on the bold opening lines only — same chain as the devlog
  (scratchpad assemble script → EPIC path), or re-record hot and process.
- Big captions, keywords only ("PARRY. ROCKETS. BACK.").
- The Fight Night sting ("IT'S FIGHT NIGHT!") from the devlog VO is
  reusable as-is in every short — one sting, consistent brand.
- Post cadence: one short per day, rotate hooks; devlog weekly; all roads
  → the same link (play.elyad.io).

---

# SLATE A — no-VO text-hook shorts, cut from clips already on disk
*Added 2026-08-09. The scripts above need a voice-over and a shoot. These
don't: hook burned on frame one, real game audio underneath, done. Every
one is built from a clip that already exists in `server/.clips/` — no
engine, no capture, no live match.*

**Why no VO:** ~85% of short-form viewing is muted, so frame one has to
carry the whole hook as text anyway. The VO scripts above are the weekly
devlog lane; this is the daily lane.

## The two rules

1. **The hook must be true of THAT clip.** Product claims ("browser",
   "no download") are safe on any clip. Event claims ("double kill",
   "2 HP") are only safe where the clip shows it — marked per row below.
2. **Never rotate the CTA.** `play.elyad.io` is burned in by
   `tools/build-short.sh`; leave it alone. Rotate hooks, never the mark.

## Build command

    tools/build-short.sh --in server/.clips/<id>.mp4 \
      --from <sec> --to <sec> --hook $'line one\nline two' \
      --out out/shorts/<name>.mp4

Defaults are already right: 1080x1920, zoom 1.55, real game audio, hook
fades by 2.6s, gold hairlines, `play.elyad.io` mark.

## The slate

| # | clip | in→out | hook (frame one) | claim | state |
|---|---|---|---|---|---|
| S1 | `0e21238e` | 0.5→11.5 | `DOUBLE KILL` / `in a browser tab` | event — clip shows the double | BUILT |
| S2 | `80ea1663` | 0.0→10.5 | `top of the spire.` / `two down.` | event — verified | BUILT |
| S3 | `7f7c9adb` | 0.8→11.0 | `these bots` / `actually fight back` | safe | BUILT |
| S4 | `8c92b0b0` | 0.0→12.4 | `wait for it.` | safe | BUILT |
| S5 | `a4d8d017` | 0.0→12.0 | `no download.` / `no account.` / `just this.` | safe | ready |
| S6 | `c2c1e342` | 0.0→12.0 | `this is a browser game.` / `yes. really.` | safe | ready |
| S7 | `139d08e5` | 0.0→11.5 | `one tab.` / `instant fight.` | safe | ready |
| S8 | `d5f2b4c0` | 0.0→9.5 | `you're in the arena` / `in 8 seconds` | safe | ready |

Sub-15s pure-spectacle loops: the 07-27 batch has ~25 clips that are
exactly 4.0s and are nothing but the kill moment (`1a102b9b`, `32949b23`,
`67ec35d3`, `9be57b42`, `e1ca5c43`, …). One hook, one boom, hard loop —
these are the cheapest posts in the archive.

## Hook bank (rotate; keep the mark fixed)

Safe on any clip:
- `no download.` / `no account.` / `just this.`
- `this is a browser game.` / `yes. really.`
- `one tab.` / `instant fight.`
- `wait for it.`
- `these bots` / `actually fight back`
- `you're in the arena` / `in 8 seconds`
- `1v1 me` / `is just a link now`

Only where the clip earns it:
- `DOUBLE KILL` / `in a browser tab`
- `top of the spire.` / `two down.`
- `he had one jump` / `to make this work`

## Known limits of this slate (say it plainly)

- Footage is **07-27**, before the venue/doors work. It shows the arena,
  not the current lobby-first landing.
- Every long clip in the batch triggered on the same highlight rule, so
  they read samey across a week. Vary the map (`80ea1663` is the spire,
  the rest are wood/boxworks) and the hook, not just the clip.
- No fresh footage exists: the autopilot cannot currently join the world
  (see `tools/bell-probe.mjs`), and bot-only matches never persist a
  replay (`matchHost.ts:1848`). This slate is deliberately independent
  of that being fixed.
