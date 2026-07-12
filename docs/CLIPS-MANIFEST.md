# JAKESJAM Gameplay Clip Manifest

Generated 2026-07-11 by exhaustive scan for the devlog edit. Every video file in the clip stores, OBS dirs, Downloads, and Playwright dirs was ffprobed. Contact sheets (4x3 thumbnail tiles) for every big-res clip live in [`docs/clip-sheets/`](clip-sheets/) — one JPG per clip, filename-prefixed by source (`host_` = OBS replay buffer, `clip_` = server .clips store, `kept_` = .clips/kept, `obs_` = ~/Videos/JAKESJAM).

## Key findings

- **`server/.clips-host/` is the motherlode**: 178 OBS replay-buffer saves, all 1920x1080@60 h264, from the 2026-07-11 play session (09:21-12:54). NOTE: these captured the whole browser window — browser tab/URL chrome is visible at the top (~40 px). Crop it in the edit, or use the clean `.clips` canvas captures for hero shots.
- **14 of the `server/.clips/` 1080p60 UUID files are byte-identical copies of `.clips-host` replays** (the server clip endpoint ingested them). Marked as DUPLICATE below and excluded from totals.
- **The `.clips` 1920x938@30 and vertical 720x1280 files are clean canvas captures** (no browser chrome) — lower fps but polished-looking.
- **`server/.clips/kept/` = Jake's hand-picked keepers.** 8 real clips (5 byte-identical to the parent dir) + 16 five-byte stub .webm files (failed recordings, worthless).
- **3 "Replay" files are lock-screen captures, not gameplay** (`11-23-35`, `11-24-07`, `11-24-29` — "Enter Password" screen). Flagged below.
- `test-results/` contains no videos. `~/Videos/intrepid-promo/` contains no videos. Playwright footage found instead in `tests/e2e/.artifacts/`, `tests/e2e/.report/data/`, `.combat-probe/videos/`, `.match-probe/videos/`.

## (a) BIG-RES gameplay (1920-wide), newest first

| File | Res | fps | Dur (s) | Codec | Size (MB) | Modified | Sheet / Notes |
|---|---|---|---|---|---|---|---|
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-54-44.mp4` | 1920x1080 | 60.00 | 21.4 | h264 | 2.5 | 2026-07-11 12:54:44 | [sheet](clip-sheets/host_Replay_2026-07-11_12-54-44.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-51-12.mp4` | 1920x1080 | 60.00 | 21.7 | h264 | 3.2 | 2026-07-11 12:51:12 | [sheet](clip-sheets/host_Replay_2026-07-11_12-51-12.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/9fcea6ed-5b43-4ad7-901b-2f33a41616a5.mp4` | 1920x938 | 30.00 | 12.0 | h264 | 9.5 | 2026-07-11 12:49:54 | [sheet](clip-sheets/clip_9fcea6ed-5b43-4ad7-901b-2f33a41616a5.jpg) — player vs BOT-SPARK projectile fight, clean capture |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/1b86e14f-ad0d-4a39-be75-98943437db00.mp4` | 1920x938 | 30.00 | 12.0 | h264 | 17.1 | 2026-07-11 12:43:53 | [sheet](clip-sheets/clip_1b86e14f-ad0d-4a39-be75-98943437db00.jpg) — highest bitrate .clips; solo traversal/jetpack, clean capture |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/cb1821ea-3683-4fff-b0da-30f799689395.mp4` | 1920x938 | 30.00 | 12.0 | h264 | 5.3 | 2026-07-11 12:37:51 | [sheet](clip-sheets/clip_cb1821ea-3683-4fff-b0da-30f799689395.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-33-22.mp4` | 1920x1080 | 60.00 | 21.9 | h264 | 10.3 | 2026-07-11 12:33:22 | [sheet](clip-sheets/host_Replay_2026-07-11_12-33-22.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-32-56.mp4` | 1920x1080 | 60.00 | 21.4 | h264 | 12.9 | 2026-07-11 12:32:56 | [sheet](clip-sheets/host_Replay_2026-07-11_12-32-56.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-32-23.mp4` | 1920x1080 | 60.00 | 20.9 | h264 | 12.9 | 2026-07-11 12:32:23 | [sheet](clip-sheets/host_Replay_2026-07-11_12-32-23.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-31-58.mp4` | 1920x1080 | 60.00 | 21.2 | h264 | 9.4 | 2026-07-11 12:31:58 | [sheet](clip-sheets/host_Replay_2026-07-11_12-31-58.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/9844db5b-9faf-4c93-a30d-446cfe857cb1.mp4` | 1920x938 | 30.00 | 12.0 | h264 | 9.5 | 2026-07-11 12:31:56 | [sheet](clip-sheets/clip_9844db5b-9faf-4c93-a30d-446cfe857cb1.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-31-32.mp4` | 1920x1080 | 60.00 | 9.5 | h264 | 6.3 | 2026-07-11 12:31:32 | [sheet](clip-sheets/host_Replay_2026-07-11_12-31-32.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-31-21.mp4` | 1920x1080 | 60.00 | 20.6 | h264 | 16.8 | 2026-07-11 12:31:21 | [sheet](clip-sheets/host_Replay_2026-07-11_12-31-21.jpg) — CHOOSE YOUR UPGRADE draft (Gluon Fangs/Seeker Facets/Needle Compressor) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-30-57.mp4` | 1920x1080 | 60.00 | 13.1 | h264 | 9.7 | 2026-07-11 12:30:57 | [sheet](clip-sheets/host_Replay_2026-07-11_12-30-57.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-30-44.mp4` | 1920x1080 | 60.00 | 21.5 | h264 | 11.5 | 2026-07-11 12:30:44 | [sheet](clip-sheets/host_Replay_2026-07-11_12-30-44.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-30-21.mp4` | 1920x1080 | 60.00 | 18.7 | h264 | 9.6 | 2026-07-11 12:30:21 | [sheet](clip-sheets/host_Replay_2026-07-11_12-30-21.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-30-02.mp4` | 1920x1080 | 60.00 | 21.1 | h264 | 8.3 | 2026-07-11 12:30:02 | [sheet](clip-sheets/host_Replay_2026-07-11_12-30-02.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-27-48.mp4` | 1920x1080 | 60.00 | 17.2 | h264 | 10.2 | 2026-07-11 12:27:48 | [sheet](clip-sheets/host_Replay_2026-07-11_12-27-48.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-27-29.mp4` | 1920x1080 | 60.00 | 18.8 | h264 | 13.4 | 2026-07-11 12:27:29 | [sheet](clip-sheets/host_Replay_2026-07-11_12-27-29.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-27-09.mp4` | 1920x1080 | 60.00 | 20.2 | h264 | 15.4 | 2026-07-11 12:27:09 | [sheet](clip-sheets/host_Replay_2026-07-11_12-27-09.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-26-48.mp4` | 1920x1080 | 60.00 | 17.4 | h264 | 11.0 | 2026-07-11 12:26:48 | [sheet](clip-sheets/host_Replay_2026-07-11_12-26-48.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-26-30.mp4` | 1920x1080 | 60.00 | 11.8 | h264 | 8.2 | 2026-07-11 12:26:30 | [sheet](clip-sheets/host_Replay_2026-07-11_12-26-30.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-26-17.mp4` | 1920x1080 | 60.00 | 10.4 | h264 | 7.2 | 2026-07-11 12:26:17 | [sheet](clip-sheets/host_Replay_2026-07-11_12-26-17.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-26-05.mp4` | 1920x1080 | 60.00 | 17.0 | h264 | 8.6 | 2026-07-11 12:26:05 | [sheet](clip-sheets/host_Replay_2026-07-11_12-26-05.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-25-48.mp4` | 1920x1080 | 60.00 | 11.8 | h264 | 10.3 | 2026-07-11 12:25:48 | [sheet](clip-sheets/host_Replay_2026-07-11_12-25-48.jpg) — bot fight; death card "TO BOT - PISTON" |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-25-36.mp4` | 1920x1080 | 60.00 | 17.8 | h264 | 10.2 | 2026-07-11 12:25:36 | [sheet](clip-sheets/host_Replay_2026-07-11_12-25-36.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-25-18.mp4` | 1920x1080 | 60.00 | 17.5 | h264 | 13.0 | 2026-07-11 12:25:18 | [sheet](clip-sheets/host_Replay_2026-07-11_12-25-18.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-24-59.mp4` | 1920x1080 | 60.00 | 16.4 | h264 | 7.5 | 2026-07-11 12:24:59 | [sheet](clip-sheets/host_Replay_2026-07-11_12-24-59.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-24-42.mp4` | 1920x1080 | 60.00 | 15.9 | h264 | 12.2 | 2026-07-11 12:24:42 | [sheet](clip-sheets/host_Replay_2026-07-11_12-24-42.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-24-25.mp4` | 1920x1080 | 60.00 | 10.5 | h264 | 7.5 | 2026-07-11 12:24:25 | [sheet](clip-sheets/host_Replay_2026-07-11_12-24-25.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-24-14.mp4` | 1920x1080 | 60.00 | 17.7 | h264 | 11.2 | 2026-07-11 12:24:14 | [sheet](clip-sheets/host_Replay_2026-07-11_12-24-14.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-23-55.mp4` | 1920x1080 | 60.00 | 16.7 | h264 | 10.7 | 2026-07-11 12:23:55 | [sheet](clip-sheets/host_Replay_2026-07-11_12-23-55.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-23-37.mp4` | 1920x1080 | 120.00 | 18.4 | h264 | 10.9 | 2026-07-11 12:23:37 | [sheet](clip-sheets/host_Replay_2026-07-11_12-23-37.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-23-18.mp4` | 1920x1080 | 60.00 | 17.9 | h264 | 10.5 | 2026-07-11 12:23:18 | [sheet](clip-sheets/host_Replay_2026-07-11_12-23-18.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-22-59.mp4` | 1920x1080 | 60.00 | 12.9 | h264 | 10.9 | 2026-07-11 12:22:59 | [sheet](clip-sheets/host_Replay_2026-07-11_12-22-59.jpg) — dash/melee slash vs bot; "TO BOT - PISTON" death + explosion |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-22-45.mp4` | 1920x1080 | 60.00 | 21.0 | h264 | 11.0 | 2026-07-11 12:22:45 | [sheet](clip-sheets/host_Replay_2026-07-11_12-22-45.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-22-20.mp4` | 1920x1080 | 60.00 | 21.3 | h264 | 13.1 | 2026-07-11 12:22:20 | [sheet](clip-sheets/host_Replay_2026-07-11_12-22-20.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-21-47.mp4` | 1920x1080 | 60.00 | 20.3 | h264 | 15.6 | 2026-07-11 12:21:47 | [sheet](clip-sheets/host_Replay_2026-07-11_12-21-47.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-21-21.mp4` | 1920x1080 | 60.00 | 12.7 | h264 | 8.5 | 2026-07-11 12:21:21 | [sheet](clip-sheets/host_Replay_2026-07-11_12-21-21.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-21-08.mp4` | 1920x1080 | 60.00 | 21.4 | h264 | 10.3 | 2026-07-11 12:21:08 | [sheet](clip-sheets/host_Replay_2026-07-11_12-21-08.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-20-41.mp4` | 1920x1080 | 60.00 | 20.4 | h264 | 7.0 | 2026-07-11 12:20:41 | [sheet](clip-sheets/host_Replay_2026-07-11_12-20-41.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-19-04.mp4` | 1920x1080 | 60.00 | 21.4 | h264 | 9.1 | 2026-07-11 12:19:04 | [sheet](clip-sheets/host_Replay_2026-07-11_12-19-04.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-18-36.mp4` | 1920x1080 | 60.00 | 12.1 | h264 | 8.7 | 2026-07-11 12:18:36 | [sheet](clip-sheets/host_Replay_2026-07-11_12-18-36.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-18-23.mp4` | 1920x1080 | 60.00 | 20.9 | h264 | 13.3 | 2026-07-11 12:18:23 | [sheet](clip-sheets/host_Replay_2026-07-11_12-18-23.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-18-00.mp4` | 1920x1080 | 60.00 | 14.2 | h264 | 11.8 | 2026-07-11 12:18:01 | [sheet](clip-sheets/host_Replay_2026-07-11_12-18-00.jpg) — TOP PICK: card draft (Quick Parry visible) + ELIMINATED + 3-2-FIGHT + projectile-fan chaos |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-17-45.mp4` | 1920x1080 | 60.00 | 18.9 | h264 | 9.9 | 2026-07-11 12:17:45 | [sheet](clip-sheets/host_Replay_2026-07-11_12-17-45.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-17-25.mp4` | 1920x1080 | 60.00 | 19.2 | h264 | 18.7 | 2026-07-11 12:17:25 | [sheet](clip-sheets/host_Replay_2026-07-11_12-17-25.jpg) — TOP PICK: heavy multi-projectile duel vs purple player/bot |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-17-05.mp4` | 1920x1080 | 60.00 | 12.3 | h264 | 11.6 | 2026-07-11 12:17:05 | [sheet](clip-sheets/host_Replay_2026-07-11_12-17-05.jpg) — death sequence ending in "TO YOU" attribution |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-16-51.mp4` | 1920x1080 | 60.00 | 14.9 | h264 | 7.9 | 2026-07-11 12:16:51 | [sheet](clip-sheets/host_Replay_2026-07-11_12-16-51.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-16-35.mp4` | 1920x1080 | 60.00 | 18.8 | h264 | 10.4 | 2026-07-11 12:16:35 | [sheet](clip-sheets/host_Replay_2026-07-11_12-16-35.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-16-15.mp4` | 1920x1080 | 60.00 | 16.4 | h264 | 8.4 | 2026-07-11 12:16:15 | [sheet](clip-sheets/host_Replay_2026-07-11_12-16-15.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-15-57.mp4` | 1920x1080 | 60.00 | 20.9 | h264 | 11.2 | 2026-07-11 12:15:57 | [sheet](clip-sheets/host_Replay_2026-07-11_12-15-57.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-15-26.mp4` | 1920x1080 | 60.00 | 22.0 | h264 | 12.4 | 2026-07-11 12:15:26 | [sheet](clip-sheets/host_Replay_2026-07-11_12-15-26.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-15-03.mp4` | 1920x1080 | 60.00 | 21.2 | h264 | 9.1 | 2026-07-11 12:15:03 | [sheet](clip-sheets/host_Replay_2026-07-11_12-15-03.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-14-38.mp4` | 1920x1080 | 60.00 | 18.0 | h264 | 9.7 | 2026-07-11 12:14:38 | [sheet](clip-sheets/host_Replay_2026-07-11_12-14-38.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-14-20.mp4` | 1920x1080 | 60.00 | 22.0 | h264 | 12.4 | 2026-07-11 12:14:20 | [sheet](clip-sheets/host_Replay_2026-07-11_12-14-20.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-13-57.mp4` | 1920x1080 | 60.00 | 15.3 | h264 | 9.0 | 2026-07-11 12:13:57 | [sheet](clip-sheets/host_Replay_2026-07-11_12-13-57.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-13-41.mp4` | 1920x1080 | 60.00 | 13.0 | h264 | 9.8 | 2026-07-11 12:13:41 | [sheet](clip-sheets/host_Replay_2026-07-11_12-13-41.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-13-26.mp4` | 1920x1080 | 60.00 | 20.2 | h264 | 3.8 | 2026-07-11 12:13:26 | [sheet](clip-sheets/host_Replay_2026-07-11_12-13-26.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-12-58.mp4` | 1920x1080 | 60.00 | 14.1 | h264 | 9.7 | 2026-07-11 12:12:58 | [sheet](clip-sheets/host_Replay_2026-07-11_12-12-58.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-12-42.mp4` | 1920x1080 | 60.00 | 20.2 | h264 | 13.3 | 2026-07-11 12:12:42 | [sheet](clip-sheets/host_Replay_2026-07-11_12-12-42.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-12-19.mp4` | 1920x1080 | 60.00 | 21.0 | h264 | 11.3 | 2026-07-11 12:12:19 | [sheet](clip-sheets/host_Replay_2026-07-11_12-12-19.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-11-57.mp4` | 1920x1080 | 60.00 | 19.2 | h264 | 16.0 | 2026-07-11 12:11:57 | [sheet](clip-sheets/host_Replay_2026-07-11_12-11-57.jpg) — ELIMINATED 15 death card + respawn countdown + orb fights |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-11-37.mp4` | 1920x1080 | 60.00 | 12.8 | h264 | 10.3 | 2026-07-11 12:11:37 | [sheet](clip-sheets/host_Replay_2026-07-11_12-11-37.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-11-24.mp4` | 1920x1080 | 60.00 | 15.9 | h264 | 10.4 | 2026-07-11 12:11:24 | [sheet](clip-sheets/host_Replay_2026-07-11_12-11-24.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-11-06.mp4` | 1920x1080 | 60.00 | 16.2 | h264 | 9.0 | 2026-07-11 12:11:06 | [sheet](clip-sheets/host_Replay_2026-07-11_12-11-06.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-10-49.mp4` | 1920x1080 | 60.00 | 20.7 | h264 | 12.3 | 2026-07-11 12:10:49 | [sheet](clip-sheets/host_Replay_2026-07-11_12-10-49.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-10-24.mp4` | 1920x1080 | 60.00 | 21.4 | h264 | 14.3 | 2026-07-11 12:10:24 | [sheet](clip-sheets/host_Replay_2026-07-11_12-10-24.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_12-10-02.mp4` | 1920x1080 | 60.00 | 21.6 | h264 | 9.9 | 2026-07-11 12:10:02 | [sheet](clip-sheets/host_Replay_2026-07-11_12-10-02.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-30-27.mp4` | 1920x1080 | 60.00 | 21.7 | h264 | 3.0 | 2026-07-11 11:30:27 | [sheet](clip-sheets/host_Replay_2026-07-11_11-30-27.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-29-59.mp4` | 1920x1080 | 60.00 | 21.1 | h264 | 3.1 | 2026-07-11 11:29:59 | [sheet](clip-sheets/host_Replay_2026-07-11_11-29-59.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-29-26.mp4` | 1920x1080 | 60.00 | 20.7 | h264 | 3.1 | 2026-07-11 11:29:26 | [sheet](clip-sheets/host_Replay_2026-07-11_11-29-26.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-29-02.mp4` | 1920x1080 | 60.00 | 21.9 | h264 | 3.2 | 2026-07-11 11:29:02 | [sheet](clip-sheets/host_Replay_2026-07-11_11-29-02.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-28-35.mp4` | 1920x1080 | 60.00 | 21.2 | h264 | 3.3 | 2026-07-11 11:28:35 | [sheet](clip-sheets/host_Replay_2026-07-11_11-28-35.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-24-29.mp4` | 1920x1080 | 60.00 | 21.7 | h264 | 0.2 | 2026-07-11 11:24:29 | [sheet](clip-sheets/host_Replay_2026-07-11_11-24-29.jpg) — NOT GAMEPLAY: lock-screen capture |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-24-07.mp4` | 1920x1080 | 60.00 | 21.1 | h264 | 0.2 | 2026-07-11 11:24:07 | [sheet](clip-sheets/host_Replay_2026-07-11_11-24-07.jpg) — NOT GAMEPLAY: lock-screen capture |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-23-35.mp4` | 1920x1080 | 60.00 | 21.6 | h264 | 0.2 | 2026-07-11 11:23:35 | [sheet](clip-sheets/host_Replay_2026-07-11_11-23-35.jpg) — NOT GAMEPLAY: lock-screen ("Enter Password") capture |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-22-47.mp4` | 1920x1080 | 60.00 | 21.1 | h264 | 6.4 | 2026-07-11 11:22:47 | [sheet](clip-sheets/host_Replay_2026-07-11_11-22-47.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-22-13.mp4` | 1920x1080 | 60.00 | 21.6 | h264 | 2.5 | 2026-07-11 11:22:13 | [sheet](clip-sheets/host_Replay_2026-07-11_11-22-13.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-21-43.mp4` | 1920x1080 | 60.00 | 21.6 | h264 | 3.7 | 2026-07-11 11:21:43 | [sheet](clip-sheets/host_Replay_2026-07-11_11-21-43.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-21-16.mp4` | 1920x1080 | 60.00 | 20.5 | h264 | 8.1 | 2026-07-11 11:21:16 | [sheet](clip-sheets/host_Replay_2026-07-11_11-21-16.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-20-52.mp4` | 1920x1080 | 60.00 | 20.2 | h264 | 3.9 | 2026-07-11 11:20:52 | [sheet](clip-sheets/host_Replay_2026-07-11_11-20-52.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-19-28.mp4` | 1920x1080 | 60.00 | 20.2 | h264 | 3.0 | 2026-07-11 11:19:28 | [sheet](clip-sheets/host_Replay_2026-07-11_11-19-28.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-15-37.mp4` | 1920x1080 | 60.00 | 20.2 | h264 | 3.0 | 2026-07-11 11:15:37 | [sheet](clip-sheets/host_Replay_2026-07-11_11-15-37.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-14-56.mp4` | 1920x1080 | 60.00 | 20.8 | h264 | 3.1 | 2026-07-11 11:14:56 | [sheet](clip-sheets/host_Replay_2026-07-11_11-14-56.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-11-43.mp4` | 1920x1080 | 60.00 | 11.9 | h264 | 1.7 | 2026-07-11 11:11:43 | [sheet](clip-sheets/host_Replay_2026-07-11_11-11-43.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-11-31.mp4` | 1920x1080 | 60.00 | 9.7 | h264 | 1.4 | 2026-07-11 11:11:31 | [sheet](clip-sheets/host_Replay_2026-07-11_11-11-31.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-11-20.mp4` | 1920x1080 | 60.00 | 12.6 | h264 | 2.0 | 2026-07-11 11:11:20 | [sheet](clip-sheets/host_Replay_2026-07-11_11-11-20.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-11-06.mp4` | 1920x1080 | 60.00 | 20.5 | h264 | 3.0 | 2026-07-11 11:11:06 | [sheet](clip-sheets/host_Replay_2026-07-11_11-11-06.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-10-36.mp4` | 1920x1080 | 60.00 | 12.8 | h264 | 1.9 | 2026-07-11 11:10:36 | [sheet](clip-sheets/host_Replay_2026-07-11_11-10-36.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-10-22.mp4` | 1920x1080 | 60.00 | 13.0 | h264 | 1.9 | 2026-07-11 11:10:22 | [sheet](clip-sheets/host_Replay_2026-07-11_11-10-22.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-10-08.mp4` | 1920x1080 | 60.00 | 12.5 | h264 | 1.9 | 2026-07-11 11:10:08 | [sheet](clip-sheets/host_Replay_2026-07-11_11-10-08.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-09-53.mp4` | 1920x1080 | 60.00 | 20.0 | h264 | 3.0 | 2026-07-11 11:09:53 | [sheet](clip-sheets/host_Replay_2026-07-11_11-09-53.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-09-17.mp4` | 1920x1080 | 60.00 | 15.9 | h264 | 2.1 | 2026-07-11 11:09:17 | [sheet](clip-sheets/host_Replay_2026-07-11_11-09-17.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_11-08-59.mp4` | 1920x1080 | 60.00 | 20.0 | h264 | 2.9 | 2026-07-11 11:08:59 | [sheet](clip-sheets/host_Replay_2026-07-11_11-08-59.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-55-58.mp4` | 1920x1080 | 60.00 | 20.8 | h264 | 1.0 | 2026-07-11 10:55:58 | [sheet](clip-sheets/host_Replay_2026-07-11_10-55-58.jpg) — very low motion (likely idle) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-55-06.mp4` | 1920x1080 | 60.00 | 21.5 | h264 | 3.2 | 2026-07-11 10:55:06 | [sheet](clip-sheets/host_Replay_2026-07-11_10-55-06.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-54-41.mp4` | 1920x1080 | 60.00 | 21.9 | h264 | 3.2 | 2026-07-11 10:54:41 | [sheet](clip-sheets/host_Replay_2026-07-11_10-54-41.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-53-55.mp4` | 1920x1080 | 60.00 | 20.7 | h264 | 3.2 | 2026-07-11 10:53:55 | [sheet](clip-sheets/host_Replay_2026-07-11_10-53-55.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-52-28.mp4` | 1920x1080 | 60.00 | 21.1 | h264 | 1.2 | 2026-07-11 10:52:28 | [sheet](clip-sheets/host_Replay_2026-07-11_10-52-28.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-52-02.mp4` | 1920x1080 | 60.00 | 21.7 | h264 | 1.2 | 2026-07-11 10:52:02 | [sheet](clip-sheets/host_Replay_2026-07-11_10-52-02.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-51-40.mp4` | 1920x1080 | 60.00 | 17.7 | h264 | 1.0 | 2026-07-11 10:51:40 | [sheet](clip-sheets/host_Replay_2026-07-11_10-51-40.jpg) — very low motion (likely idle) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-51-21.mp4` | 1920x1080 | 60.00 | 14.2 | h264 | 0.9 | 2026-07-11 10:51:21 | [sheet](clip-sheets/host_Replay_2026-07-11_10-51-21.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-51-06.mp4` | 1920x1080 | 60.00 | 13.7 | h264 | 0.8 | 2026-07-11 10:51:06 | [sheet](clip-sheets/host_Replay_2026-07-11_10-51-06.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-50-51.mp4` | 1920x1080 | 60.00 | 20.3 | h264 | 1.2 | 2026-07-11 10:50:51 | [sheet](clip-sheets/host_Replay_2026-07-11_10-50-51.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-50-31.mp4` | 1920x1080 | 60.00 | 21.8 | h264 | 1.2 | 2026-07-11 10:50:31 | [sheet](clip-sheets/host_Replay_2026-07-11_10-50-31.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-49-54.mp4` | 1920x1080 | 60.00 | 20.9 | h264 | 1.8 | 2026-07-11 10:49:54 | [sheet](clip-sheets/host_Replay_2026-07-11_10-49-54.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-49-32.mp4` | 1920x1080 | 60.00 | 21.1 | h264 | 1.8 | 2026-07-11 10:49:32 | [sheet](clip-sheets/host_Replay_2026-07-11_10-49-32.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-48-28.mp4` | 1920x1080 | 60.00 | 19.6 | h264 | 1.6 | 2026-07-11 10:48:28 | [sheet](clip-sheets/host_Replay_2026-07-11_10-48-28.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-48-08.mp4` | 1920x1080 | 60.00 | 15.7 | h264 | 1.3 | 2026-07-11 10:48:08 | [sheet](clip-sheets/host_Replay_2026-07-11_10-48-08.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-47-52.mp4` | 1920x1080 | 60.00 | 21.5 | h264 | 1.8 | 2026-07-11 10:47:52 | [sheet](clip-sheets/host_Replay_2026-07-11_10-47-52.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-46-50.mp4` | 1920x1080 | 60.00 | 11.8 | h264 | 1.0 | 2026-07-11 10:46:50 | [sheet](clip-sheets/host_Replay_2026-07-11_10-46-50.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-46-38.mp4` | 1920x1080 | 60.00 | 21.4 | h264 | 1.9 | 2026-07-11 10:46:38 | [sheet](clip-sheets/host_Replay_2026-07-11_10-46-38.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-42-05.mp4` | 1920x1080 | 60.00 | 20.5 | h264 | 13.8 | 2026-07-11 10:42:05 | [sheet](clip-sheets/host_Replay_2026-07-11_10-42-05.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-41-43.mp4` | 1920x1080 | 60.00 | 20.6 | h264 | 13.1 | 2026-07-11 10:41:43 | [sheet](clip-sheets/host_Replay_2026-07-11_10-41-43.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-41-21.mp4` | 1920x1080 | 60.00 | 20.3 | h264 | 9.7 | 2026-07-11 10:41:21 | [sheet](clip-sheets/host_Replay_2026-07-11_10-41-21.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-40-59.mp4` | 1920x1080 | 60.00 | 13.0 | h264 | 8.0 | 2026-07-11 10:40:59 | [sheet](clip-sheets/host_Replay_2026-07-11_10-40-59.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-40-45.mp4` | 1920x1080 | 60.00 | 10.3 | h264 | 6.9 | 2026-07-11 10:40:45 | [sheet](clip-sheets/host_Replay_2026-07-11_10-40-45.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-40-34.mp4` | 1920x1080 | 60.00 | 21.5 | h264 | 11.7 | 2026-07-11 10:40:34 | [sheet](clip-sheets/host_Replay_2026-07-11_10-40-34.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-40-11.mp4` | 1920x1080 | 60.00 | 14.2 | h264 | 8.3 | 2026-07-11 10:40:11 | [sheet](clip-sheets/host_Replay_2026-07-11_10-40-11.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-39-54.mp4` | 1920x1080 | 60.00 | 20.1 | h264 | 9.3 | 2026-07-11 10:39:54 | [sheet](clip-sheets/host_Replay_2026-07-11_10-39-54.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-39-30.mp4` | 1920x1080 | 60.00 | 11.4 | h264 | 6.0 | 2026-07-11 10:39:30 | [sheet](clip-sheets/host_Replay_2026-07-11_10-39-30.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-39-18.mp4` | 1920x1080 | 60.00 | 21.3 | h264 | 9.8 | 2026-07-11 10:39:18 | [sheet](clip-sheets/host_Replay_2026-07-11_10-39-18.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-38-43.mp4` | 1920x1080 | 60.00 | 12.5 | h264 | 9.6 | 2026-07-11 10:38:43 | [sheet](clip-sheets/host_Replay_2026-07-11_10-38-43.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-38-28.mp4` | 1920x1080 | 60.00 | 12.0 | h264 | 7.9 | 2026-07-11 10:38:28 | [sheet](clip-sheets/host_Replay_2026-07-11_10-38-28.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-38-16.mp4` | 1920x1080 | 60.00 | 19.4 | h264 | 10.7 | 2026-07-11 10:38:16 | [sheet](clip-sheets/host_Replay_2026-07-11_10-38-16.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-37-56.mp4` | 1920x1080 | 60.00 | 19.6 | h264 | 12.6 | 2026-07-11 10:37:56 | [sheet](clip-sheets/host_Replay_2026-07-11_10-37-56.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-37-36.mp4` | 1920x1080 | 60.00 | 21.5 | h264 | 11.5 | 2026-07-11 10:37:36 | [sheet](clip-sheets/host_Replay_2026-07-11_10-37-36.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-37-00.mp4` | 1920x1080 | 60.00 | 20.1 | h264 | 7.5 | 2026-07-11 10:37:00 | [sheet](clip-sheets/host_Replay_2026-07-11_10-37-00.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-36-35.mp4` | 1920x1080 | 60.00 | 21.0 | h264 | 9.2 | 2026-07-11 10:36:35 | [sheet](clip-sheets/host_Replay_2026-07-11_10-36-35.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-36-08.mp4` | 1920x1080 | 60.00 | 22.0 | h264 | 11.1 | 2026-07-11 10:36:08 | [sheet](clip-sheets/host_Replay_2026-07-11_10-36-08.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-35-41.mp4` | 1920x1080 | 60.00 | 17.2 | h264 | 10.7 | 2026-07-11 10:35:41 | [sheet](clip-sheets/host_Replay_2026-07-11_10-35-41.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-35-24.mp4` | 1920x1080 | 60.00 | 11.9 | h264 | 8.3 | 2026-07-11 10:35:24 | [sheet](clip-sheets/host_Replay_2026-07-11_10-35-24.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-35-12.mp4` | 1920x1080 | 60.00 | 15.7 | h264 | 9.2 | 2026-07-11 10:35:12 | [sheet](clip-sheets/host_Replay_2026-07-11_10-35-12.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-34-55.mp4` | 1920x1080 | 60.00 | 21.3 | h264 | 12.6 | 2026-07-11 10:34:55 | [sheet](clip-sheets/host_Replay_2026-07-11_10-34-55.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-34-32.mp4` | 1920x1080 | 60.00 | 21.6 | h264 | 12.2 | 2026-07-11 10:34:32 | [sheet](clip-sheets/host_Replay_2026-07-11_10-34-32.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-34-09.mp4` | 1920x1080 | 60.00 | 20.8 | h264 | 13.8 | 2026-07-11 10:34:09 | [sheet](clip-sheets/host_Replay_2026-07-11_10-34-09.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-33-45.mp4` | 1920x1080 | 60.00 | 21.1 | h264 | 11.1 | 2026-07-11 10:33:45 | [sheet](clip-sheets/host_Replay_2026-07-11_10-33-45.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-33-21.mp4` | 1920x1080 | 60.00 | 12.9 | h264 | 12.2 | 2026-07-11 10:33:21 | [sheet](clip-sheets/host_Replay_2026-07-11_10-33-21.jpg) — 3-2-FIGHT round start + projectile trades |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-33-07.mp4` | 1920x1080 | 60.00 | 20.4 | h264 | 7.0 | 2026-07-11 10:33:07 | [sheet](clip-sheets/host_Replay_2026-07-11_10-33-07.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-32-36.mp4` | 1920x1080 | 60.00 | 20.2 | h264 | 7.8 | 2026-07-11 10:32:36 | [sheet](clip-sheets/host_Replay_2026-07-11_10-32-36.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-31-59.mp4` | 1920x1080 | 60.00 | 20.3 | h264 | 12.6 | 2026-07-11 10:31:59 | [sheet](clip-sheets/host_Replay_2026-07-11_10-31-59.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-31-34.mp4` | 1920x1080 | 60.00 | 21.6 | h264 | 12.1 | 2026-07-11 10:31:34 | [sheet](clip-sheets/host_Replay_2026-07-11_10-31-34.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-21-17.mp4` | 1920x1080 | 60.00 | 11.5 | h264 | 1.0 | 2026-07-11 10:21:17 | [sheet](clip-sheets/host_Replay_2026-07-11_10-21-17.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-21-06.mp4` | 1920x1080 | 60.00 | 21.6 | h264 | 4.0 | 2026-07-11 10:21:06 | [sheet](clip-sheets/host_Replay_2026-07-11_10-21-06.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-20-30.mp4` | 1920x1080 | 60.00 | 20.2 | h264 | 6.6 | 2026-07-11 10:20:30 | [sheet](clip-sheets/host_Replay_2026-07-11_10-20-30.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-19-59.mp4` | 1920x1080 | 60.00 | 17.3 | h264 | 2.1 | 2026-07-11 10:19:59 | [sheet](clip-sheets/host_Replay_2026-07-11_10-19-59.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-19-40.mp4` | 1920x1080 | 60.00 | 20.2 | h264 | 2.5 | 2026-07-11 10:19:40 | [sheet](clip-sheets/host_Replay_2026-07-11_10-19-40.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-19-13.mp4` | 1920x1080 | 60.00 | 21.1 | h264 | 2.4 | 2026-07-11 10:19:13 | [sheet](clip-sheets/host_Replay_2026-07-11_10-19-13.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-18-39.mp4` | 1920x1080 | 60.00 | 20.7 | h264 | 2.5 | 2026-07-11 10:18:39 | [sheet](clip-sheets/host_Replay_2026-07-11_10-18-39.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-17-57.mp4` | 1920x1080 | 60.00 | 20.6 | h264 | 2.6 | 2026-07-11 10:17:57 | [sheet](clip-sheets/host_Replay_2026-07-11_10-17-57.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-17-05.mp4` | 1920x1080 | 60.00 | 19.2 | h264 | 1.4 | 2026-07-11 10:17:05 | [sheet](clip-sheets/host_Replay_2026-07-11_10-17-05.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-16-45.mp4` | 1920x1080 | 60.00 | 16.7 | h264 | 2.8 | 2026-07-11 10:16:45 | [sheet](clip-sheets/host_Replay_2026-07-11_10-16-45.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-16-27.mp4` | 1920x1080 | 60.00 | 21.5 | h264 | 2.5 | 2026-07-11 10:16:27 | [sheet](clip-sheets/host_Replay_2026-07-11_10-16-27.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-15-57.mp4` | 1920x1080 | 60.00 | 21.4 | h264 | 2.4 | 2026-07-11 10:15:57 | [sheet](clip-sheets/host_Replay_2026-07-11_10-15-57.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-15-29.mp4` | 1920x1080 | 60.00 | 20.8 | h264 | 2.5 | 2026-07-11 10:15:29 | [sheet](clip-sheets/host_Replay_2026-07-11_10-15-29.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-14-52.mp4` | 1920x1080 | 60.00 | 20.0 | h264 | 2.4 | 2026-07-11 10:14:52 | [sheet](clip-sheets/host_Replay_2026-07-11_10-14-52.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-06-02.mp4` | 1920x1080 | 60.00 | 21.8 | h264 | 2.8 | 2026-07-11 10:06:02 | [sheet](clip-sheets/host_Replay_2026-07-11_10-06-02.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-05-39.mp4` | 1920x1080 | 60.00 | 15.5 | h264 | 2.0 | 2026-07-11 10:05:39 | [sheet](clip-sheets/host_Replay_2026-07-11_10-05-39.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-05-23.mp4` | 1920x1080 | 60.00 | 21.6 | h264 | 2.8 | 2026-07-11 10:05:23 | [sheet](clip-sheets/host_Replay_2026-07-11_10-05-23.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-01-57.mp4` | 1920x1080 | 60.00 | 21.3 | h264 | 1.3 | 2026-07-11 10:01:57 | [sheet](clip-sheets/host_Replay_2026-07-11_10-01-57.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_10-00-16.mp4` | 1920x1080 | 60.00 | 20.1 | h264 | 2.9 | 2026-07-11 10:00:16 | [sheet](clip-sheets/host_Replay_2026-07-11_10-00-16.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-55-26.mp4` | 1920x1080 | 60.00 | 20.5 | h264 | 1.6 | 2026-07-11 09:55:26 | [sheet](clip-sheets/host_Replay_2026-07-11_09-55-26.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-54-45.mp4` | 1920x1080 | 60.00 | 17.2 | h264 | 2.4 | 2026-07-11 09:54:45 | [sheet](clip-sheets/host_Replay_2026-07-11_09-54-45.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-54-28.mp4` | 1920x1080 | 60.00 | 15.8 | h264 | 2.1 | 2026-07-11 09:54:28 | [sheet](clip-sheets/host_Replay_2026-07-11_09-54-28.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-54-11.mp4` | 1920x1080 | 60.00 | 19.2 | h264 | 2.6 | 2026-07-11 09:54:11 | [sheet](clip-sheets/host_Replay_2026-07-11_09-54-11.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-53-52.mp4` | 1920x1080 | 60.00 | 21.8 | h264 | 2.9 | 2026-07-11 09:53:52 | [sheet](clip-sheets/host_Replay_2026-07-11_09-53-52.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-53-28.mp4` | 1920x1080 | 60.00 | 16.1 | h264 | 2.5 | 2026-07-11 09:53:28 | [sheet](clip-sheets/host_Replay_2026-07-11_09-53-28.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-53-11.mp4` | 1920x1080 | 60.00 | 17.5 | h264 | 2.4 | 2026-07-11 09:53:11 | [sheet](clip-sheets/host_Replay_2026-07-11_09-53-11.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-52-53.mp4` | 1920x1080 | 60.00 | 13.4 | h264 | 2.0 | 2026-07-11 09:52:53 | [sheet](clip-sheets/host_Replay_2026-07-11_09-52-53.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-52-38.mp4` | 1920x1080 | 60.00 | 20.4 | h264 | 3.2 | 2026-07-11 09:52:38 | [sheet](clip-sheets/host_Replay_2026-07-11_09-52-38.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-51-13.mp4` | 1920x1080 | 60.00 | 11.2 | h264 | 1.7 | 2026-07-11 09:51:13 | [sheet](clip-sheets/host_Replay_2026-07-11_09-51-13.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-51-00.mp4` | 1920x1080 | 60.00 | 18.4 | h264 | 2.7 | 2026-07-11 09:51:00 | [sheet](clip-sheets/host_Replay_2026-07-11_09-51-00.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-50-42.mp4` | 1920x1080 | 60.00 | 21.8 | h264 | 2.9 | 2026-07-11 09:50:42 | [sheet](clip-sheets/host_Replay_2026-07-11_09-50-42.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-49-39.mp4` | 1920x1080 | 60.00 | 20.7 | h264 | 4.0 | 2026-07-11 09:49:39 | [sheet](clip-sheets/host_Replay_2026-07-11_09-49-39.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-49-14.mp4` | 1920x1080 | 60.00 | 21.7 | h264 | 2.9 | 2026-07-11 09:49:14 | [sheet](clip-sheets/host_Replay_2026-07-11_09-49-14.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-32-53.mp4` | 1920x1080 | 60.00 | 21.4 | h264 | 4.1 | 2026-07-11 09:32:53 | [sheet](clip-sheets/host_Replay_2026-07-11_09-32-53.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-28-21.mp4` | 1920x1080 | 60.00 | 17.2 | h264 | 2.7 | 2026-07-11 09:28:21 | [sheet](clip-sheets/host_Replay_2026-07-11_09-28-21.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-28-03.mp4` | 1920x1080 | 60.00 | 20.7 | h264 | 3.2 | 2026-07-11 09:28:03 | [sheet](clip-sheets/host_Replay_2026-07-11_09-28-03.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-26-07.mp4` | 1920x1080 | 60.00 | 20.9 | h264 | 3.3 | 2026-07-11 09:26:07 | [sheet](clip-sheets/host_Replay_2026-07-11_09-26-07.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-25-45.mp4` | 1920x1080 | 60.00 | 20.8 | h264 | 3.2 | 2026-07-11 09:25:45 | [sheet](clip-sheets/host_Replay_2026-07-11_09-25-45.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-22-40.mp4` | 1920x1080 | 60.00 | 20.4 | h264 | 3.3 | 2026-07-11 09:22:40 | [sheet](clip-sheets/host_Replay_2026-07-11_09-22-40.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips-host/Replay_2026-07-11_09-21-09.mp4` | 1920x1080 | 60.00 | 21.3 | h264 | 3.9 | 2026-07-11 09:21:09 | [sheet](clip-sheets/host_Replay_2026-07-11_09-21-09.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/02bb89e6-bdcf-41f1-8eb6-8f806a17245e.mp4` | 1920x938 | 30.00 | 20.0 | h264 | 13.3 | 2026-07-11 08:49:46 | [sheet](clip-sheets/clip_02bb89e6-bdcf-41f1-8eb6-8f806a17245e.jpg) — KEPT (dup in kept/); solo BOT-PISTON wandering, clean capture |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/065c267e-0be2-4b9e-b18d-f25173a70107.mp4` | 1920x938 | 30.00 | 20.0 | h264 | 14.3 | 2026-07-11 08:31:45 | [sheet](clip-sheets/clip_065c267e-0be2-4b9e-b18d-f25173a70107.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/4facc5b6-a8f9-4950-b1fd-bc7014eaa909.mp4` | 1920x938 | 30.00 | 20.0 | h264 | 7.1 | 2026-07-10 22:37:56 | [sheet](clip-sheets/kept_4facc5b6-a8f9-4950-b1fd-bc7014eaa909.jpg) — KEPT by Jake; empty-arena wide vista, lone player walking |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/5a8beb3c-d7b2-463a-8c2b-b87cbed458aa.mp4` | 1920x938 | 30.00 | 20.0 | h264 | 7.2 | 2026-07-10 22:35:41 | [sheet](clip-sheets/clip_5a8beb3c-d7b2-463a-8c2b-b87cbed458aa.jpg) |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/c144f036-6915-40bb-9232-84cc5ed0c5b4.mp4` | 1920x938 | 30.00 | 20.0 | h264 | 10.7 | 2026-07-10 22:25:15 | [sheet](clip-sheets/kept_c144f036-6915-40bb-9232-84cc5ed0c5b4.jpg) — KEPT by Jake; two players calm traversal, clean canvas capture |
| `/home/jimothy/Videos/JAKESJAM/2026-07-10 16-37-21.mkv` | 1920x1080 | 60.00 | 1.7 | h264 | 1.5 | 2026-07-10 16:37:24 | [sheet](clip-sheets/obs_2026-07-10_16-37-21.jpg) |

**Totals (a, unique files): 188 clips — 57.4 min — 1.35 GB.**

### (a-dup) Big-res duplicates (excluded from totals: 18 files, 0.19 GB)

| File | Res | fps | Dur (s) | Codec | Size (MB) | Modified | Sheet / Notes |
|---|---|---|---|---|---|---|---|
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/399b3262-818c-4acb-abb1-38554db837ef.mp4` | 1920x1080 | 60.00 | 21.4 | h264 | 2.5 | 2026-07-11 12:54:45 | [sheet](clip-sheets/clip_399b3262-818c-4acb-abb1-38554db837ef.jpg) — DUPLICATE: byte-identical to .clips-host/Replay_2026-07-11_12-54-44.mp4 |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/62af791e-06c9-4c18-bd9c-35f25b10390b.mp4` | 1920x1080 | 60.00 | 21.7 | h264 | 3.2 | 2026-07-11 12:51:13 | [sheet](clip-sheets/clip_62af791e-06c9-4c18-bd9c-35f25b10390b.jpg) — DUPLICATE: byte-identical to .clips-host/Replay_2026-07-11_12-51-12.mp4 |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/988985b1-dcc1-46ce-9621-555aa0009a58.mp4` | 1920x1080 | 60.00 | 21.9 | h264 | 10.3 | 2026-07-11 12:33:23 | [sheet](clip-sheets/clip_988985b1-dcc1-46ce-9621-555aa0009a58.jpg) — DUPLICATE: byte-identical to .clips-host/Replay_2026-07-11_12-33-22.mp4 |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/ae6150b3-1fe6-4a67-b589-3f6eba11909d.mp4` | 1920x1080 | 60.00 | 21.4 | h264 | 12.9 | 2026-07-11 12:32:56 | [sheet](clip-sheets/clip_ae6150b3-1fe6-4a67-b589-3f6eba11909d.jpg) — DUPLICATE: byte-identical to .clips-host/Replay_2026-07-11_12-32-56.mp4 |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/0bbc162d-d14a-490b-8109-0a3bd19952ed.mp4` | 1920x1080 | 60.00 | 20.9 | h264 | 12.9 | 2026-07-11 12:32:24 | [sheet](clip-sheets/clip_0bbc162d-d14a-490b-8109-0a3bd19952ed.jpg) — DUPLICATE: byte-identical to .clips-host/Replay_2026-07-11_12-32-23.mp4 |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/48dabe74-f080-4977-aea7-1520443e71d4.mp4` | 1920x1080 | 60.00 | 21.2 | h264 | 9.4 | 2026-07-11 12:31:58 | [sheet](clip-sheets/clip_48dabe74-f080-4977-aea7-1520443e71d4.jpg) — DUPLICATE: byte-identical to .clips-host/Replay_2026-07-11_12-31-58.mp4 |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/0694bcca-c00d-46b2-9da9-8d349548d17b.mp4` | 1920x1080 | 60.00 | 9.5 | h264 | 6.3 | 2026-07-11 12:31:33 | [sheet](clip-sheets/clip_0694bcca-c00d-46b2-9da9-8d349548d17b.jpg) — DUPLICATE: byte-identical to .clips-host/Replay_2026-07-11_12-31-32.mp4 |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/c5fe3963-e7a6-4279-94da-a815ba59604f.mp4` | 1920x1080 | 60.00 | 20.6 | h264 | 16.8 | 2026-07-11 12:31:22 | [sheet](clip-sheets/clip_c5fe3963-e7a6-4279-94da-a815ba59604f.jpg) — DUPLICATE: byte-identical to .clips-host/Replay_2026-07-11_12-31-21.mp4 |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/74dcaf10-a015-4bca-a89f-85134bbb6507.mp4` | 1920x1080 | 60.00 | 13.1 | h264 | 9.7 | 2026-07-11 12:30:58 | [sheet](clip-sheets/clip_74dcaf10-a015-4bca-a89f-85134bbb6507.jpg) — DUPLICATE: byte-identical to .clips-host/Replay_2026-07-11_12-30-57.mp4 |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/ce63a172-87a5-4ffe-845f-ce239200001c.mp4` | 1920x1080 | 60.00 | 21.5 | h264 | 11.5 | 2026-07-11 12:30:45 | [sheet](clip-sheets/clip_ce63a172-87a5-4ffe-845f-ce239200001c.jpg) — DUPLICATE: byte-identical to .clips-host/Replay_2026-07-11_12-30-44.mp4 |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/7584b6e6-c103-4bb6-bb58-5a1790cc535a.mp4` | 1920x1080 | 60.00 | 18.7 | h264 | 9.6 | 2026-07-11 12:30:22 | [sheet](clip-sheets/clip_7584b6e6-c103-4bb6-bb58-5a1790cc535a.jpg) — DUPLICATE: byte-identical to .clips-host/Replay_2026-07-11_12-30-21.mp4 |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/1e3b7f6f-f28f-4766-94df-d1a38116ac0b.mp4` | 1920x1080 | 60.00 | 21.1 | h264 | 8.3 | 2026-07-11 12:30:02 | [sheet](clip-sheets/clip_1e3b7f6f-f28f-4766-94df-d1a38116ac0b.jpg) — DUPLICATE: byte-identical to .clips-host/Replay_2026-07-11_12-30-02.mp4 |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/5e2ee2e2-8ff7-4446-8dfc-d1e0b332f982.mp4` | 1920x1080 | 60.00 | 17.2 | h264 | 10.2 | 2026-07-11 12:27:48 | [sheet](clip-sheets/clip_5e2ee2e2-8ff7-4446-8dfc-d1e0b332f982.jpg) — DUPLICATE: byte-identical to .clips-host/Replay_2026-07-11_12-27-48.mp4 |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/8f13a0d8-56ca-4f74-94f8-b563aa67ae8c.mp4` | 1920x1080 | 60.00 | 18.8 | h264 | 13.4 | 2026-07-11 12:27:30 | [sheet](clip-sheets/clip_8f13a0d8-56ca-4f74-94f8-b563aa67ae8c.jpg) — DUPLICATE: byte-identical to .clips-host/Replay_2026-07-11_12-27-29.mp4 |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/02bb89e6-bdcf-41f1-8eb6-8f806a17245e.mp4` | 1920x938 | 30.00 | 20.0 | h264 | 13.3 | 2026-07-11 08:56:56 | DUPLICATE: byte-identical to ../02bb89e6-bdcf-41f1-8eb6-8f806a17245e.mp4 |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/065c267e-0be2-4b9e-b18d-f25173a70107.mp4` | 1920x938 | 30.00 | 20.0 | h264 | 14.3 | 2026-07-11 08:43:54 | DUPLICATE: byte-identical to ../065c267e-0be2-4b9e-b18d-f25173a70107.mp4 |
| `/home/jimothy/Downloads/4facc5b6-a8f9-4950-b1fd-bc7014eaa909.mp4` | 1920x938 | 30.00 | 20.0 | h264 | 7.1 | 2026-07-11 08:26:35 | DUPLICATE: byte-identical to server/.clips/kept/4facc5b6....mp4 |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/5a8beb3c-d7b2-463a-8c2b-b87cbed458aa.mp4` | 1920x938 | 30.00 | 20.0 | h264 | 7.2 | 2026-07-10 22:37:56 | DUPLICATE: byte-identical to ../5a8beb3c-d7b2-463a-8c2b-b87cbed458aa.mp4 |

## (b) Lower-res gameplay

Includes the two OBS test recordings, two small-canvas server clips, and all Playwright-recorded footage (`.combat-probe` / `.match-probe` = automated bot-fight probe sessions, 720p; `tests/e2e` = short smoke-test captures, 800x450).

| File | Res | fps | Dur (s) | Codec | Size (MB) | Modified | Sheet / Notes |
|---|---|---|---|---|---|---|---|
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/5981c3ff-b017-4401-8c18-92b48169c004.mp4` | 960x540 | 23.41 | 10.0 | h264 | 8.5 | 2026-07-11 12:27:33 |  |
| `/home/jimothy/Videos/JAKESJAM/2026-07-10 15-03-13.mkv` | 1280x720 | 60.00 | 27.1 | h264 | 18.2 | 2026-07-10 15:03:41 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/837b0742-9faa-4fb2-bd1b-653e504b40cb.mp4` | 1280x640 | 57.16 | 10.0 | h264 | 3.0 | 2026-07-10 09:07:52 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.artifacts/smoke-wasm-sim-is-actually-running-in-production-chromium/video.webm` | 800x450 | 25.00 | 4.3 | vp8 | 0.1 | 2026-07-08 10:35:33 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.artifacts/smoke-Practice-match-no-slow-frame-log-spam-over-5s-chromium/video.webm` | 800x450 | 25.00 | 8.7 | vp8 | 0.2 | 2026-07-08 10:35:28 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.artifacts/smoke-Practice-match-canva-b06ba-ixels-hangingWood-theme-lo--chromium/video.webm` | 800x450 | 25.00 | 6.2 | vp8 | 0.2 | 2026-07-08 10:35:19 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.artifacts/smoke-splash-menu-loads-with-no-errors-chromium/video.webm` | 800x450 | 25.00 | 3.1 | vp8 | 0.1 | 2026-07-08 10:35:13 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.artifacts/gameplay-V1-—-input-driven-ec700--inputs-zero-console-errors-chromium/video.webm` | 800x450 | 25.00 | 65.4 | vp8 | 3.4 | 2026-07-08 10:35:10 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.artifacts/gameplay-V1-—-input-driven-d330b-duce-after-sustained-combat-chromium/video.webm` | 800x450 | 25.00 | 9.8 | vp8 | 0.3 | 2026-07-08 10:34:04 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.artifacts/gameplay-V1-—-input-driven-b3e8e-platform-produces-no-errors-chromium/video.webm` | 800x450 | 25.00 | 8.2 | vp8 | 0.3 | 2026-07-08 10:33:55 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.artifacts/gameplay-V1-—-input-driven-83294-on-long-walk-does-not-crash-chromium/video.webm` | 800x450 | 25.00 | 8.4 | vp8 | 0.2 | 2026-07-08 10:33:46 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.artifacts/gameplay-V1-—-input-driven-8e078-s-produce-projectile-pixels-chromium/video.webm` | 800x450 | 25.00 | 6.4 | vp8 | 0.2 | 2026-07-08 10:33:38 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.artifacts/gameplay-V1-—-input-driven-94e81--jetpack-W-lifts-the-player-chromium/video.webm` | 800x450 | 25.00 | 5.9 | vp8 | 0.2 | 2026-07-08 10:33:32 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.artifacts/gameplay-V1-—-input-driven-d54b6-hen-D-translates-the-player-chromium/video.webm` | 800x450 | 25.00 | 7.3 | vp8 | 0.2 | 2026-07-08 10:33:26 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.combat-probe/videos/page@7ffb59fe503d9651f0d4fd9da21bb757.webm` | 1280x720 | 25.00 | 12.7 | vp8 | 1.3 | 2026-07-03 14:24:31 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.report/data/f1f44fa0eb71c0952397dbeab95392cceae23dc3.webm` | 800x450 | 25.00 | 8.2 | vp8 | 0.3 | 2026-07-03 11:04:55 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.report/data/dab6cad64033e112f0265f33f9443e868226038c.webm` | 800x450 | 25.00 | 9.4 | vp8 | 0.7 | 2026-07-03 11:04:55 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.report/data/d8c0f21a976bbb622c41c878e9f71006f91b1a42.webm` | 800x450 | 25.00 | 8.8 | vp8 | 0.8 | 2026-07-03 11:04:55 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.report/data/d75f7c6122e39ba981c92de3422163eb485ffd38.webm` | 800x450 | 25.00 | 9.0 | vp8 | 0.2 | 2026-07-03 11:04:55 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.report/data/caeaa92745a676986fb86a7c780c1ca41355f604.webm` | 800x450 | 25.00 | 3.0 | vp8 | 0.1 | 2026-07-03 11:04:55 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.report/data/b4f9d56e50b9c4ccf2d0b148c74a7c4946847c6b.webm` | 800x450 | 25.00 | 10.0 | vp8 | 0.2 | 2026-07-03 11:04:55 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.report/data/afa2f75c63e1b401b8add604d70a56486059655e.webm` | 800x450 | 25.00 | 7.1 | vp8 | 0.6 | 2026-07-03 11:04:55 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.report/data/9d768aa305f292da8017f856409bd9abd44219db.webm` | 800x450 | 25.00 | 9.3 | vp8 | 0.4 | 2026-07-03 11:04:55 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.report/data/9378420b42cd2d0572eaeccdedc7d1bf5f9bea1d.webm` | 800x450 | 25.00 | 4.4 | vp8 | 0.1 | 2026-07-03 11:04:55 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.report/data/4339324e51ec4cc6bd64c58a400c69801f06d7a0.webm` | 800x450 | 25.00 | 7.6 | vp8 | 0.3 | 2026-07-03 11:04:55 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.report/data/413bc7a6997e88773600bf5e506623a220777fc8.webm` | 800x450 | 25.00 | 8.3 | vp8 | 0.6 | 2026-07-03 11:04:55 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.report/data/3e0b01b50bc23761ac588791ba33ed34b5fc98ec.webm` | 800x450 | 25.00 | 66.3 | vp8 | 6.9 | 2026-07-03 11:04:55 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/tests/e2e/.report/data/31d1f72dec7549454dc1f6b2e7306f963adebc96.webm` | 800x450 | 25.00 | 1.6 | vp8 | 0.1 | 2026-07-03 11:04:55 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.match-probe/videos/page@fe5b1eeae780a20d1c165fea4b5764d1.webm` | 1280x720 | 25.00 | 41.5 | vp8 | 3.5 | 2026-07-03 11:02:04 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.combat-probe/videos/page@a53f7de297ec67e5602b31ad965eacc7.webm` | 1280x720 | 25.00 | 13.0 | vp8 | 1.3 | 2026-07-03 11:00:41 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.match-probe/videos/page@78a572a243123718208a14a25589f7c2.webm` | 1280x720 | 25.00 | 116.8 | vp8 | 10.0 | 2026-07-03 10:06:52 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.match-probe/videos/page@649453c27efb1efabb3f79db7bbe72fd.webm` | 1280x720 | 25.00 | 305.1 | vp8 | 18.3 | 2026-07-03 10:00:37 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.combat-probe/videos/page@32a0cf938bbaaf9270bd29e60246b903.webm` | 1280x720 | 25.00 | 14.0 | vp8 | 1.5 | 2026-07-03 09:37:12 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.combat-probe/videos/page@bbd3e46cfadd35f74b2c0dfeb06965db.webm` | 1280x720 | 25.00 | 14.6 | vp8 | 1.4 | 2026-07-02 19:04:47 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.combat-probe/videos/page@7298587782fc2612fda3e8f9d3ce9ea8.webm` | 1280x720 | 25.00 | 167.2 | vp8 | 4.1 | 2026-07-02 19:00:35 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.combat-probe/videos/page@d9f590b09dca7afd9a74ace5e92fb498.webm` | 1280x720 | 25.00 | 282.5 | vp8 | 5.7 | 2026-07-02 18:55:29 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.combat-probe/videos/page@9314fdf697fadacd8f7304ccdd7602c4.webm` | 1280x720 | 25.00 | 128.7 | vp8 | 3.1 | 2026-07-02 18:48:26 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.combat-probe/videos/page@b97c7697c99e708a71bc7faea893b7f5.webm` | 1280x720 | 25.00 | 87.5 | vp8 | 2.3 | 2026-07-02 18:44:42 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.combat-probe/videos/page@539d477bb22c5fd9cf0d2aac90f31ba1.webm` | 1280x720 | 25.00 | 89.6 | vp8 | 5.7 | 2026-07-02 18:38:44 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.combat-probe/videos/page@2d6123044059282e3358380da675fdbf.webm` | 1280x720 | 25.00 | 91.5 | vp8 | 2.8 | 2026-07-02 18:38:44 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.combat-probe/videos/page@750a90d8f0ff9e60a456d288c7c96450.webm` | 1280x720 | 25.00 | 122.2 | vp8 | 3.5 | 2026-07-02 18:34:41 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.combat-probe/videos/page@6742afa6fd74e87a29d3ab1d39052111.webm` | 1280x720 | 25.00 | 120.9 | vp8 | 4.7 | 2026-07-02 18:34:41 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.combat-probe/videos/page@189e820c9361c23e9af9316827eef378.webm` | 1280x720 | 25.00 | 22.6 | vp8 | 1.6 | 2026-07-02 18:31:41 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.combat-probe/videos/page@b0a4b8827eb59a7ffef697ea05664e4b.webm` | 1280x720 | 25.00 | 25.4 | vp8 | 2.4 | 2026-07-02 18:31:40 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.combat-probe/videos/page@57a02e9fd1bfd0a0591d8d450a717ff8.webm` | 1280x720 | 25.00 | 60.1 | vp8 | 3.6 | 2026-07-02 18:28:34 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/.combat-probe/videos/page@0915fdc473900d810006f129267047e6.webm` | 1280x720 | 25.00 | 61.4 | vp8 | 2.5 | 2026-07-02 18:28:34 |  |

**Totals (b, unique): 46 clips — 35.2 min — 0.13 GB.** (+1 dup: kept/837b0742 = parent copy)

| File | Res | fps | Dur (s) | Codec | Size (MB) | Modified | Sheet / Notes |
|---|---|---|---|---|---|---|---|
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/837b0742-9faa-4fb2-bd1b-653e504b40cb.mp4` | 1280x640 | 57.16 | 10.0 | h264 | 3.0 | 2026-07-10 09:07:52 | DUPLICATE: byte-identical to ../837b0742-9faa-4fb2-bd1b-653e504b40cb.mp4 |

## (c) Vertical / 9:16 clips (720x1280, clean canvas captures)

| File | Res | fps | Dur (s) | Codec | Size (MB) | Modified | Sheet / Notes |
|---|---|---|---|---|---|---|---|
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/a306b1b9-c878-4456-90c3-aeb97df8a875.mp4` | 720x1280 | 60.00 | 21.4 | h264 | 1.7 | 2026-07-11 12:54:49 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/4872b9d7-7988-41b7-80b0-f8ac746962db.mp4` | 720x1280 | 60.00 | 21.7 | h264 | 2.7 | 2026-07-11 12:51:17 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/ba5ee74e-21c3-4165-9e93-ab93bbf89ef5.mp4` | 720x1280 | 30.00 | 12.0 | h264 | 5.9 | 2026-07-11 12:49:55 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/3a556f8e-f77e-45d2-a6f8-f70f12996491.mp4` | 720x1280 | 30.00 | 12.0 | h264 | 8.0 | 2026-07-11 12:43:54 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/1205ac2d-0bc8-453c-840a-6ef99d9edda8.mp4` | 720x1280 | 30.00 | 12.0 | h264 | 2.9 | 2026-07-11 12:37:52 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/0880beae-0082-462c-b2a1-e1a1f5b60eca.mp4` | 720x1280 | 60.00 | 21.9 | h264 | 17.1 | 2026-07-11 12:33:27 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/c1f5cbe6-c36c-4761-a420-b5aeae9de21e.mp4` | 720x1280 | 60.00 | 21.4 | h264 | 19.9 | 2026-07-11 12:33:01 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/26511969-7523-47a3-89c4-be8cc888dcc7.mp4` | 720x1280 | 60.00 | 20.9 | h264 | 20.3 | 2026-07-11 12:32:29 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/b1b230d9-cd51-4cc2-858d-467ac046e3c8.mp4` | 720x1280 | 60.00 | 21.1 | h264 | 16.5 | 2026-07-11 12:32:03 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/60405330-9e8f-4098-a985-12e975f4bfd4.mp4` | 720x1280 | 30.00 | 12.0 | h264 | 4.8 | 2026-07-11 12:31:58 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/cfbe86b2-2955-4e70-8952-72eab30d72e0.mp4` | 720x1280 | 60.00 | 9.5 | h264 | 8.4 | 2026-07-11 12:31:35 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/69e08d68-ebce-483a-93c7-fad151b682dd.mp4` | 720x1280 | 60.00 | 20.6 | h264 | 21.8 | 2026-07-11 12:31:26 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/24692ece-6672-4b2e-a85b-f21a3044bf3e.mp4` | 720x1280 | 60.00 | 13.1 | h264 | 11.5 | 2026-07-11 12:31:01 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/416a7f8b-5b13-4df6-bc6d-be6626f36077.mp4` | 720x1280 | 60.00 | 21.5 | h264 | 16.8 | 2026-07-11 12:30:49 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/af40e40b-d27a-4048-9b16-7c0b81817dd5.mp4` | 720x1280 | 60.00 | 18.7 | h264 | 15.2 | 2026-07-11 12:30:25 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/2276feb7-330b-4e9e-a8b2-87c989ba72db.mp4` | 720x1280 | 60.00 | 21.1 | h264 | 14.7 | 2026-07-11 12:30:06 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/f3f081e8-21bf-45ac-9e09-5cdbe7154e9a.mp4` | 720x1280 | 60.00 | 17.2 | h264 | 15.0 | 2026-07-11 12:27:51 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/4026d8be-e661-4e8b-b0d8-3b9bf94979d2.mp4` | 720x1280 | 60.00 | 18.9 | h264 | 20.9 | 2026-07-11 12:27:34 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/226b8901-015a-41de-a446-23d46467f564.mp4` | 720x1280 | 23.41 | 10.0 | h264 | 6.4 | 2026-07-11 12:27:34 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/5ca306b1-3a5a-4854-bc42-1b754a10a756.mp4` | 720x1280 | 60.00 | 20.2 | h264 | 22.5 | 2026-07-11 12:27:13 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/e0350ca7-0f05-4726-9f9d-79f6872e0cf2.mp4` | 720x1280 | 30.00 | 20.0 | h264 | 12.4 | 2026-07-11 08:49:48 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/3cd60d29-2c36-4081-b5dd-d0387b6ad463.mp4` | 720x1280 | 30.00 | 20.0 | h264 | 6.6 | 2026-07-10 22:25:15 |  |

**Totals (c, unique): 22 clips — 6.5 min — 0.29 GB.** (+1 dup: kept/5a8beb3c = parent copy)

| File | Res | fps | Dur (s) | Codec | Size (MB) | Modified | Sheet / Notes |
|---|---|---|---|---|---|---|---|
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/e0350ca7-0f05-4726-9f9d-79f6872e0cf2.mp4` | 720x1280 | 30.00 | 20.0 | h264 | 12.4 | 2026-07-11 08:56:56 | DUPLICATE: byte-identical to ../e0350ca7-0f05-4726-9f9d-79f6872e0cf2.mp4 |

## (d) Non-gameplay video assets (voice-seal renders, stubs)

| File | Res | fps | Dur (s) | Codec | Size (MB) | Modified | Sheet / Notes |
|---|---|---|---|---|---|---|---|
| `/home/jimothy/Videos/JAKESJAM/devlog-000-voice-seal-v2.mp4` | - | - | - | (corrupt: no moov atom) | 19.8 | 2026-07-11 14:39:52 | file was still growing during this scan — render likely in progress; re-probe before use |
| `/home/jimothy/Videos/JAKESJAM/devlog-000-voice-seal.mp4` | 1920x1080 | 24.00 | 240.9 | h264 | 209.2 | 2026-07-11 13:57:41 | rendered voice-avatar overlay (Voice Seal), NOT gameplay |
| `/home/jimothy/Downloads/devlog-000-voice-seal.mp4` | - | - | - | (corrupt: no moov atom) | 112.5 | 2026-07-11 13:35:57 | voice-avatar overlay render, interrupted/unplayable |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/edd30e1d-5e12-4d2b-b32a-665a53edfa15.webm` | - | - | - | (5-byte stub) | 0.0 | 2026-07-10 21:45:40 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/5ba0f92f-f400-4aba-9e92-c0c3488dad6b.webm` | - | - | - | (5-byte stub) | 0.0 | 2026-07-10 21:44:58 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/6417815f-1771-449c-8fff-1d8e73c327e4.webm` | - | - | - | (5-byte stub) | 0.0 | 2026-07-10 21:42:20 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/4782ca5b-8206-4e36-b9e9-0e10fe2eb8fd.webm` | - | - | - | (5-byte stub) | 0.0 | 2026-07-10 21:41:38 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/18665693-7617-4e74-a40a-8c041dee607d.webm` | - | - | - | (5-byte stub) | 0.0 | 2026-07-10 21:27:36 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/c82b4db1-9f12-4dfa-8223-37f25529018b.webm` | - | - | - | (5-byte stub) | 0.0 | 2026-07-10 21:27:08 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/9103439c-939b-4041-8ae5-0ac2ea1ab4ce.webm` | - | - | - | (5-byte stub) | 0.0 | 2026-07-10 21:22:39 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/72d88a63-c51a-408a-ae89-09525b90ebb9.webm` | - | - | - | (5-byte stub) | 0.0 | 2026-07-10 20:54:05 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/73f36843-2c32-4240-a79f-20beb6373f48.webm` | - | - | - | (5-byte stub) | 0.0 | 2026-07-10 19:49:59 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/cf000bc6-386c-4562-a69e-c48fb7cdaba4.webm` | - | - | - | (5-byte stub) | 0.0 | 2026-07-10 19:28:59 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/86c788c9-3550-4f18-b586-57f8be0318db.webm` | - | - | - | (5-byte stub) | 0.0 | 2026-07-10 19:23:35 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/3cb234c2-b80d-439c-a80a-1b3076692de2.webm` | - | - | - | (5-byte stub) | 0.0 | 2026-07-10 09:51:20 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/50d7b623-a08d-4ad7-81e9-da01026992b5.webm` | - | - | - | (5-byte stub) | 0.0 | 2026-07-10 09:41:55 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/048bfc4a-3ab1-47f2-83db-406ae8baf495.webm` | - | - | - | (5-byte stub) | 0.0 | 2026-07-10 09:15:34 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/e2dc8170-4f09-47c4-9ac1-603c14515405.webm` | - | - | - | (5-byte stub) | 0.0 | 2026-07-10 09:12:13 |  |
| `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/server/.clips/kept/63f57042-7f6b-4a25-9202-f70853462b70.webm` | - | - | - | (5-byte stub) | 0.0 | 2026-07-10 09:11:08 |  |

**Totals (d): 19 files — 4.0 min playable — 0.36 GB.** Only `~/Videos/JAKESJAM/devlog-000-voice-seal.mp4` (1080p24, 240.9 s) is playable; the two other voice-seal files are corrupt (missing moov atom — interrupted renders) and the 16 kept/*.webm are 5-byte stubs.

## (e) Skipped / irrelevant videos (listed so nothing is silently dropped)

- `~/Videos/devil_*` + `BassRadian - The devil...` x3 + `draft_footage_9x16.mp4` (9 files, ~2.0 GB) — BassRadian music-video project, not JAKESJAM
- `~/Videos/beer_gas_tax_9x16.mp4`, `~/Downloads/beer_gas_9x16_{MASTERED,LOUD}.mp4`, `~/Downloads/Australia Taxes Beer....mp4` — beer-gas-tax satire video project
- `~/Videos/cursed_institutions_9x16*.mp4` x2 + `~/Downloads/cursed_institutions_9x16.mp4` — music video project
- `~/Videos/{lighton,tatcigui,final_social,HookyPunchThrough}_9x16.mp4` + Downloads copies, `~/Downloads/civil_unrest_lyrics_9x16.mp4` — music/social video renders
- `~/Downloads/elm-vid-edit/` (~150 mp4s: broll/, slots*/, video-track*, ELM-WEB3-DEMO-*) + `~/Downloads/elm-web3-vertical-FINAL.mp4` — elm-web3 demo video project
- `~/Downloads/semlly.mp4`, `~/Downloads/Just a Guy (Peta's Watching).mp4`, `~/Downloads/Comment Playlist....mp4`, `~/Downloads/autogenes-intro.mp4` — unrelated downloads
- `~/Videos/screenrecording-2026-03-22_*.mp4` x3 — March screen recordings, pre-JAKESJAM, not game footage

## Grand total (JAKESJAM-relevant, unique files)

**275 files — ~103 min — 2.13 GB** (plus 20 duplicate copies, 0.20 GB).

## Recommended top clips for the devlog edit

All paths relative to `server/` unless noted. Scrub via the linked contact sheets.

| # | Clip | Beats covered | Why |
|---|---|---|---|
| 1 | `.clips-host/Replay_2026-07-11_12-18-00.mp4` | card draft, death, respawn, chaos | The money clip: CHOOSE YOUR UPGRADE (with **Quick Parry** card on screen), ELIMINATED 15 card, 3-2-FIGHT respawn, then a huge fan of projectiles. Four script beats in 14 s. |
| 2 | `.clips-host/Replay_2026-07-11_12-17-25.mp4` | chaotic multi-projectile fight | Highest bitrate of all 178 replays; dense projectile streams both directions vs the purple opponent. |
| 3 | `.clips-host/Replay_2026-07-11_12-31-21.mp4` (= `.clips/c5fe3963...`) | card pickup / draft | Cleanest CHOOSE YOUR UPGRADE moment — Gluon Fangs / Seeker Facets / Needle Compressor cards readable, then back into a fight. |
| 4 | `.clips-host/Replay_2026-07-11_12-11-57.mp4` | death + respawn | ELIMINATED 15 death card held on screen, respawn countdown, big-orb projectile fight after. |
| 5 | `.clips-host/Replay_2026-07-11_12-25-48.mp4` | bot fight, death | Duel ending in "TO BOT · PISTON" kill attribution — explicit bot-fight proof, plus lonely traversal frames. |
| 6 | `.clips-host/Replay_2026-07-11_12-22-59.mp4` | dash-bash / melee, bot fight | Dash-in melee slash arc against the bot, explosion death "TO BOT · PISTON". Closest confirmed dash/parry footage — scrub this one (and #1, where Quick Parry was drafted) for an actual rocket-deflect. |
| 7 | `.clips-host/Replay_2026-07-11_10-33-21.mp4` | respawn / round start | Clean 3 → 2 → FIGHT! countdown into projectile trades — perfect cut-in beat. |
| 8 | `.clips/kept/4facc5b6-a8f9-4950-b1fd-bc7014eaa909.mp4` | empty-arena / lonely vibe | Jake hand-kept it: ultra-wide empty arena vista, one tiny player walking alone. Clean capture, no browser chrome. |
| 9 | `.clips/9fcea6ed-5b43-4ad7-901b-2f33a41616a5.mp4` | bot fight (clean capture) | Player vs BOT · SPARK projectile exchange with no browser chrome — best-looking bot footage for hero shots. |
| 10 | `.clips/02bb89e6-bdcf-41f1-8eb6-8f806a17245e.mp4` | lonely vibe / bot idle | Solo BOT · PISTON wandering the platforms, clean capture, also in kept/. Eerie "the arena plays itself" shot. |

Gaps and hints:
- **Rocket-deflected-back-at-sender**: not confirmable from stills. Best odds: scrub #6 and #1 (Quick Parry drafted in #1), and the 12:1x-12:3x replay block generally — that was the most intense session.
- **Absurd late-game screen-full-of-projectiles**: #1/#2 are the best found; also eyeball the sheets for `Replay_..._12-2x-xx`/`12-3x-xx` (highest-bitrate block).
- The three 11:2x lock-screen replays and the two `10-5x` near-static replays are not usable gameplay.
- For 9:16 shorts, the 21 vertical `.clips` files (group c) are ready-made clean crops.

## ⚠️ POISONED CLIPS — never use in published video (desktop leak, found 2026-07-11)
- `server/.clips/a306b1b9-c878-4456-90c3-aeb97df8a875.mp4` — DESKTOP capture (file manager + terminal), not game canvas
- `server/.clips/4872b9d7-7988-41b7-80b0-f8ac746962db.mp4` — DESKTOP capture (file manager + terminal), not game canvas
Rule: verify every clip visually before it enters an edit; window-scoped game capture only, never display capture.
- UPDATE 2026-07-11 16:2x: a306b1b9 + 4872b9d7 MOVED to server/.clips-quarantine/ (were publicly served).
- b1b230d9 REPLACED in-place with 0-18.3s trim (tabs visible after ~18.5 in original — original in quarantine as orig-b1b230d9.mp4).
- 5ca306b1 REPLACED in-place with 0-10.3s trim (Tailscale hostname banner at ~10.5-13 — original in quarantine as orig-5ca306b1.mp4).
