# JAKESJAM Music Manifest

Semantic catalog of BassRadian (Jake) music for JAKESJAM promo use. Built 2026-07-11.

**Method note:** BPM/key/energy come from librosa analysis (beat-track, chroma key estimate, RMS contour) plus the BPM baked into Suno stems folder names — **not from listening**. Mood descriptions are inferences from filename, tempo, key mode, spectral centroid (brightness), and energy contour. Verify by ear before final render. Where librosa and the stems-folder BPM disagree, the folder BPM is listed as nominal (librosa often locks to a nearby harmonic, e.g. 136 vs 138).

**Energy contour** = relative loudness across 10 equal time slices, 0–9.

---

## Tier 1 — The game's own soundtrack (most on-brand, use first)

These ship inside the game (`client/public/audio/`, mirrored identically in `client/dist/` and `~/jakesjam-tiktok/music/` — md5-verified same files). `main.ts`: `jakes-jam-theme.mp3` is the looping menu theme; `epic-loop-1/2/3.mp3` rotate as world/match music.

| Track | Path | Dur | BPM | Key | Vocals | Stems | Mood (inferred) | License |
|---|---|---|---|---|---|---|---|---|
| Jakes Jam (menu theme) | `/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/client/public/audio/jakes-jam-theme.mp3` (master wav: `/home/jimothy/Downloads/Jakes Jam.wav`) | 2:15 | ~138 (librosa 136) | F maj | likely vocal chops | no dedicated dir found | Bright, anthemic, high-energy throughout (contour 7–9 flat-hot); major-key hype | BassRadian original — safe |
| epic-loop-1 | `.../client/public/audio/epic-loop-1.mp3` (source: `/home/jimothy/Downloads/bassradian - epic loop-1783591180.wav`) | 2:15 | ~138 | F maj | chops | see family note | Driving arena energy, slightly darker/warmer than the theme (lower centroid) | BassRadian — safe |
| epic-loop-2 | `.../client/public/audio/epic-loop-2.mp3` (source: `.../Downloads/bassradian - epic loop (1).wav`) | 2:13 | ~138 | F maj | chops | see family note | Hottest mix of the set (RMS −15.9), brightest; builds 5→9 over first half, hits at 0:56 | BassRadian — safe |
| epic-loop-3 | `.../client/public/audio/epic-loop-3.mp3` (source: `.../Downloads/bassradian - epic loop (2).wav`) | 1:27 | ~138 | **F min** | chops | **YES** — `/home/jimothy/Music/suno-stems/bassradian - epic loop Stems (138BPM)/` (84.8s, 7 stems incl. lead/backing vox, drums, bass, synth) matches this cut | Darkest of the set (minor key); **natural +3.9 dB impact at exactly 0:48**, breakdown at 0:58, second surge 1:00–1:20 | BassRadian — safe |
| menu-music (standalone build) | `.../JAKESJAM/standalone/audio/menu-music.wav` | 0:28 | ~129 | F# min | ? | no | Dark, bass-heavy stub (centroid 880 Hz — subby); flat-loud then tail-out. Legacy/standalone only | BassRadian — safe |
| bassradian - epic loop (original seed) | `/home/jimothy/Downloads/bassradian - epic loop.wav` | 0:14 | 138 | F maj | — | (zip `bassradian - epic loop Stems (138BPM).zip`) | The Jul-2025 seed loop the family grew from; hot (−8 dB RMS), bright. Usable as a 14s sting/loop bed | BassRadian — safe |

Family note: the whole "epic loop" family (theme + loops 1–3) is one Suno lineage at 138 BPM in F. They can be cross-faded/beat-matched freely — same key family (loop-3 flips to F minor for menace).

## Tier 2 — BassRadian originals with stems (promo-grade, duckable)

Stems folders are treated as one track each. All stems are Suno-style splits (Lead Vox / Backing Vox / Drums / Bass / Percussion / Synth / Other …) — **gold for ducking under VO: drop the vox stems and you have an instant instrumental**.

| Track | Master / Stems | Dur | BPM | Key | Vocals | Mood (inferred) | License |
|---|---|---|---|---|---|---|---|
| Blackout | master w/ vox: `/home/jimothy/Downloads/blkout 2026-07-02 1204.wav`; **instrumental master: `/home/jimothy/Downloads/novoxblkout 2026-07-03 1103.wav`**; stems: `/home/jimothy/Music/suno-stems/Blackout Stems (133BPM)/` (7 stems, 182.3s — exact match) | 3:02 | 133 | A♯ min | yes (novox version exists) | Dark, punchy, electronic; quiet intro then **huge +13.9 dB slam at 0:20** and another **+10.4 dB drop at 1:12**; sustained 8–9 energy after | BassRadian — safe |
| Blood on Your Hands | master: `/home/jimothy/Downloads/Blood on Your Hands.wav`; stems: `/home/jimothy/Data/offload/stems/Blood on Your Hands Stems (88BPM)/` (8 stems incl. strings) | 3:49 | 88 | D maj | yes | Mid-tempo, cinematic (strings stem), steady 5→9 build; brooding title, major key — bittersweet epic | BassRadian — safe |
| Brass Astrolabe | stems only: `/home/jimothy/Data/offload/stems/Brass Astrolabe Stems (77BPM)/` (8 stems; alt cut `Brass Astrolabe Stems (132BPM).zip` in Downloads); no master wav found — rebuild by summing stems | 3:54 | 77 | C min | yes (vox stems) | Slow, dark, low-spectrum (mixed-stems centroid 603 Hz — very subby/moody); long 2→9 build over 4 min | BassRadian — safe |
| Concrete Uplift (Remix) | stems only: `/home/jimothy/Data/offload/stems/Concrete Uplift (Remix) Stems (173BPM)/` (11 stems incl. brass/woodwinds); half-time cut `Concrete Uplift (Remix) Stems (87BPM)/` in Downloads | 3:15 | 173 (= 86.5 half-time) | F min | yes | DnB-tempo, orchestral-electronic hybrid; relentless climb to 9s in back half — intense, maybe exhausting for long-form | BassRadian — safe |
| Console Rainlight | full master: `/home/jimothy/Downloads/Console Rainlight (1).mp3` (3:07); short cut `Console Rainlight.mp3` (1:27); stems: `/home/jimothy/Music/suno-stems/Console Rainlight Stems (87BPM)/` (5 stems, 2:48, **no vocal stems — instrumental track**) | 3:07 | 87 | F min | **no** | Mellow, warm, lo-fi (centroid 1569 Hz — soft top end); gentle steady 6–9 contour, no violent jumps; "console + rain" chill-gaming vibe | BassRadian — safe |
| Don't Tread on Me | master: `/home/jimothy/Downloads/dtom.wav`; stems: `/home/jimothy/Downloads/Don't Tread on Me Stems (128BPM)/` (7 stems; alt 177BPM cut + 136BPM mashup also present) | 3:07 | **128** | G maj | yes | Very dynamic master (huge quiet/loud swings, ends near-silent); 128 BPM is in the 110–130 sweet spot but the arc is spiky/awkward for a 60s cut | BassRadian — safe |
| Taxing Our Lifestyle (PRRT Hot Bop) | master: `/home/jimothy/Downloads/Taxing Our Lifestyle (PRRT Hot Bop).wav`; stems at 137/138/69 BPM in Downloads | 3:00 | 137 | A♯ min | yes | Bright, satirical bop (tax-policy novelty lyrics); hit at 0:52; energy dips mid | BassRadian — safe (lyrics are AU-tax satire — off-topic for JAKESJAM) |
| skemaphore | master: `/home/jimothy/Downloads/skemaphore.mp3`; stems: `skemaphore Stems (157BPM)/` | 1:04 | 157 | D min | ? | Slammed-loud wall (contour all 9s, RMS −10.9), fast, aggressive; short | BassRadian — safe |
| jimjamjakejamtopline | `/home/jimothy/Downloads/jimjamjakejamtopline.wav` (+ `-1776913943` dup) | 1:58 | 123 | C♯ min | **yes — vocal topline only** | Sparse a-cappella-ish topline (RMS −34.5 — mostly bare vocals). Raw material, not a backing track | BassRadian — safe |
| Jim Jam Cats On (cat song family) | `/home/jimothy/Music/jimjamcatson 2026-04-23 1134.mp3` (many takes in Music/ + Downloads; stems: `A song about my vcat - full (2) Stems (114BPM)/`) | 2:41 | ~114 | B maj | yes | Goofy, bouncy, major-key novelty (song about his cat) | BassRadian — safe |
| Pew Pew Shuffle | `/home/jimothy/Downloads/Pew Pew Shuffle.mp3` — no stems found | 3:01 | **117.5** | E min | unverified (assume yes, Suno full gen) | Name is literally shooter-themed; energetic, sustained 7–9 after 0:35 ramp; impacts at 0:32, dips ~0:30/0:40 usable as edit points | Presumed BassRadian Suno gen (May 2026) — **verify it's Jake's before publishing** |

## Tier 3 — Larger library (BPM from stems-folder names, not individually analyzed)

`/home/jimothy/Music/suno-stems/` holds the full stems library: A Thousand Hills (100), beat (120), Don't Tread on Me (177), [erased] (84), hpt/Hooky Punch (88), LIGHT ON 2 (69), RGB Silk Meltdown (125), Rift Valley Cessna, Taxing Our Lifestyle (69/137/138), thebeattousethroughoutplease (69), Console Rainlight (87), Blackout (133), Brass Astrolabe (77/132), Blood on Your Hands (88), Concrete Uplift (87/173), vcat (114), skemaphore (157), plus Jake Bit better / JAke while hes sick vocal-model folders (KITS voice-conversion takes, not backing tracks). Downloads additionally has many WIP masters (strapin, tatcigui, cursed institutions, hpt2, lighton, bttw, makenzie, lkskril …) — all BassRadian WIP, all safe, none obviously better-suited to JAKESJAM than the tiers above.

**NOT Jake's — do not use in promo:**
- `/home/jimothy/Music/Opus No. 1.mp3` (5:40) — almost certainly Tim Carleton's "Opus No. 1" (the hold-music classic). Not BassRadian.
- `/home/jimothy/Music/Continuum.opus` (3:50, with .webp/.png sidecars = yt-dlp download) — third-party rip.
- `/home/jimothy/Downloads/Radiohead - Pyramid Song [...].mp3` — obviously not.
- ElevenLabs / Kokoro / operator-coach / KITS vocal files — TTS/voice assets, not music.

---

## RECOMMENDATIONS

### (a) 60-second hype short (announcer → deadpan jokes → "IT'S FIGHT NIGHT!" sting at ~0:48)

**Top pick: epic-loop-3** (`client/public/audio/epic-loop-3.mp3`, 138 BPM, F min, 1:27)
- It is the game's own match music — maximum brand coherence; anyone who plays will recognize it.
- **It has a natural +3.9 dB impact at exactly 0:48 with zero editing** — start the track at 0:00 under the announcer intro and the surge lands on the fight-night sting for free. There's a breakdown right after (~0:58) that gives the end-card room to breathe, then a second surge if the cut runs long.
- F minor = the menacing one of the family — right register for "arena chaos" against deadpan VO.
- **Stems exist** (`~/Music/suno-stems/bassradian - epic loop Stems (138BPM)/`): mute the vox stems and duck drums/synth under the jokes, slam everything back for the sting.
- At 138 BPM, 0:48 = beat-aligned (bar 28 area); a 53s VO cut fits inside the 87s file with tail to spare.

**Runner-up: Blackout (novox master)** (`~/Downloads/novoxblkout 2026-07-03 1103.wav`, 133 BPM, A♯ min)
- The biggest drops in the whole catalog: +13.9 dB at 0:20 and +10.4 dB at 1:12. Start the video at track-time 0:24 and the 1:12 slam lands at video-time 0:48 — a much more violent sting than epic-loop-3 if the edit wants maximum impact.
- Already instrumental (novox), so the VO never fights lyrics; full 7-stem folder for finer mixing.
- Slightly less on-brand than in-game music, still 100% BassRadian.

Sting-flag note: the brief asked for ~110–130 BPM with a natural drop — nothing in the catalog hits both perfectly (Don't Tread on Me is 128 but dynamically spiky; Pew Pew Shuffle is 117.5 with only modest jumps). The 133/138 BPM picks above trade 5–8 BPM for dramatically better natural drops; at short-form pacing that reads as more energy, not rushed.

### (b) ~4-min devlog bed (talky, unobtrusive, loopable)

**Top pick: Console Rainlight** (full: `~/Downloads/Console Rainlight (1).mp3` 3:07; stems: `~/Music/suno-stems/Console Rainlight Stems (87BPM)/`)
- The only genuinely mellow instrumental in the catalog: 87 BPM, soft spectrum, no vocals at all (no vox stems exist), no startling energy jumps — it will not fight a talking head.
- Even the name is on-theme for a gamedev devlog ("Console").
- Loop the 3:07 master once for a 4-min video, or rebuild from the 5 stems and drop the Guitar/Synth stems for an even thinner bed; duck Drums −6 dB under speech.

**Runner-up: Brass Astrolabe (instrumental from stems)** (`/home/jimothy/Data/offload/stems/Brass Astrolabe Stems (77BPM)/`, sum everything except `0 Lead Vocals` + `1 Backing Vocals`)
- 77 BPM, very dark/subby — sits *under* speech spectrally (male VO lives 100 Hz–4 kHz; this track's energy is mostly below that). 3:54 covers the devlog almost without looping.
- Caveat: it builds continuously 2→9, so either flatten it in the mix or embrace the slow-burn as the devlog's arc.

### (c) Fight Night stream music (looping, energetic but not exhausting)

**Top pick: the in-game world-music rotation — epic-loop-1 → 2 → 3** (`client/public/audio/epic-loop-*.mp3`, ~5:35 total, all ~138 BPM in F)
- This is literally what `main.ts` does in matches (`WORLD_MUSIC_TRACKS` rotates them on `ended`) — the stream sounds like the game, which is the whole point of Fight Night.
- One tempo, one key family (F maj/maj/min) = seamless rotation with no jarring transitions; the maj→maj→min cycle gives variety so a 2-hour stream doesn't wear one loop out.
- Practical: point OBS at a playlist of the three files on shuffle-less loop, or pre-render a 5:35 concat. Keep them at ~−20 LUFS under game SFX + mic.
- Watch out: if the stream also captures game audio, the game plays these same tracks — either mute in-game music (settings has Mute Music) and run the loops on the OBS side, or just let the game supply the music and skip a stream bed entirely.

**Runner-up: Blackout (novox) + Blood on Your Hands alternation** (`novoxblkout...wav` 133 BPM + `Blood on Your Hands.wav` 88 BPM)
- Blackout brings fight energy without lyrics; Blood on Your Hands at 88 BPM is the recovery track between matches so viewers' ears get a rest ("energetic but not exhausting" = tempo contrast, not one flat banger). Both have full stems to make radio-edit loops without vocals.

### Cross-cutting notes
- **Stems are the superpower here**: for every recommended track except Pew Pew Shuffle, vocal-free duckable stems exist. Standard recipe: mute `0 Lead Vocals`/`1 Backing Vocals`, sidechain-duck the remaining bus −6 to −9 dB under VO, release on VO gaps.
- All Tier 1/2 picks are BassRadian originals (Suno-assisted, Jake's account/prompts) — no third-party license exposure. The only catalog items to avoid are the Tier 3 "NOT Jake's" list.
- Everything above 44.1 kHz WAV or 320-ish mp3 — fine for 1080p short-form; use the WAV masters for the final renders where they exist.
