# SHOOT-LIST — devlog 000 + shorts 01–07 coverage map

Generated 2026-07-11 from CLIPS-MANIFEST.md + contact-sheet scrub + client/server source check.
Paths are relative to the repo root (`/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/`) unless they start with `~` or `/`.

## Conventions

- **CROP**: every `server/.clips-host/Replay_*.mp4` captured browser chrome — crop ~40 px off the top at 1080p (`crop=1920:1040:0:40`, then scale back to 1080 if needed). Marked "crop" below.
- **CLEAN**: `server/.clips/` UUID files, `server/.clips/kept/`, and all 720x1280 verticals are chrome-free canvas captures. No crop.
- **KEY FINDING — vertical siblings**: every 12:27–12:54 host replay has a native 720x1280 clean re-capture of the *same moment* in `server/.clips/` (timestamps + durations match, e.g. `69e08d68` 12:31:26/20.6s = `Replay_12-31-21` 20.6s). For shorts, prefer the vertical sibling over cropping the 16:9. Pairings used below. No siblings exist before 12:27 (notably not for 12-18-00 or 12-17-25 — crop those).
- `Replay_2026-07-11_12-23-37.mp4` is 120 fps — the designated slow-mo donor for any beat that wants a speed ramp.
- **Chrome-free future captures**: `stream-kit/launch-game-kiosk.sh` (chromeless app window, fullscreen WS6) + `stream-kit/launch-replay-buffer.sh` (gpu-screen-recorder ring buffer, auto-saves on kill with `JJ_HOST_REPLAY=1`; must run inside the Hyprland session). Anything captured this way needs **no crop**.

---

# 1. COVERED

## Devlog 000 (direct prompter) — 16:9

| Beat | Chosen clip | Moment (from sheet) | Crop |
|---|---|---|---|
| COLD OPEN — best 3 s of chaos | `server/.clips-host/Replay_2026-07-11_12-18-00.mp4` | last third: huge projectile fan + FIGHT! | crop |
| — alternate | `server/.clips-host/Replay_2026-07-11_12-17-25.mp4` | mid-clip: dense two-way projectile streams vs purple opponent | crop |
| "Every match starts fair / same kit" | `server/.clips/kept/c144f036-6915-40bb-9232-84cc5ed0c5b4.mp4` | two players calm traversal, round start | clean |
| "You shield" | `server/.clips-host/Replay_2026-07-11_12-31-21.mp4` | bottom-row tiles: white bubble flash around gold player under orange-orb fire (probable shield; verify in video — fallback = TO-RECORD #7) | crop |
| "You dash-bash across the arena" | `server/.clips-host/Replay_2026-07-11_12-22-59.mp4` | dash-in melee slash arc vs BOT-PISTON | crop |
| "You parry rockets back into people's faces" | **GAP — TO-RECORD #1.** Edit-scrub candidates first: `12-18-00` (Quick Parry drafted, fan arc), `12-31-21` (flash + orb), `12-17-25` | — | — |
| "Then the cards drop" (announcer) | `server/.clips-host/Replay_2026-07-11_12-31-21.mp4` | opening tiles: CHOOSE YOUR UPGRADE — Gluon Fangs / Seeker Facets / Needle Compressor, readable | crop |
| — alternate draft | `server/.clips-host/Replay_2026-07-11_12-27-29.mp4` | Molten Core / Aim Barrier / **Riot Mirror** cards held ~3 tiles | crop |
| "Homing / bounce / split shots" montage | `server/.clips-host/Replay_2026-07-11_12-17-25.mp4` + `12-27-09` + `12-21-47` | highest-bitrate fight block, curved and fanned projectile trails | crop |
| "Cards stack… balance spreadsheet" (absurd screen) | `server/.clips-host/Replay_2026-07-11_12-18-00.mp4` | projectile-fan tile | crop |
| "Die, lose it all" | `server/.clips-host/Replay_2026-07-11_12-11-57.mp4` | ELIMINATED 15 death card held, respawn countdown after | crop |
| "Every life is a brand-new science accident" | `server/.clips-host/Replay_2026-07-11_10-33-21.mp4` | clean 3 → 2 → FIGHT! countdown into projectile trades | crop |
| HONEST BIT — jam-era footage | `~/Pictures/screenshot-2026-05-01_18-34-07.png` (jam day 1: standalone HTML host/join client, stick-figure player, raw IP+room-code join UI) → `~/Pictures/screenshot-2026-05-02_11-00-35.png` (side-by-side lobby, room A8F9PA) → `~/Pictures/screenshot-2026-05-02_20-24-18.png` (green-platform prototype arena live at jakesjam.vercel.app) | stills — Ken Burns them; the visible browser/OS chrome is authentic here, keep it | none |
| — more jam-era stills to pick from | `~/Pictures/screenshot-2026-05-0{1,2,3}_*.png` (~40 files, May 1–6) | scrub for variety; May 3 21:17–22:50 block = post-jam-weekend polish | none |
| — "the jam ended, the game refused to" empty-arena mood | `server/.clips/kept/4facc5b6-a8f9-4950-b1fd-bc7014eaa909.mp4` | ultra-wide vista, one tiny player walking alone (Jake hand-kept) | clean |
| "deterministic netcode written in Zig" | optional TO-RECORD #10 (code b-roll); otherwise stay on gameplay | — | — |
| FIGHT NIGHT — one clean kill | `server/.clips-host/Replay_2026-07-11_12-17-05.mp4` | death sequence ending in "TO YOU" attribution | crop |
| — alternate kill | `server/.clips-host/Replay_2026-07-11_12-27-29.mp4` | final tile "TO YOU" after Riot Mirror round | crop |
| CLOSE — CTA over gameplay | `server/.clips-host/Replay_2026-07-11_12-33-22.mp4` or reprise of the cold-open clip | any high-motion stretch | crop |

**Coverage: ~85%** — gaps: parry hero moment (shared with short 03), shield confirmation, optional Zig code b-roll.

## Short 01 — IT'S HERE (9:16)

| Beat | Chosen clip | Moment | Crop |
|---|---|---|---|
| best 2 s of chaos (announcer) | `server/.clips/5ca306b1-3a5a-4854-bc42-1b754a10a756.mp4` (vertical sibling of 12-27-09; highest-bitrate vertical, 22.5 MB/20 s) | densest projectile stretch | clean 9:16 |
| "Ten space wizard ninjas. One arena." | `server/.clips/26511969-7523-47a3-89c4-be8cc888dcc7.mp4` (sibling of 12-32-23) | multi-entity fight | clean 9:16 |
| kill on screen | `server/.clips/4026d8be-e661-4e8b-b0d8-3b9bf94979d2.mp4` (sibling of 12-27-29) | ends in "TO YOU" kill | clean 9:16 |
| CTA (see Universal CTA) | `server/.clips/0880beae-0082-462c-b2a1-e1a1f5b60eca.mp4` (sibling of 12-33-22) | any motion | clean 9:16 |

**Coverage: 100%.**

## Short 02 — the build (9:16)

| Beat | Chosen clip | Moment | Crop |
|---|---|---|---|
| "This gun started polite" | `server/.clips/kept/3cd60d29-2c36-4081-b5dd-d0387b6ad463.mp4` | calm early-round vertical | clean 9:16 |
| "Every card you grab mutates it" | `server/.clips/69e08d68-ebce-483a-93c7-fad151b682dd.mp4` (sibling of 12-31-21) | CHOOSE YOUR UPGRADE draft → back into fight | clean 9:16 |
| — second draft (different cards) | `server/.clips/4026d8be-e661-4e8b-b0d8-3b9bf94979d2.mp4` | Molten Core / Aim Barrier / Riot Mirror | clean 9:16 |
| "Ten picks later it's a war crime" | `server/.clips/5ca306b1-3a5a-4854-bc42-1b754a10a756.mp4` | screen-full-of-projectiles stretch | clean 9:16 |
| — 16:9 fallback if more density needed | `server/.clips-host/Replay_2026-07-11_12-18-00.mp4` fan / `12-17-25` | crop to 9:16 center | crop |
| CTA | any group-(c) vertical | — | clean |

**Coverage: 100%.**

## Short 03 — the parry (9:16)

| Beat | Chosen clip | Moment | Crop |
|---|---|---|---|
| hook: rocket deflected back into sender | **GAP — TO-RECORD #1.** Contact sheets scrubbed for 12-18-00 (Quick Parry card confirmed drafted + a curved deflect-looking fan), 12-22-59 (melee slash only), 12-17-25, 12-17-05, 12-31-21 (shield/parry flash + orange orb), 12-27-29 (Riot Mirror card exists — a reflect upgrade): **no confirmable rocket-return in any still**. Video-scrub 12-18-00 and 12-31-21 in the edit bay first; if nothing, record it. | — | — |
| "That's the whole video. That's the feature." | freeze-frame + replay of the same clip | — | — |
| CTA | any group-(c) vertical | — | clean |

**Coverage: ~15%** (CTA only). Entire short blocked on one clip.

## Short 04 — eight seconds (9:16)

| Beat | Chosen clip | Moment | Crop |
|---|---|---|---|
| stopwatch overlay, link → email → in-game | **GAP — TO-RECORD #3** (real-time screen recording, timer visible) | — | — |
| "Browser. Arena. Go." payoff | `server/.clips/a306b1b9-c878-4456-90c3-aeb97df8a875.mp4` (sibling of 12-54-44, freshest session) | drop-in + first fight | clean 9:16 |
| CTA | any group-(c) vertical | — | clean |

**Coverage: ~30%.**

## Short 05 — fight me (9:16)

| Beat | Chosen clip | Moment | Crop |
|---|---|---|---|
| webcam or seal avatar, deadpan | **GAP — TO-RECORD #5.** Existing `~/Videos/JAKESJAM/devlog-000-voice-seal.mp4` (1080p24, 240.9 s) is the devlog VO seal render — wrong words for this short; the pipeline (`stream-kit/render-avatar-from-wav.py`) is proven, re-render from short-05 VO | — | — |
| "I will personally shoot you in it" gameplay | `server/.clips/4026d8be-e661-4e8b-b0d8-3b9bf94979d2.mp4` | "TO YOU" kill | clean 9:16 |
| "every Friday night… server live, stream live" | `server/.clips/c1f5cbe6-c36c-4761-a420-b5aeae9de21e.mp4` (sibling of 12-32-56) | sustained fight | clean 9:16 |
| CTA | any group-(c) vertical | — | clean |

**Coverage: ~60%.**

## Short 06 — one player, the honest one (9:16)

| Beat | Chosen clip | Moment | Crop |
|---|---|---|---|
| dashboard: PLAYERS ONLINE: 1 | **GAP — TO-RECORD #2.** Surfaces confirmed in source (see task) | — | — |
| "I am so alone in here" | `server/.clips/kept/4facc5b6-a8f9-4950-b1fd-bc7014eaa909.mp4` | empty-arena vista, lone walker | clean (16:9 — center-crop to 9:16, composition survives) |
| — bot wandering alone | `server/.clips/02bb89e6-bdcf-41f1-8eb6-8f806a17245e.mp4` / vertical twin `server/.clips/e0350ca7-0f05-4726-9f9d-79f6872e0cf2.mp4` | solo BOT-PISTON pacing the platforms | clean; vertical twin is native 9:16 |
| "it's ten-player arena chaos" contrast flash | `server/.clips/5ca306b1-3a5a-4854-bc42-1b754a10a756.mp4` | 1 s of chaos | clean 9:16 |
| CTA | any group-(c) vertical | — | clean |

**Coverage: ~70%.**

## Short 07 — 1v1 me (9:16)

| Beat | Chosen clip | Moment | Crop |
|---|---|---|---|
| tense private-room duel | `server/.clips-host/Replay_2026-07-11_12-17-25.mp4` (duel vs purple opponent, both directions firing) — usable now; **ideal version = TO-RECORD #4** with the room code visible | mid-clip trades | crop → 9:16 center |
| "one link, no download" | reuse TO-RECORD #3 funnel footage (first 3 s) | — | — |
| "one of you is about to eat a parried rocket" | the parry clip (TO-RECORD #1) — same asset as short 03 | — | — |
| announcer tag + CTA | any group-(c) vertical | — | clean |

**Coverage: ~50%** (shippable at lower tension today; blocked on #1 for the last line).

## Universal CTA (ends every short)

| Beat | Chosen clip | Moment | Crop |
|---|---|---|---|
| "Plays in your browser. Link in bio — eight seconds." | standardize on ONE clip for brand consistency: `server/.clips/0880beae-0082-462c-b2a1-e1a1f5b60eca.mp4` (21.9 s vertical, high bitrate) | pick the same 4 s stretch every time | clean 9:16 |
| "And Friday night? IT'S FIGHT NIGHT." (announcer sting) | same clip, speed-ramp the last beat; optional slow-mo insert from `Replay_2026-07-11_12-23-37.mp4` (120 fps) | — | crop if 120 fps insert used |

**Coverage: 100%.**

## Order of Perpetual Respawn (cult bit)

| Beat | Chosen clip | Moment | Crop |
|---|---|---|---|
| The Monday Bean (coffee + arena) | **TO-RECORD #6** — phone shot | — | — |
| The Opening of the Gates (Fight Night open) | **TO-RECORD #8** — OBS STARTING SOON scene w/ Seal breathing (stream-kit already renders this) | — | — |
| The Draft ("choose your blessing") | `server/.clips-host/Replay_2026-07-11_12-31-21.mp4` draft | — | crop |
| Purgatory (respawn timer) | `server/.clips-host/Replay_2026-07-11_12-11-57.mp4` countdown | — | crop |
| The Gnostic Seal | `~/Videos/JAKESJAM/devlog-000-voice-seal.mp4` (any breathing stretch) | — | clean |

---

# 2. TO RECORD

One line each first (the punch list), details below.

1. **Parry hero clip** — draft Quick Parry vs a rocket bot, return the rocket into its face, replay-buffer auto-save; kiosk shell; 10–20 s; 1080p60 + in-game vertical.
2. **"PLAYERS ONLINE: 1" dashboard** — screenshot/5 s record of the ops console (`localhost:8088/ops?key=$ADMIN_SECRET`) or the in-game MatchStatusBadge ("1 player"); grim or wf-recorder.
3. **Eight-second funnel flow** — one continuous real-time take: link click → email gate → in arena, visible timer; OBS full-screen; ≤15 s; 1080p60 + a real phone 9:16 take.
4. **Private-room 1v1** — create room, show code + Copy link, second client joins, tense duel; kiosk both windows; 20–30 s; 1080p60 + in-game vertical clip.
5. **Short-05 face shot** — deadpan webcam/phone piece OR Voice Seal re-render from the short-05 VO wav; 15–20 s; 9:16.
6. **Monday Bean b-roll** — phone: coffee mug raised in foreground, arena running on monitor behind; 10–15 s; 4K30.
7. **Shield beat insurance** — practice mode, hold shield under bot fire; kiosk + replay buffer; 5–10 s; 1080p60.
8. **Opening of the Gates b-roll** — screen-record the OBS STARTING SOON scene (gate animation + breathing Seal); 15–30 s; 1080p.
9. **Ten-player chaos plate (optional)** — max bots in one arena for a true "ten space wizard ninjas" wide; kiosk; 15 s; 1080p60.
10. **Zig netcode b-roll (optional)** — editor slow-scroll of `sim/src/*.zig` + client/server side-by-side; 10 s; native res.

## Details

### #1 Parry hero clip (blocks short 03; used by devlog + short 07)
- **In-game**: private room or practice, bots ON (BOT-PISTON/SPARK as the rocket source). Draft **Quick Parry** (seen in the 12-18-00 draft) — Riot Mirror (12-27-29 draft) is the shield-reflect alternative if Quick Parry won't produce a travel-back projectile. Stand in the rocket's path, parry on contact, keep the camera framing both you and the sender until the returned rocket kills them (kill card "TO BOT - …" = the receipt).
- **Capture**: `stream-kit/launch-game-kiosk.sh` (no browser chrome → **no crop ever**), then `JJ_HOST_REPLAY=1` + `stream-kit/launch-replay-buffer.sh` — the kill triggers SIGUSR1 ~3 s later and the buffer saves exactly this moment. Run from a terminal inside the Hyprland session (gsr EGL constraint).
- **Also**: trigger the in-game clip share right after, so a native 720x1280 vertical sibling lands in `server/.clips/` for short 03.
- **Target**: 10–20 s, 1920x1080@60. Repeat until one take reads unambiguously in a thumbnail.
- **Before recording**: video-scrub `Replay_2026-07-11_12-18-00.mp4` (Quick Parry was drafted IN this clip; the projectile fan at ~2/3 could already be it) and `12-31-21` — a found clip saves the shoot.

### #2 "PLAYERS ONLINE: 1" (short 06)
Three confirmed surfaces (do not fake it — the script says "live, true at time of capture"):
- **Ops console** (best "dashboard" look): `http://localhost:8088/ops` — Elm UI, auth via `?key=$ADMIN_SECRET` (also accepts `x-admin-secret` header / cookie; `server/src/ops.ts:64-75`). World card renders `players: N` and each match as `"Np · phase · mapId"` (`ops/console/src/Main.elm:754,1136,1165`).
- **Client HUD**: `MatchStatusBadge` polls `/world/summary` and renders `waiting · 1 player · round 1 · 0:57` (`client/src/game/ui/MatchStatusBadge.ts:168-178`) — capture in the kiosk shell while sitting alone in the world.
- **Raw JSON** (nerd-credible): `curl localhost:8088/world/summary` in a big-font terminal — `"players": 1`.
- **Capture**: `grim` for a still, or 5–8 s `wf-recorder`/OBS so the uptime/timer visibly ticks (proves live). If the literal string "PLAYERS ONLINE: 1" is wanted, zoom the ops-console players line and caption it — don't screenshot-shop the UI.
- Have the game open in another window first so the count reads 1, not 0.

### #3 Eight-second funnel flow (short 04)
- **Do**: fresh browser profile (logged out, no autofill surprises — or WITH autofill to be honestly fast). One continuous take: click the play.elyad.io link (from a real-looking surface — YouTube description or a chat) → email gate → submit → spawn → move and shoot. Practice the run; the take must genuinely land ≤ 8 s from click to control.
- **Timer**: OBS stopwatch overlay started on the click, or a phone stopwatch physically in frame (more credible). Post-burned timer from the recording clock is the fallback.
- **Capture**: OBS full-screen display capture, 1920x1080@60, ~15 s including a 2 s pre-roll. **Keep the browser chrome — it's the proof** (only case where the 40 px rule inverts). Also do one genuine phone take (portrait, 9:16 native) — tapping a link on a phone and being in the arena is the stronger short.

### #4 Private-room 1v1 (short 07 ideal)
- **Do**: create room in client A, linger 2 s on the room code + Copy link UI, join from client B (second browser/machine), play a genuinely tense duel — low HP trades, one decisive kill.
- **Capture**: kiosk shell on the hero client (no crop), 1080p60 via replay buffer or OBS; save an in-game vertical clip of the best exchange. 20–30 s usable.
- **Setup**: bots OFF (it must read as two humans), name the second player something chat-plausible.

### #5 Short-05 face shot
- Option A: phone/webcam, deadpan, flat delivery to lens, 9:16, neutral desk/streamer framing, 15–20 s.
- Option B: Voice Seal — render from the short-05 VO wav via `stream-kit/render-avatar-from-wav.py` (same pipeline that produced `~/Videos/JAKESJAM/devlog-000-voice-seal.mp4`; note the v2 render was still in progress at manifest time — re-probe before reuse). Seal keeps the brand consistent with the stream kit.

### #6 Monday Bean b-roll (Order bit)
- Phone, 4K30, window light. Foreground: mug raised toward the screen (toast gesture). Background: arena running (kiosk fullscreen so no chrome). 10–15 s, one slow push-in. Shot doubles as the recurring Monday-post header.

### #7 Shield beat insurance (devlog "You shield")
- Only if the edit can't confirm a clean shield bubble in `12-31-21`/`12-18-00`: practice mode, stand in bot fire, hold shield 2–3 s, drop it, dash out. Kiosk + replay buffer, 5–10 s, 1080p60.

### #8 Opening of the Gates b-roll (Order bit / Fight Night promos)
- `stream-kit/launch-stream-ready.sh`, sit on the STARTING SOON scene (gate animation + Seal breathing — already built), screen-record 15–30 s at 1080p. No game interaction needed.

### #9 Ten-player chaos plate (optional, strengthens 01/02 and the devlog cold open)
- Max out bots in one arena (whatever the current bot cap allows) for a genuinely crowded wide shot — current best clips show 2–3 entities, the copy says "ten space wizard ninjas". Kiosk, 15 s, 1080p60 + in-game vertical save.

### #10 Zig netcode b-roll (optional, devlog honest bit)
- Editor slow-scroll through `sim/src/*.zig` with syntax highlighting, then a side-by-side kiosk window + server log tick. 10 s, native res, any screen recorder. Skip if the honest bit stays on jam stills.
