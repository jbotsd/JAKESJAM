# Autoplay semantic QA checklist (exhaustive)

**How to run:** `bun run autoplay:heavy -- --minutes 8` → extract frames from
the WebM at the timestamps the pilot logs (`ffmpeg -ss <t> -i <video> -frames:v 1`)
plus a coarse every-5s sweep → READ each frame (vision, not pixel-diff) and
judge every applicable row. A row fails if a competent spectator couldn't
answer its question from the frame. The pilot exercises E (at full charge)
and slots 1–4 (rotating taps) since 2026-07-17.

Legibility law (six-axes-goal.md doctrine #10) is the bar throughout: at
every point it should be clear what's going on.

## A. Venue journey (every run re-proves S2)

- [ ] A1 Splash/lobby loads: no black canvas, no raw loading text stuck >5s
- [ ] A2 Venue lobby readable: floor, pylons, bell visible; AUTOPILOT rig present
- [ ] A3 Bell queue: queue/ready state visibly changes at the bell
- [ ] A4 Starter draft: 3 card plates, names + descriptions legible at 720p
- [ ] A5 Admission: lobby→arena transition has no dead/black frames >1s

## B. Arena core combat

- [ ] B1 Round countdown/banner readable at round start
- [ ] B2 Shots visible: muzzle + trail + impact for own fire
- [ ] B3 Hit feedback: victim reaction (flash/knockback) distinguishable
- [ ] B4 Nameplates: name, health ring, status chips readable on every body
- [ ] B5 Action bar: HP orb number, shield orb, M1/M2/E diamonds present
- [ ] B6 Deaths: death FX plays; soul rite visible; respawn is clean
- [ ] B7 Chaos round 2+: modifier banner/tell readable ("what round is this")
- [ ] B8 Kill feed / score change visible on kill

## C. Emission (E)

- [ ] C1 Meter fills during combat (E diamond visibly filling)
- [ ] C2 Full charge reads: breathing point-of-light on the E slot
- [ ] C3 Cast moment: seal flash + camera punch + radial volley all in ≤3 frames
- [ ] C4 Volley carries build identity (element color / bounce / homing visible)
- [ ] C5 Meter zeroed after cast (diamond empty next frame)
- [ ] C6 Bot casts read identically (spectator view of an enemy Emission)

## D. Six Axes Layer 1 (needs the right hands — judge when they occur)

- [ ] D1 Drain: crimson thread victim→caster on leech hits
- [ ] D2 Ward: contracting sapphire rings + WARD chip during shell
- [ ] D3 Stride: dash pips snap full on cast (movement hand)
- [ ] D4 Mystery: shard wraps map edge cleanly — NO screen-wide trail streak
- [ ] D5 Technique: execute kill reads as a kill (no anticlimax frame)
- [ ] D6 Void kill: ascension DENIED — soul dragged down, crush ring

## E. Ability cards (keys 1–4)

- [ ] E1 Ability card offered in a draft: plate reads as an ACTIVE (cooldown in description)
- [ ] E2 New copy renders: "Interstice Writ" / "Shelter Writ" names fit their plates
- [ ] E3 On pick: slot pops onto the bar with hotkey label 1–4
- [ ] E4 Slot glyph legible at 720p (tithe X / step chevrons / nought circle / severed bar / seal diamond)
- [ ] E5 Press: activation cue + chip appears (TITHE crimson / VEIL violet / CNTR amber / WARD sapphire)
- [ ] E6 Cooldown sweep visible on the slot after use; hotkey label dims
- [ ] E7 Tithe window: crimson threads on gun hits while chip live
- [ ] E8 Shadow Step: rig relocates ≤240px toward aim, no wall-clip frame
- [ ] E9 Veil: nameplate chip shows; homing/satellites visibly ignore the veiled body
- [ ] E10 Severing Answer: negate flash + attacker takes the returned hit

## F. Draft phase (every round end)

- [ ] F1 Every roster player drafts (winner included — check bots pick too)
- [ ] F2 3 offers, plates legible, no overflow/clipped text on any card name
- [ ] F3 Pick feedback: chosen card animates/confirms; overlay closes clean

## G. Session hygiene (from the report, not frames)

- [ ] G1 Zero console/page errors (non-zero exit otherwise)
- [ ] G2 Full phase cycle seen: fighting, round-over, drafting, countdown
- [ ] G3 Match completes: results screen visible on tape
- [ ] G4 Player never stationary >1s while alive in fighting (showcase hard rule)

## Verdict format

Per run: table of rows judged (pass/fail/not-observed — an ability row not
triggered this run is NOT-OBSERVED, never silently passed), every failure
gets a frame path + one-line diagnosis, fixes filed before the next run.
