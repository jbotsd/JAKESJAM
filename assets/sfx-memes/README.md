# Meme SFX Kit (JAKESJAM shorts)

Real, canonical meme sound effects ripped from the reference YouTube uploads (no synthesis).
All files: 48 kHz mono 16-bit WAV, peaks normalized to -1.0 dBFS (volumedetect-measured gain + alimiter safety).
Raw untrimmed rips kept in `raw/`. Trim times below are offsets into the RAW download.

## Core four (already placed in the edit)

| File | Sound | Source video | Uploader | URL | Trim (raw) | Dur |
|---|---|---|---|---|---|---|
| boom.wav | Vine boom (canonical Bluezone bass hit) | Vine Boom Sound Effect [HD, Original] | Movie Man | https://www.youtube.com/watch?v=6L_pyysrCZA | 0.00-3.90s | 3.90s |
| crickets.wav | Crickets / awkward silence comedy sting | Crickets (Awkward Silence) - Sound Effect (HD) | Gaming Sound FX | https://www.youtube.com/watch?v=CpGtBnVZLSk | 0.10-4.60s | 4.50s |
| airhorn.wav | MLG airhorn (classic blast sequence) | MLG AIR HORN sound effect | Pizza Hunter Sound | https://www.youtube.com/watch?v=24ADMp-vrLg | 0.93-3.95s | 3.02s |
| denied.wav | Windows XP Critical Stop / error ("bureaucratically denied") | Microsoft Windows XP Error - Sound Effect (HD) | Gaming Sound FX | https://www.youtube.com/watch?v=0lhhrUuw2N8 | 0.48-1.45s | 0.97s |

## Bonus staples

| File | Sound | Source video | Uploader | URL | Trim (raw) | Dur |
|---|---|---|---|---|---|---|
| bruh.wav | Bruh Sound Effect #2 (THE canonical upload) | Bruh Sound Effect #2 | Jame Benedict | https://www.youtube.com/watch?v=2ZIpFytCSVc | 0.44-1.02s | 0.58s |
| scratch.wav | Record scratch / music stop | RECORD SCRATCH Sound Effect | SoundEffectsFactory | https://www.youtube.com/watch?v=CPGcpIXeA-4 | 1.70-3.10s | 1.40s |
| pipe.wav | Metal pipe falling (Jixaw original) | Official Jixaw Metal Pipe falling Sound effect (REAL) (OFFICIAL) | Jixaw XP | https://www.youtube.com/watch?v=kPWv44v0b04 | 0.00-3.20s | 3.20s |
| trombone.wav | Sad trombone (wah wah wah) | Sad Trombone Wah Wah Wah Fail Sound Effect | GamingSoundEffects | https://www.youtube.com/watch?v=LukyMYp2noo | 0.33-3.80s | 3.47s |

## Trap / DJ-drop family

| File | Sound | Source video | Uploader | URL | Trim (raw) | Dur |
|---|---|---|---|---|---|---|
| damnson.wav | "DAMN SON WHERE'D YOU FIND THIS" (Shadoehaze DJ drop, Trap-A-Holics tag) | Damn Son Where'd You Find This - Sound Effect (HD) | Gaming Sound FX | https://www.youtube.com/watch?v=z8RkR4rd7dM | 0.24-2.70s | 2.46s |
| traphorn.wav | Dancehall/trap air horn (pitched "bwaaamp", distinct from MLG blast) | Airhorns - Sound Effect (HD) | Gaming Sound FX | https://www.youtube.com/watch?v=gII-ghI2_8k | 0.14-3.11s | 2.97s |
| riser.wav | DJ riser/sweep into drop | Riser - Sound Effect (Free) | Sound Central | https://www.youtube.com/watch?v=Am4wYTiHHx8 | 2.30-5.25s | 2.95s |
| bassdrop.wav | Bass drop (trap-edit style) | Bass Drop - Sound Effect (HD) | Gaming Sound FX | https://www.youtube.com/watch?v=oBwkGx8uWT4 | 0.00-3.80s | 3.80s |

Skipped intentionally: "emotional damage" (voice line, rights-noisy), Roblox death "oof" (rights drama), taco bell bong (no clean canonical source pursued).

Notes:
- damnson.wav has the ROOF-BLOWER ANNOUNCER treatment on top of the rip (per Jake 2026-07-11, "blow the roof off"): highpass 80 Hz, +3 dB @ 150 Hz + +2 dB @ 220 Hz (beef), +5 dB @ 3.5 kHz (presence), +3 dB @ 8 kHz (air), double compression (6:1 thr -30 dB makeup +12, then 3:1 thr -12 dB makeup +4), driven ~8 dB into the -1 dBFS limiter. Result: mean -6.5 dB (raw rip was -16.7), peak -1.0 dB — max clean density; hotter = distortion.
- crickets source was very quiet (peak -22.7 dB raw) → +28.6 dB gain applied; noise floor is inherent to the sound.
- riser source was quiet (peak -19 dB in the trimmed window) → +18 dB gain; ends hot at the sweep peak by design (0.03s fade only).
- `raw/meta.txt` and `raw/meta2.txt` hold the yt-dlp title/uploader/URL records from download time.
- Also in raw/: traphornA.wav = 72s "Dancehall Air Horns" collection (DJ Riddim, XOqXBJLT8Uw) kept for alternate horn picks.
