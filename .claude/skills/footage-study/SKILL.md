---
name: footage-study
description: Study real JAKESJAM footage frame-by-frame (rendered highlight clips, autoplay tapes, or any mp4/webm), produce an exhaustively indexed defect critique, diff it against the standing goal ledger, then fix the weakest point and loop. Use when the user shares a clip URL/file, says "study the footage", asks what a video shows we should improve, or after any change that should be verified on tape.
---

# Footage Study — the clip IS the code review

The iteration loop Jake named directly (2026-07-17: "what you did there where
you took the latest clip then said what it need — that's the type of iteration
i like"). The unit of review is REAL FOOTAGE from the real pipeline, studied
frame by frame, critiqued exhaustively with indexed defects, then acted on —
weakest point first — and re-taped. Never grade the game from a single
screenshot or from memory of how it "should" look.

## The pipeline (always all five stages, in order)

### 1. ACQUIRE — get real footage, never synthetic fixtures

Pick whichever source matches the ask; when unspecified, use the newest
rendered highlight (that's the artifact strangers actually see):

- **Share URL** `play.elyad.io/c/<slug>` → the file is local:
  `server/.clips/<slug>.mp4` (resolve via `curl -s localhost:8088/c/<slug> |
  grep -o 'src="[^"]*"'` if the slug↔filename mapping is in doubt).
- **Latest rendered highlight**: `ls -t server/.clips/*.mp4 | head -1`.
- **Fresh gameplay tape**: `bun run autoplay` (light) or
  `bun scripts/autoplay.ts --heavy --minutes 5` when judging visual fidelity
  — the pilot plays a real match and the WebM lands in
  `tests/e2e/.artifacts/autoplay/`. Use `--heavy` for content/vfx judgment;
  light mode's potato tier is NOT representative of visual quality (only of
  flow/logic).
- A path/URL the user gives you.

### 2. PROBE — the container never lies

```
ffprobe -v error -show_entries format=duration,size,bit_rate \
  -show_entries stream=codec_name,width,height,r_frame_rate <file>
ffprobe -v error -count_frames -select_streams v \
  -show_entries stream=nb_read_frames -of csv=p=0 <file>   # real fps = frames/duration
ffprobe -v error -select_streams a -show_entries stream=codec_name <file>  # audio?
```

Always compute **real fps** (frame count ÷ duration) — nominal metadata has
lied before (57600/1). Always check for an audio stream. When
`scripts/probe-clip.ts` exists (clip-goal CL.0), run it first and treat its
table as the probe baseline.

### 3. STUDY — read every frame like a reviewer, not a fan

```
mkdir -p <scratchpad>/clipstudy && ffmpeg -y -v error -i <file> \
  -vf fps=2 <scratchpad>/clipstudy/f-%02d.png
```

READ the full 2fps set (a 10s clip is ~20 frames — read all of them, no
sampling shortcuts). Around anything interesting (a kill, a banner, a pop),
extract a dense burst and read that too:
`ffmpeg -ss <t> -i <file> -frames:v 40 burst-%02d.png` — bursts are how you
judge motion (does the ring advance EVERY frame?), never single stills.

Walk the fixed critique dimensions every time — the point of a pipeline is
that no dimension gets skipped because the loudest defect stole attention:

1. **Story & the star** — whose clip is this, are they doing the most
   interesting thing on screen, does it end on THEIR beat (never on someone
   else's banner)? First/last frame: would a stranger understand and care?
2. **Camera** — are actor and consequence framed together? Any punch-in /
   slow-mo / re-frame on beats, or static wide? Anything important
   off-frame or edge-clipped?
3. **Combat feedback legibility** — do hits/kills/deaths read at the actual
   rendered zoom? Damage numbers legible? Does anything render twice
   (stacked/offset duplicates)?
4. **Text & banners** — collisions with world clutter or each other, ghost
   lingering, escalation order, stray labels that mean nothing in context.
5. **Chrome ownership** — whose HUD is baked in? Spectator rows, dev badges
   (latency chip), timers — anything that doesn't belong to THIS artifact.
6. **Encode** — resolution exact? real fps vs target? audio present and
   audible? bitrate sane for the content? duration matches intent?
7. **Identity** — if this file is re-uploaded naked, does it name the game
   and the player? Watermark, lower-third, end beat.
8. **Art nits** — idle poses reading as AFK, effects without origins,
   fg/bg fidelity mismatches. Log them; they rank last.

### 4. INDEX & DIFF — critique that survives the conversation

- Number every defect (`B1..Bn`) with the frame/timestamp that proves it.
  A defect without a frame reference doesn't go in the list.
- Diff against the standing ledger (`docs/clip-goal.md` baseline + evidence
  ledger, or the relevant goal doc for non-clip footage): mark each finding
  **RETIRED** (was indexed, now fixed — say which commit), **REGRESSED**
  (was fixed, back again), or **NEW**. Regressions outrank everything.
- Order the writeup by impact, not by discovery order. Lead with the one
  sentence Jake would say watching it.

### 5. ACT & LOOP — the critique is not the deliverable

Apply the house iteration doctrine (same as the screenshot loop and the
showcase rule): **fix the weakest point, re-tape, repeat** — don't
cherry-pick the fun item.

- If the user asked for a study only: deliver the indexed critique and
  update the goal ledger with a dated study entry. Stop there.
- If iterating (default when the user says improve/iterate/fix): take the
  top-impact item (regressions first, then B-order), fix it, verify with
  tests + a FRESH acquisition of the same footage class, then run the
  pipeline again on the new tape. Loop until the user's scope is spent or
  the top remaining item is AWAITING-JAKE-only (feel/taste calls).
- New systemic findings (multi-pillar work) go into the goal doc as new
  indexed baseline defects + pillars, venue-goal style: every acceptance
  criterion tool-verifiable, eye tests labeled AWAITING JAKE and never
  blocking.

## Hard rules

- **Real pipeline footage only.** A hand-staged scene proves nothing about
  what players/strangers actually see. (Autoplay tapes count — the pilot
  drives trusted inputs through the real game.)
- **Bursts for motion claims.** Never assert "smooth"/"jittery" from stills;
  extract consecutive frames and look at the deltas (this is how the action
  bar staircase and the 21.6fps drop were caught).
- **Every claim carries its frame.** Timestamps/frame files go in the
  writeup and the ledger; screenshots of the offending frames accompany the
  critique when they'd change what the reader does.
- **Ledger or it didn't happen.** Every study appends a dated entry to the
  relevant goal doc's evidence ledger — retired/regressed/new counts — so
  the next study diffs against THIS one, not against memory.
- Keep extraction work in the session scratchpad; keep the tapes
  (`server/.clips/`, `tests/e2e/.artifacts/autoplay/`) where they live —
  never delete footage that a ledger entry cites.

## Reference: the first full run (the template for tone and depth)

The study of `/c/dff7f450-55dc-4316-8df7-654ebf4e2ccb` (2026-07-17)
produced 11 indexed defects (B1–B11) across all eight dimensions and became
`docs/clip-goal.md` — read its baseline section before your first study so
the indexing stays consistent.
