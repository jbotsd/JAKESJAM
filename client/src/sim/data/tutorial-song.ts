// The Pretennoia tutorial's cue table — hand-authored absolute song-
// timestamps, consumed by SongDirector. This track (bassradian - epic loop,
// client/public/audio/tutorial-theme.mp3, 246.36s) is a half-time DnB piece
// with asymmetric, continuously-re-edited breakbeats that deliberately never
// settle into a fixed loop — a computed BPM grid would be wrong for it, so
// every cue here is a literal second value measured against the real track,
// not a beat-multiple.
//
// Section map (vocal arc cross-referenced against energy/structural
// boundaries — see the plan doc for the full derivation):
//   0:00-0:08   Silence        solo chant, no rhythm, near-silence rising
//   0:08-0:19   (building)     chant continues, drums gathering
//   0:19-0:32   First Word     a lull, then the beat lands hard at 0:32
//   0:32-1:36   The Voice Speaks   longest sustained loud stretch (64s)
//   1:36-1:49   (breather)
//   1:49-2:19   The Response   hottest sustained energy in the track
//   2:19-2:56   The Three Forms   the Voice/Speech/Word triad, textured/broken
//   2:56-3:06   The Turn       biggest pull-back besides the intro, riser
//   3:06-3:58   The Vessel Answers   full choir, the peak of the piece —
//                               this is the extraction: the vessel is
//                               sealing/collapsing around the fight, not
//                               just "a harder dummy." Big, bombastic,
//                               on-brand (liquid-light/seal geometry, not
//                               literal machinery) — the escalation should
//                               read like a raid you're fighting your way
//                               OUT of, not a calm final exam.
//   3:58-4:06   Silence, again solo voice again, fading — the exit should
//                               land as a triumphant burst (hard light,
//                               punch-zoom) breaking free, not a soft fade.
//
// Coptic glyph-flashes use short words drawn from the ancient (public-domain)
// source text itself — brief invocation terms, not the song's fuller English
// verse/chorus lines. Per docs/visual-language-gnostic-vessel.md §5
// ("untranslatable charge"), Coptic NEVER appears bare: every flash carries
// {text, translit, gloss} — glyph, Latin transliteration, one-word English —
// on the same line, e.g. `ⲪⲰⲤ · phōs · light`. That rule exists specifically
// so charged marks don't read as an indecipherable sermon; it's also just
// the fix for "I have no idea what's going on."
//
// Timing: per docs/IDENT-GRAMMAR.md's Law 2 ("land ON the hit or don't land
// at all"), these are measured against the real track, not guessed. The
// rhythmic sections (Turn/Outro) got real onset-detected hits
// (librosa.onset.onset_detect); the solo a cappella intro has no percussive
// transients for a detector to find at all (expected for rubato solo
// voice), so those two are set from the measured RMS energy envelope's
// actual rise/dip instead of a blind guess — still real data, not invented.

const COPTIC_INTRO_1 = { text: "ⲁⲛⲟⲕ ⲧⲉ", translit: "anok te", gloss: "I am" };
const COPTIC_INTRO_2 = { text: "ⲡⲣⲱⲧⲉⲛⲛⲟⲓⲁ", translit: "pretennoia", gloss: "first thought" };
const COPTIC_CHORUS = { text: "ⲟⲩⲟⲉⲓⲛ", translit: "ouoein", gloss: "light" };
const COPTIC_TURN = { text: "ⲛⲟⲩⲥ ⲥⲓⲅⲏ", translit: "nous sigē", gloss: "mind, silence" };
// The adversary named once, at its manifestation — Samael, "the blind god,"
// is the Apocryphon of John's own epithet for the lion-faced serpent.
const COPTIC_DEMIURGE = { text: "ⲓⲁⲗⲧⲁⲃⲁⲱⲑ", translit: "yeldabaōth", gloss: "the blind god" };
// The missing figure: Yeldabaoth exists (born from error) and Pretennoia
// exists (the voice you ARE), but nothing named who's actually doing the
// guiding at the recognition beat. Named exactly once, at the gasp itself
// (see turn-gasp) — not a new character arriving, just the truth of whose
// light that was the whole time. "Sephia" transliterates directly and
// predictably as a Greek loanword into Coptic (unlike an obscure proper
// name like Estaphaios, this one carries real confidence).
const COPTIC_SEPHIA = { text: "ⲥⲟⲫⲓⲁ", translit: "sephia", gloss: "wisdom" };
const COPTIC_OUTRO = { text: "ⲁⲙⲏⲛ", translit: "amēn", gloss: "so let it be" };

// The heist arc, told in waves (all real sim entities — see
// TutorialScene's "horde:wave" handler): the agent slips into the
// Demiurge's realm (Silence/First Word), starts stealing the spiritual
// materials (The Voice Speaks — the realm sends its first weak shards),
// the realm ANSWERS in force (The Response — real waves), the arena is
// forged from what was taken (Three Forms — board wiped for the climb),
// the recognition (the gasp — we could always do this), and the Demiurge's
// full answer (The Vessel Answers — escalating spell loadouts + waves,
// board-wiped for a clean final 1v1 before the burst-out).

import type { SongCue } from "../../game/systems/SongDirector.js";

export const TUTORIAL_SONG_DURATION_SEC = 246.36;

export const tutorialSongCues: readonly SongCue[] = [
  // ── Silence (0:00-0:19) — a real ENTRY, not a generic establishing shot.
  //    The camera starts high and wide, outside/above the seal (the vessel
  //    not yet entered), then plunges down and in over the chant's rising
  //    near-silence, arriving at the spawn point right as the drums begin
  //    gathering at 0:08 — the character IS Pretennoia's descent into the
  //    vessel. The seal's boundary ring ignites shut overhead the instant
  //    the descent completes (data.sealClosing), sealing the entrance
  //    behind the player — the deliberate bookend to the outro's seal
  //    BREAKING open on the way back out (see "Silence, again" below). ──
  { id: "zone-silence", atSec: 0.0, kind: "zone:enter", data: { name: "Silence" } },
  { id: "open-outside", atSec: 0.0, kind: "camera:snap", data: { x: 600, y: 300, zoom: 0.35 } },
  { id: "descent-plunge", atSec: 0.3, kind: "camera:pan", data: { x: 480, y: 780, ms: 6800, ease: "Sine.easeIn", zoom: 1.15 } },
  // SUPERSEDES the earlier vocal-band-RMS estimate below — that guess (2.5s)
  // was still ~5s early ("timing is out," reported twice). This is now real
  // word-level ASR timing (faster-whisper, word timestamps only — no lyric
  // text ever entered the cue table or this comment, per the no-reproduction
  // rule) against the actual master WAV: the first sung syllable lands at
  // 7.5s, not 2.5s — the solo a cappella open has a much longer held silence
  // than the energy-envelope heuristic could tell apart from noise floor.
  { id: "chant-flash-1", atSec: 7.5, kind: "diegetic:coptic-flash", data: COPTIC_INTRO_1 },
  // 8.82s: the next word's onset holds ~1.5s (vs ~0.3s for its neighbors) —
  // the one clearly stressed/sustained syllable in the phrase, same ASR pass.
  { id: "chant-flash-2", atSec: 8.82, kind: "diegetic:coptic-flash", data: COPTIC_INTRO_2 },
  { id: "descent-arrive", atSec: 7.1, kind: "camera:pan", data: { x: 150, y: 900, ms: 900, ease: "Sine.easeOut", zoom: 1.0 } },
  { id: "seal-closes-overhead", atSec: 7.6, kind: "diegetic:seal-closing", data: {} },
  { id: "seal-closes-thud", atSec: 8.0, kind: "camera:shake", data: { amount: 0.3 } },
  // RETIMED 8.2/8.3 → ~17.8: the spirit-descent opening now owns the whole
  // Silence zone (descent 0.3-7.1, slow assembly 7.1-17.8 — see
  // TutorialSpiritDescent.ts). Inviting movement while the player is
  // still an uncontrollable mote of light was a lie; the glyph now fires
  // the same instant control does.
  { id: "move-invite", atSec: 17.7, kind: "camera:pull-back", data: { zoom: 1.0, ms: 2200 } },
  { id: "move-glyph", atSec: 17.9, kind: "diegetic:move-invite", data: { fromX: 150, toX: 900 } },

  // ── First Word (0:19-0:32) — a lull, then the drop lands exactly at 0:32.
  //    The runway (tutorial-arena.ts) is long on purpose so a player who's
  //    been moving since 0:08 is naturally at/near full run speed here —
  //    the character should be ON THE RUN when the drum-and-bass lands, not
  //    standing still. The hit VFX itself fires on the song's clock no
  //    matter what the player is actually doing (governing rule). ──
  { id: "zone-first-word", atSec: 19.0, kind: "zone:enter", data: { name: "First Word" } },
  { id: "jump-glyph", atSec: 19.5, kind: "diegetic:jump-invite", data: { atX: 1180 } },
  { id: "pre-drop-hold", atSec: 30.2, kind: "camera:pan", data: { x: 1235, y: 880, ms: 2000, ease: "Sine.easeIn" } },
  // 32.52: THE measured drop transient (librosa onset; the per-second RMS
  // envelope jumps -16.9dB → -0.8dB inside second 32, and 32.520 is the
  // onset inside that bucket). Law 2 (IDENT-GRAMMAR): land ON the hit.
  { id: "drop-hit", atSec: 32.52, kind: "camera:shake", data: { amount: 0.9 } },
  { id: "drop-flash", atSec: 32.52, kind: "camera:flash", data: { ms: 220 } },
  { id: "drop-handoff", atSec: 32.57, kind: "camera:handoff-action", data: {} },

  // ── The Voice Speaks (0:32-1:36, 64s) — first combat arena: Fire, then
  //    dash-parry, taught by consequence (the dummy flinches/telegraphs)
  //    rather than text. Late in the section the realm NOTICES the theft:
  //    the first two weak shards arrive. ──
  { id: "zone-voice", atSec: 32.6, kind: "zone:enter", data: { name: "The Voice Speaks" } },
  // This whole zone is 63.4s (32.6-96.0) across THREE teaching stages
  // (idle-flinch → return-fire → telegraphed-shot/dash-parry), but a
  // single default-100hp dummy dies in a few seconds of sustained fire —
  // the player was clearing it during stage 1 and then had nothing to
  // fight for the rest of the zone. Each stage transition below now
  // re-spawns (== full heal + arrival burst, same call respawnDummy
  // already makes) a fresh target sized for its OWN stage, so every
  // teaching beat actually gets its full window regardless of how fast
  // the previous stage's target went down.
  { id: "voice-dummy-spawn", atSec: 32.7, kind: "dummy:spawn", data: { x: 2500, y: 900, health: 150 } },
  { id: "voice-goal-idle", atSec: 32.8, kind: "dummy:goal", data: { mode: "idle-flinch" } },
  // First target callout — "this is a thing you shoot," before it has ever
  // fired back. Fire itself was previously never taught at all.
  { id: "voice-fire-invite", atSec: 33.0, kind: "diegetic:fire-invite", data: {} },
  // Footage (2026-07-13, second review) found the player standing
  // COMPLETELY still through this entire idle-flinch beat — 27.3s of a
  // target that, by design, never fires back or forces any reaction. A
  // stall watchdog in TutorialScene now force-promotes the fight if the
  // player hasn't engaged within 1.3s of stillness, but the SCRIPT itself
  // was also just too slow here regardless of player behavior — shrunk
  // this stage from 27.3s to 15.3s so even an actively-engaged player
  // isn't stuck dueling one passive target for half a minute.
  { id: "voice-dummy-refresh-1", atSec: 48.1, kind: "dummy:spawn", data: { x: 2500, y: 900, health: 160 } },
  { id: "voice-goal-return-fire", atSec: 48.163, kind: "dummy:goal", data: { mode: "return-fire", fireIntervalMs: 2200 } },
  // A companion shard joins the instant the fight goes live — from here on
  // the zone is never a single 1v1 duel with nothing else on screen; the
  // player has to split attention between two live threats immediately,
  // not just at the very tail end of the zone (old wave-1 was the only
  // multi-enemy beat in the whole 64s, arriving with 9s left).
  { id: "voice-wave-early", atSec: 48.5, kind: "horde:wave", data: { count: 1, xMin: 2820, xMax: 2820, fireIntervalMs: 3000, health: 20, tier: "splinter" } },
  // 64.087: measured onset in the first chorus — the call ("Ouoein!").
  { id: "chorus1-flash", atSec: 64.087, kind: "diegetic:coptic-flash", data: COPTIC_CHORUS },
  { id: "voice-dummy-refresh-2", atSec: 74.0, kind: "dummy:spawn", data: { x: 2500, y: 900, health: 210 } },
  { id: "voice-goal-parry-teach", atSec: 74.062, kind: "dummy:goal", data: { mode: "telegraphed-shot", fireIntervalMs: 1800 } },
  // The passive answer — Shield (Shift): a real wind-up now precedes every
  // shot in this mode (TutorialDummyDirector.telegraphProgress()), so this
  // invite has an actual window to land in before the first charge fires.
  { id: "voice-shield-invite", atSec: 74.25, kind: "diegetic:shield-invite", data: {} },
  // 85.333: measured onset — first shards slip in, weak and slow: the
  // realm has noticed, but doesn't yet believe. Bumped 2→3 and tightened
  // cadence — by now the player's had two full stages of practice, this
  // finale beat should feel like the busiest moment of the zone, not a
  // repeat of the early-wave beat at the same intensity.
  { id: "voice-wave-1", atSec: 85.333, kind: "horde:wave", data: { count: 3, xMin: 2050, xMax: 2750, fireIntervalMs: 2500, health: 22 } },
  // First real build change — the tutorial has no draft UI (solo scripted
  // rite), so card progression is diegetic pickups instead (see
  // TutorialDuelController.addHeroCard() / cardManifest()). triple-fan
  // mirrors what Estaphaios itself opens the climax with — the player
  // earns a taste of the same power they'll eventually face at full
  // strength. First of two; they STACK toward the climax fight.
  { id: "voice-card-grant", atSec: 94.6, kind: "hero:card-grant", data: { card: "triple-fan" } },

  // ── (breather, 1:36-1:49) — camera relaxes, no gate. ──
  { id: "zone-breather-1", atSec: 96.0, kind: "zone:enter", data: { name: "breather" } },
  { id: "breather-handoff", atSec: 96.2, kind: "camera:handoff-director" },
  { id: "breather-pan", atSec: 96.5, kind: "camera:pan", data: { x: 3400, y: 900, ms: 8000, ease: "Sine.easeInOut" } },

  // ── The Response (1:49-2:19) — the realm answers in force: the Vessel
  //    returns with homing shots and real waves arrive. All combat beats
  //    here sit on measured onsets. ──
  { id: "zone-response", atSec: 109.0, kind: "zone:enter", data: { name: "The Response" } },
  { id: "response-handoff", atSec: 108.8, kind: "camera:handoff-action" },
  // Same default-100hp gap as "The Voice Speaks" had — bumped so it
  // survives long enough to see its own mid-zone escalation
  // (response-goal-harder/response-boss-homing at 124.25) instead of
  // dying before that ever fires.
  { id: "response-dummy-spawn", atSec: 109.145, kind: "dummy:spawn", data: { x: 4350, y: 900, health: 220 } },
  { id: "response-goal", atSec: 109.2, kind: "dummy:goal", data: { mode: "return-fire", fireIntervalMs: 1500 } },
  // FIRST SIGHTING — a faint shape in the far background, unnamed, easy to
  // miss the first time and unmistakable on a replay. This is the realm
  // noticing the theft made visible: not a finale-only cameo, a presence
  // that grows across the rest of the run. See TutorialDemiurgeSerpent.ts.
  { id: "demiurge-first-sighting", atSec: 110.0, kind: "demiurge:manifest", data: { x: 5100, y: 330 } },
  { id: "demiurge-stage-0", atSec: 110.05, kind: "demiurge:stage", data: { stage: 0 } },
  { id: "response-wave-1", atSec: 113.255, kind: "horde:wave", data: { count: 2, xMin: 3550, xMax: 4500, fireIntervalMs: 2200, health: 28 } },
  { id: "response-accent-1", atSec: 117.377, kind: "camera:shake", data: { amount: 0.3 } },
  // 120.128: second chorus call — "Anok te!"
  { id: "chorus2-flash", atSec: 120.128, kind: "diegetic:coptic-flash", data: COPTIC_INTRO_1 },
  { id: "response-boss-homing", atSec: 124.25, kind: "dummy:cards", data: { cards: ["seeker-facets"] } },
  { id: "response-goal-harder", atSec: 124.25, kind: "dummy:goal", data: { mode: "telegraphed-shot", fireIntervalMs: 1200 } },
  // The aggressive answer — the Aegis power-slide (right-click/C): faster
  // volleys than Voice Speaks' shield-teaching moment justify reaching for
  // the tool that blocks AND punishes on the way in, instead of just
  // holding still behind Shield. Chevrons point INTO the threat on
  // purpose — stepping back reads exactly wrong for how the dash works.
  { id: "response-dash-invite", atSec: 124.45, kind: "diegetic:dash-invite", data: {} },
  { id: "response-accent-2", atSec: 128.395, kind: "camera:shake", data: { amount: 0.3 } },
  // The first real SQUAD: a warder (directional shield, see
  // TutorialShardThrall.ts / tutorialDuel.ts's SHIELD_* logic) holds the
  // center while splinter escorts pressure from the sides — the point
  // isn't "more enemies," it's "a different kind of problem": flank the
  // warder or wait for the crack window, while the escorts force you to
  // keep moving instead of camping an angle.
  { id: "response-wave-2-warder", atSec: 130.612, kind: "horde:wave", data: { count: 1, xMin: 4000, xMax: 4000, fireIntervalMs: 1600, tier: "warder" } },
  { id: "response-wave-2", atSec: 130.612, kind: "horde:wave", data: { count: 2, xMin: 3500, xMax: 4600, fireIntervalMs: 1900, health: 32 } },
  // Board wipe before the climb — the shards return to light; what was
  // stolen becomes the material of the arena itself.
  { id: "response-clear", atSec: 138.867, kind: "horde:clear", data: {} },
  // Second card — STACKS with triple-fan from The Voice Speaks. seeker-
  // facets mirrors the boss's own response-boss-homing pickup at 124.25s.
  // By The Vessel Answers the player is fighting with a real fan-of-
  // homing-shots build, not the bare starter pistol — the "powerful
  // moment toward the end" the climax needs to actually feel earned.
  { id: "response-card-grant", atSec: 138.9, kind: "hero:card-grant", data: { card: "seeker-facets" } },

  // ── The Three Forms (2:19-2:56, 37s) — wall-jump shaft, three ignition
  //    points along ONE continuous climb (proven-safe geometry), lit in
  //    sequence to mirror the Voice/Speech/Word triad. All three ignites
  //    sit on measured onsets. ──
  { id: "zone-three-forms", atSec: 139.0, kind: "zone:enter", data: { name: "The Three Forms" } },
  { id: "three-forms-handoff", atSec: 138.9, kind: "camera:handoff-director" },
  // OPENED UP (was x4850/y700, no zoom — which held the combat-tight
  // framing and kept the shaft's TOP off-screen the whole climb, so the
  // player had no way to read "this goes somewhere"): zoom out and center
  // on the shaft's midpoint so the full climb AND the vista ledge above it
  // are in frame from the zone's first beat — the "oh, I'm meant to climb
  // this" reveal, delivered by framing alone. Shaft grown 820px→1270px and
  // re-centered (2026-07-13, "make the wall itself longer") — y and zoom
  // both re-tuned to the new midpoint/span so the reveal still frames the
  // whole climb instead of just its lower half.
  { id: "three-forms-pan", atSec: 139.2, kind: "camera:pan", data: { x: 4850, y: 317, ms: 3500, ease: "Sine.easeInOut", zoom: 0.62 } },
  // Demonstrates the actual bounce (L-wall → R-wall → L-wall, ascending)
  // BEFORE the player needs to act — footage review found long dead time
  // here with the shaft's 3 ignition rings alone doing nothing to teach
  // the move itself. Fires right as the wide pan reveals the full shaft.
  { id: "three-forms-wall-jump-invite", atSec: 139.6, kind: "diegetic:wall-jump-invite", data: {} },
  // Closer now — the shape re-anchors further along the level and grows
  // (stage 1), tracking the climb instead of sitting fixed behind it.
  { id: "demiurge-second-sighting", atSec: 139.3, kind: "demiurge:manifest", data: { x: 5700, y: 350 } },
  { id: "demiurge-stage-1-early", atSec: 139.35, kind: "demiurge:stage", data: { stage: 1 } },
  // y values re-proportioned for the taller shaft (2026-07-13: climb grown
  // 820px→1270px by extending UPWARD — bottom stays at GROUND=952
  // unchanged, new top is -318 instead of 132) — same ~12/39/67% up-the-
  // climb spacing as before, just against the new span so the three
  // ignition beats still land at sensible heights instead of clustering
  // near the (now much smaller, relatively) bottom third.
  { id: "form-voice-ignite", atSec: 142.141, kind: "diegetic:shaft-ignite", data: { form: 1, y: 800 } },
  { id: "form-speech-ignite", atSec: 155.539, kind: "diegetic:shaft-ignite", data: { form: 2, y: 457 } },
  { id: "form-word-ignite", atSec: 170.156, kind: "diegetic:shaft-ignite", data: { form: 3, y: 101 } },

  // ── The Turn (2:56-3:06) — pure cinematic pull-back, no input. The
  //    biggest breakdown besides the intro; a bright riser under it. ──
  { id: "zone-turn", atSec: 176.0, kind: "zone:enter", data: { name: "The Turn" } },
  { id: "turn-pull-back", atSec: 176.2, kind: "camera:pan", data: { x: 5900, y: 500, ms: 9000, ease: "Sine.easeOut", zoom: 0.55 } },
  // The wide pull-back is the best vantage in the whole level — the shape
  // re-anchors into full view here, larger and closer (stage 2), still
  // unnamed. This is what the player should actually be looking at during
  // the breakdown, not empty sky.
  { id: "demiurge-third-sighting", atSec: 176.4, kind: "demiurge:manifest", data: { x: 6300, y: 420 } },
  { id: "demiurge-stage-2-early", atSec: 176.45, kind: "demiurge:stage", data: { stage: 2 } },
  // 177.8s: real onset-detected transient (librosa), not a guess.
  { id: "turn-flash-coptic", atSec: 177.8, kind: "diegetic:coptic-flash", data: COPTIC_TURN },
  // The recognition beat: for one instant the whole vessel unfurls to full
  // brightness — not a NEW power arriving, the realization that it was
  // always already whole — then recedes as the real fight approaches.
  // Distinct from the structural zone-driven openness arc (this is a
  // one-shot spike-and-recede, not a new target).
  { id: "turn-gasp", atSec: 181.0, kind: "vessel:gasp", data: {} },
  // She's named exactly once, right here, on the recognition itself — the
  // light that guided the descent was never separate from the self being
  // recognized. Fires a beat after the gasp's spike so it reads as the
  // NAME for what was just felt, not a new arrival competing with it.
  { id: "sephia-flash", atSec: 181.6, kind: "diegetic:coptic-flash", data: COPTIC_SEPHIA },

  // ── The Vessel Answers (3:06-3:58, 52s) — the extraction. Toughest
  //    scripted dummy; the arena itself reads as sealing/collapsing as the
  //    fight escalates — rising stakes, not just a harder enemy. Full
  //    Bay-style bombast (low camera angles, hard light blooms, building
  //    shake) in the game's own liquid-light/seal vocabulary. ──
  { id: "zone-vessel-answers", atSec: 186.0, kind: "zone:enter", data: { name: "The Vessel Answers" } },
  { id: "vessel-handoff", atSec: 185.7, kind: "camera:handoff-action" },
  // Every beat below sits on a measured onset. Escalation ladder: boss
  // spell loadout upgrades at each stage (real cards → real homing/fan/
  // fire/explosive projectiles through the live build resolver), waves
  // thicken, fire cadences tighten — the per-second density genuinely
  // RISES through the final chorus instead of looping one difficulty.
  // Real boss HP pool for the climax — was defaulting to 100 (the early
  // teaching-fight scale), which a strong build could burst in ~2 seconds.
  // 900 (bumped from 800) forces a genuinely sustained fight — but TIME-
  // TO-KILL is budgeted against the FIXED song timeline, not just against
  // raw HP: starter-pistol sustained DPS is ~31 (12dmg @ 4/s, minus reload
  // gaps), so at ~25s of realistically-achievable open-fire time across
  // the fight (see the shield on/off cues below) plus ~21s of mitigated
  // shield-phase time (each crack cycle = 3 absorbed hits then a real
  // 950ms damage window), a competent player lands roughly on-pace with
  // vessel-clear at 232.246s — not comfortably early, not a hard wall.
  // The real "not just a health gate" lever is the shield PHASE below
  // (vessel-shield-on/off, split into two pulses so it reads as a
  // repeating ability/rhythm, not one long DPS-suppression block): raw HP
  // alone just makes a fight feel spongy, not hard.
  { id: "vessel-dummy-spawn", atSec: 186.329, kind: "dummy:spawn", data: { x: 7000, y: 900, health: 900 } },
  // YELDABAOTH MANIFESTS — the crystalline lion-headed serpent coils over
  // the whole finale (render-only presence; the fight stays the archon +
  // waves — the serpent is why the fight MATTERS). Named exactly once.
  { id: "demiurge-manifest", atSec: 186.329, kind: "demiurge:manifest", data: { x: 6800, y: 430 } },
  { id: "demiurge-name", atSec: 187.06, kind: "diegetic:coptic-flash", data: COPTIC_DEMIURGE },
  { id: "vessel-boss-cards-1", atSec: 186.4, kind: "dummy:cards", data: { cards: ["triple-fan", "molten-core"] } },
  { id: "vessel-goal-1", atSec: 186.45, kind: "dummy:goal", data: { mode: "return-fire", fireIntervalMs: 1300 } },
  { id: "vessel-accent-1", atSec: 190.497, kind: "camera:shake", data: { amount: 0.35 } },
  { id: "vessel-seal-warn-1", atSec: 196.0, kind: "diegetic:seal-collapse", data: { stage: 1 } },
  { id: "demiurge-stage-1", atSec: 196.0, kind: "demiurge:stage", data: { stage: 1 } },
  { id: "vessel-wave-1", atSec: 196.0, kind: "horde:wave", data: { count: 3, xMin: 6200, xMax: 7400, fireIntervalMs: 1700, health: 36 } },
  // ACT 2 begins: Estaphaios raises its own directional shield (the same
  // frontal-arc mitigation the warder tier uses — see tutorialDuel.ts's
  // SHIELD_* constants). TWO pulses, not one long block — a shield that's
  // up for the whole middle third reads as "the fight is on pause"; two
  // shorter pulses with a real open-fire gap between them read as a
  // repeating ABILITY (raise → forces the crack-window rhythm → drops →
  // full damage → raises again), which is what makes it feel ability-
  // driven instead of just a bigger damage sponge.
  { id: "vessel-shield-on", atSec: 196.05, kind: "dummy:shield", data: { on: 1 } },
  { id: "vessel-accent-2", atSec: 201.004, kind: "camera:shake", data: { amount: 0.35 } },
  { id: "vessel-boss-cards-2", atSec: 206.135, kind: "dummy:cards", data: { cards: ["five-shard-spray", "seeker-facets"] } },
  { id: "vessel-goal-2", atSec: 206.135, kind: "dummy:goal", data: { mode: "telegraphed-shot", fireIntervalMs: 1000 } },
  // The climax is where the Aegis dash/parry timing taught back in The
  // Response (124.45s) actually gets TESTED under real stakes — 1000ms is
  // the fastest telegraphed cadence of the whole level. Same real windup
  // (TutorialDummyDirector.telegraphProgress()) as everywhere else, just
  // less room between volleys to recover if the read is wrong.
  { id: "vessel-dash-invite", atSec: 206.3, kind: "diegetic:dash-invite", data: {} },
  // First open window: the shield drops for ~5s right after cards-2 lands
  // — a real "it's open, capitalize" beat before the wave/cascade pressure
  // below forces attention elsewhere.
  { id: "vessel-shield-off-1", atSec: 208.0, kind: "dummy:shield", data: { on: 0 } },
  { id: "vessel-accent-3", atSec: 210.651, kind: "camera:shake", data: { amount: 0.4 } },
  { id: "vessel-shield-on-2", atSec: 213.0, kind: "dummy:shield", data: { on: 1 } },
  { id: "vessel-seal-warn-2", atSec: 215.992, kind: "diegetic:seal-collapse", data: { stage: 2 } },
  { id: "demiurge-stage-2", atSec: 215.992, kind: "demiurge:stage", data: { stage: 2 } },
  // No explicit health here — facet tier's real 55hp default (vs
  // splinter's 24) now backs up its bigger, slower-spinning silhouette.
  // CASCADE: this is the break — kill one, two more arrive, up to 2
  // generations (capped, not infinite — it resolves at vessel-clear/stage
  // 3 below). The point isn't to be beaten here; it's for the threat to
  // visibly outpace clearing it so running/repositioning becomes the
  // obviously correct read, not a failure state.
  { id: "vessel-wave-2", atSec: 215.992, kind: "horde:wave", data: { count: 4, xMin: 6150, xMax: 7450, fireIntervalMs: 1400, tier: "facet", cascade: { spawnOnDeath: 2, maxGenerations: 2 } } },
  { id: "vessel-accent-4", atSec: 219.788, kind: "camera:shake", data: { amount: 0.4 } },
  { id: "vessel-boss-cards-3", atSec: 224.467, kind: "dummy:cards", data: { cards: ["five-shard-spray", "explosive-facet", "seeker-facets"] } },
  { id: "vessel-goal-3", atSec: 224.467, kind: "dummy:goal", data: { mode: "return-fire", fireIntervalMs: 800 } },
  // ACT 3, the finisher: the shield comes down for good right as the boss's
  // own fire cadence goes fastest (800ms) and the board is about to wipe —
  // a real "it's open, go" moment instead of the fight just petering out.
  { id: "vessel-shield-off-2", atSec: 224.4, kind: "dummy:shield", data: { on: 0 } },
  { id: "vessel-accent-5", atSec: 228.426, kind: "camera:shake", data: { amount: 0.45 } },
  // Stage 3: the board wipes — the last beat belongs to the Vessel alone,
  // face to face, everything the realm sent already returned to light.
  { id: "vessel-seal-warn-3", atSec: 232.246, kind: "diegetic:seal-collapse", data: { stage: 3 } },
  { id: "demiurge-stage-3", atSec: 232.246, kind: "demiurge:stage", data: { stage: 3 } },
  { id: "vessel-clear", atSec: 232.246, kind: "horde:clear", data: {} },
  { id: "vessel-final-shake", atSec: 235.961, kind: "camera:shake", data: { amount: 1.2 } },

  // ── Silence, again (3:58-4:06) — the burst-out, not a fade. Dummy
  //    dissolves, one hard flash, then the camera pulls into a wide,
  //    settled hold that reads as "we're out" before handing off to menu. ──
  { id: "zone-outro", atSec: 238.0, kind: "zone:enter", data: { name: "Silence, again" } },
  { id: "demiurge-banish", atSec: 238.0, kind: "demiurge:banish", data: {} },
  { id: "outro-dummy-dissolve", atSec: 238.1, kind: "diegetic:dummy-dissolve", data: {} },
  // Bigger payoff than anything else in the piece — this IS the loudest
  // moment: a longer flash + the hardest shake in the whole run, both
  // exceeding vessel-final-shake's 1.2. "Both FX punch and a visible power
  // display" per the user's own steer on the ending.
  { id: "outro-burst-flash", atSec: 238.3, kind: "camera:flash", data: { ms: 480 } },
  { id: "outro-burst-shake", atSec: 238.3, kind: "camera:shake", data: { amount: 1.8 } },
  { id: "hero:victory-pose", atSec: 238.35, kind: "hero:victory-pose", data: { holdMs: 6800 } },
  { id: "outro-punch-zoom", atSec: 238.4, kind: "camera:handoff-director" },
  { id: "outro-pull-wide", atSec: 238.6, kind: "camera:pan", data: { x: 7700, y: 900, ms: 6500, ease: "Sine.easeOut", zoom: 0.85 } },
  // 239.25s: real onset-detected transient (librosa), not a guess.
  { id: "outro-coptic-whisper", atSec: 239.25, kind: "diegetic:coptic-flash", data: COPTIC_OUTRO },
  { id: "outro-hold", atSec: 245.0, kind: "camera:snap", data: { x: 7700, y: 900, zoom: 0.85 } },
  { id: "song-end", atSec: 246.3, kind: "duel:complete", data: {} },
];
