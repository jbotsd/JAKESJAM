import Phaser from "phaser";
import type { ClassId, Vec2 } from "../types/game";
import { PALETTE } from "../ui/palette.js";
import { getRenderScale } from "../render/renderResolution.js";
import { type SpringState, springKick, springState, springTo } from "./spring";
import { getSonicField } from "../systems/SonicField.js";
import { drawPortraitBadge, shadeColor } from "../render/portraitBadge.js";
import { headCrestGeometry, headHoodGeometry } from "./chassisSilhouette";
import type { AbilityKind } from "../../sim/data/cardTypes.js";
import { ABILITY_ANIMATIONS } from "../render/abilityAnimation.js";
import {
  appendBladeTip,
  meleeBladeDrawParams,
  meleeBladeTip,
  meleeHandPose,
  meleeKineticChain,
  meleeOffhandPose,
  meleeStage,
} from "../render/meleeTiming.js";
import {
  drawBladeSwing,
  drawKindledSwing,
  INTERSTICE_TINT,
  KINDRED_TINT,
} from "../render/LightConstruct.js";

/** The minimal surface SimEventRouter drives on ANY on-screen combatant —
 *  hero, boss, or a non-humanoid thrall (see TutorialShardThrall.ts). Kept
 *  separate from the full ProceduralPlayerRig class so enemy races that
 *  don't share its humanoid skeleton (and shouldn't — a recolored player
 *  rig reads as a clone army, not a distinct enemy) can still receive the
 *  same hit/fire/parry feedback without pretending to be a player. */
export interface CombatRig {
  setVisible(visible: boolean): void;
  triggerFire(hand?: 0 | 1): void;
  triggerHit(dirX: number, dirY: number): void;
  triggerParryFlash(): void;
  triggerKillPulse(): void;
  triggerMeleeSwing?(style: "interstice" | "kindred", dir: number): void;
  triggerAbility?(kind: AbilityKind): void;
  destroy(): void;
}

/**
 * ProceduralPlayerRig - AAA-quality procedural character renderer.
 *
 * Renders a "gnostic vessel" — a ghost operating a lean biomechanical
 * frame — using filled polygons, not wireframe lines. Slimmer than a
 * true-armored build (a manufactured shell, not a tank), but stays
 * bipedal and readable at 30-60px: a visor-seam of light for a face,
 * a glowing spine conduit, crystal joint stubs, a crystal-tech arm cannon.
 *
 * Design references: Warframe (biomechanical-vessel silhouette, "a ghost
 * in a frame"), Hyper Light Drifter (crystal-tech glow), Nuclear Throne
 * (weight/impact, dialed back from "chunky" to "lean").
 *
 * `accentColor` (default crystal cyan) is the cosmetic-skin seam — swap it
 * per player to reskin the glow (visor/spine/cannon/crystal stubs) without
 * touching geometry. Purely visual; never read by the sim.
 *
 * Performance: ~0.3ms per character at 60fps. All procedural, no textures.
 */

export type ProceduralPlayerRigOptions = {
  color: number;
  name: string;
  scale?: number;
  /**
   * Cosmetic accent — the general "energy" channel: spine conduit, shield/
   * parry FX, dash trail, hip-drape trim, nameplate badge ring. Defaults to
   * crystal cyan. See visorColor/palmColor/jointColor/auraColor below for
   * the anatomically-distinct channels split out from this one (Vessel
   * Creator design, docs/vessel-creator-design.md §3/§6.1) — each of THOSE
   * defaults to accentColor when unset, so a rig built with only
   * `accentColor` (every rig today) renders pixel-identical to before this
   * split: zero visual regression is the hard requirement this exists to
   * satisfy, not a stylistic preference.
   */
  accentColor?: number;
  /** Visor seam + head-crest accent — the vessel's "face." */
  visorColor?: number;
  /** Hand-channel glow + shuriken — the palm projector, JAKESJAM's
   *  Warframe-"Energy-on-weapon" / Syandana-adjacent highest-frequency-seen
   *  channel (visible on every shot). */
  palmColor?: number;
  /** Shoulder stub — "crystal joint seal," the Warframe-Armor-slot analog. */
  jointColor?: number;
  /** Mad aura motes — the field-around-vessel effect; the one channel with
   *  no Warframe/Fortnite direct analog, native to JAKESJAM. */
  auraColor?: number;
  /**
   * Chassis silhouette (docs/chassis-design-axioms.md CA3) — branches the
   * head-crest + hood geometry per class (chassisSilhouette.ts). Defaults
   * to `"wizard"` when omitted, which reproduces the EXACT pre-existing
   * helmet geometry every caller drew before this option existed: a rig
   * built without `classId` (every caller today — MainMenuScene,
   * TutorialScene, MatchScene, HangoutScene) is byte-identical to before
   * this option was added. Only OnlineMatchScene.makePlayerRig passes a
   * real classId as of this pass (arena-only scope). Never touches
   * body/torso/limb geometry (CA1 — "one body, four accents").
   */
  classId?: ClassId;
  /**
   * Seed for the nameplate portrait badge's generated sigil (portraitBadge.ts)
   * — pass the actual playerId for real per-connection uniqueness; falls
   * back to `name` when omitted (fine for bots, whose name IS already
   * distinct per bot). Not a cosmetic choice — every distinct seed must
   * produce a distinct sigil, or the badge collapses back into the
   * color-only-differentiation failure mode this system replaced.
   */
  identitySeed?: string;
  /**
   * `full` = local / hero (aura + trail + full secondary motion).
   * `lite` = remotes/bots — fewer path ops so multi-player frames stay smooth.
   */
  detail?: "full" | "lite";
};

export type ProceduralPlayerPose = {
  position: Vec2;
  velocity: Vec2;
  aimTarget: Vec2;
  grounded: boolean;
  crouching: boolean;
  health?: number;
  maxHealth?: number;
  /** -1/0/+1: which side (if any) the player is gripping a wall on. */
  touchingWallDir?: number;
  /** True while a dash is active. */
  dashing?: boolean;
  /** Wide Parry: multiplies the 120° dash-bash cone (1 = base, 1.28 = one stack). */
  shieldArcScale?: number;
  /** Crystal Plating stacks: draw a hex shell outline on the body. */
  platingGlow?: number;
};

export type LimbSolve = {
  joint: Vec2;
  end: Vec2;
};

// --- Colour Constants ---
const DARK = 0x07101c;
const DARK2 = 0x0f1a2e;
const WHITE = 0xf7fbff;
// Sapphire Conduit (2026-07-15 palette pivot) — the vessel's own inner-light
// identity default, same hue family as the void/hull structure (H262°), not
// a loadout property. See palette.ts's header comment for the full
// rationale. A purchased cosmetic skin can still set accentColor to
// anything (gold included) — only the *default* moved.
const ACCENT = 0x3c79f0;

export class ProceduralPlayerRig implements CombatRig {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly nameText: Phaser.GameObjects.Text;
  protected readonly color: number;
  protected readonly colorDark: number;
  protected readonly accentColor: number;
  /** Vessel Creator channels — see ProceduralPlayerRigOptions' docblock. */
  protected readonly visorColor: number;
  protected readonly palmColor: number;
  protected readonly jointColor: number;
  protected readonly auraColor: number;
  /** Chassis silhouette branch — see ProceduralPlayerRigOptions.classId. */
  protected readonly classId: ClassId;
  private readonly name: string;
  private readonly identitySeed: string;
  protected readonly scale: number;
  private readonly detail: "full" | "lite";
  private stepPhase = 0;
  /** Continuous facing −1..+1 (eases flips — no whole-body IK flip pop). */
  private facingSmooth = 1;
  private facing = 1;
  /** Smoothed crouch 0..1 — eases pelvis height so crouch/uncrouch doesn't pop. */
  private crouchBlend = 0;
  private static readonly CROUCH_BLEND_TAU_MS = 70;
  // ── Dance groove (2026-07-13, Jake: "rotate my arms around like I
  // rotate the mouse in a circle... lean deeply into that... rhythm sync
  // and player-controllable motion has a dancing effect"; restyled
  // 2026-07-15, Jake: "study a bumpin club dude, like Skrillex — tempo
  // sync to the current song") ──────────────────────────────────────────
  // The aim-orbit shoulder rotation (perp vector, below) ALREADY swings
  // the arms around the body as the mouse circles — that's the arm-swirl
  // dubstep-dance reference points at, already wired as the trigger
  // gesture. This layer leans into it: grounded + idle + actively
  // spinning the aim (not just re-aiming at a target) triggers a springed
  // "danceEnergy" that drives a beat-synced hip sway + bounce riding the
  // EXISTING idle-life pipeline (breathe/weightShift). The 2026-07-15 pass
  // adds a REAL beat-reactive hit: SonicField's `beat` transient (main.ts
  // tickMusicIntensity — hard-attack/soft-decay bass onset envelope,
  // computed from whatever's actually playing, no fake BPM guess) is
  // rising-edge-detected below and kicks an underdamped impulse spring —
  // headbang + chest-pop snap on the ACTUAL bass hits of the current
  // song, not a canned loop. The always-ticking groovePhase sine stays as
  // the silent-fallback base layer (never fully static with no music);
  // the impulse is what makes it read as "going IN" on the drop.
  /** Raw aim angle one frame ago (body-relative, NOT chest-relative — this
   *  is only a spin-speed detector, precision doesn't matter). */
  private prevAimAngle = 0;
  private prevAimAngleValid = false;
  /** Smoothed |dAimAngle/dt|, rad/s — "is the player circling the mouse". */
  private aimAngularVel = 0;
  /** 0..1, springed — how much the dance groove should show right now. */
  private danceEnergy = 0;
  private static readonly DANCE_SPIN_THRESHOLD_RADPS = 2.4;
  private static readonly DANCE_ATTACK_MS = 260;
  private static readonly DANCE_RELEASE_MS = 900;
  /** Always-ticking groove clock (~2.35Hz ≈ 141bpm quarter notes — EDM/
   *  dubstep tempo territory) — the silent-fallback rhythm so dancing
   *  still reads as intentional with no music playing. This is the SMOOTH
   *  base layer only; the sharp "hit" character comes from beatHitSpring
   *  below, which reacts to real transients rather than re-timing this
   *  phase (avoids phase-lock drift/latency against imprecise audio
   *  timing — see beatHitSpring's comment for the actual sync mechanism). */
  private groovePhase = 0;
  private static readonly GROOVE_HZ = 2.35;
  /** Previous-frame SonicField.beat (bass-transient envelope, main.ts
   *  tickMusicIntensity) — rising-edge detector for kicking beatHitSpring.
   *  This is the REAL tempo-sync mechanism: no BPM is known or guessed for
   *  in-match music (unlike TutorialScene's hand-authored SongDirector
   *  cues, which only exist for that one fixed track), so instead of
   *  faking a beat grid, the hit reaction fires directly off the live
   *  audio analyser's actual detected bass onsets. */
  private prevBeatEnv = 0;
  /** Underdamped impulse spring — kicked hard on a detected beat onset,
   *  rings down naturally (springTo below with a low damping ratio does
   *  the "snap then settle" shape, no separate envelope needed). Drives
   *  the headbang snap + chest-pop punch layered on top of the smooth
   *  groove sine — this is what makes the reaction read as "hitting" the
   *  actual drop instead of just swaying near it. */
  private beatHitSpring: SpringState = springState(0);
  private static readonly BEAT_HIT_THRESHOLD = 0.35;
  private static readonly BEAT_HIT_RISE_DELTA = 0.12;
  // Tuned so the underdamped spring below peaks at beatHitSpring.value ≈ 1.0
  // at full kick (verified: peak ≈ kick * 0.0147 for FREQ_HZ=7.5/DAMP=0.32
  // — an underdamped kicked spring's peak is NOT 1:1 with kick velocity,
  // it's velDelta/omega_d scaled by the decay-to-peak-time factor). Keeping
  // beatHit in a clean ~0..1 range makes the px multipliers downstream
  // directly comparable to the existing groove-amplitude multipliers
  // (which are also ~0..1-scaled), instead of needing their own arbitrary
  // scale.
  private static readonly BEAT_HIT_KICK = 68;
  private static readonly BEAT_HIT_FREQ_HZ = 7.5;
  private static readonly BEAT_HIT_DAMP = 0.32;
  // ── Perth Shuffle footwork + spasmodic dotted-time throws (2026-07-15,
  // Jake: "the Perth Shuffle... it's sentimental, it's significant" +
  // "throw the arms out too rhythmically spasmodically... in dotted time
  // SOME of the time") ───────────────────────────────────────────────────
  // Researched, not guessed: Melbourne Shuffle's two core steps (Perth's
  // scene ran the same core vocabulary — same footwork, local community,
  // see the "Perth Shuffle Meetup"/"Shuffling In Perth City" reference
  // videos) are the Running Man (one foot kicks forward while the other
  // slides back, weight evenly shared, alternating — the "moving forward
  // while staying in place" illusion) and the T-step (a lateral kick +
  // pivot for side travel). This 2D side-view rig has no true depth axis
  // for a literal lateral T-step, so it's approximated as a stance-width
  // pulse (feet momentarily spread/narrow) riding on the same clock —
  // this is the honest 2D-silhouette read of that move, not the literal
  // 3-axis technique. Previously feet were COMPLETELY STATIC while
  // idle-dancing (footPos's stride/lift/drunkFoot terms are all `* walk`,
  // which is 0 when idle) — all motion was upper-body. This adds the
  // first idle-dance leg motion the rig has ever had.
  private static readonly SHUFFLE_STEP_HZ_MULT = 1.4; // relative to GROOVE_HZ — faster than the torso bounce, real shuffle footwork is busier than the beat itself
  private static readonly SHUFFLE_STRIDE_PX = 13;
  private static readonly SHUFFLE_LIFT_PX = 6;
  private static readonly SHUFFLE_SPREAD_PULSE_PX = 4; // T-step approximation
  /** Rising-edge-detected beat hits sometimes ALSO fire a wide, spasmodic
   *  arm throw-out (not the smooth fist-pump punch — a sudden extended
   *  fling) — genuinely randomized per hit (Math.random is fine here, this
   *  is pure render/cosmetic code with zero determinism requirement,
   *  unlike sim/ code), so it reads as spontaneous flailing rather than a
   *  fixed pattern. A separate roll schedules some throws on a DOTTED
   *  subdivision (1.5x the just-measured beat interval) instead of firing
   *  immediately — syncopated, off the main pulse, "spasmodic" rather than
   *  metronomic. prevBeatHitMs tracks wall-clock-equivalent (accumulated
   *  deltaMs) time of the last hit to measure that interval live from
   *  whatever's actually playing, same honesty rule as beatHitSpring. */
  private msClock = 0;
  private lastBeatHitMs = 0;
  private beatIntervalEstimateMs = 500;
  private dottedThrowAtMs = -1; // -1 = none scheduled
  private dottedThrowHand: 0 | 1 = 0;
  private static readonly THROW_CHANCE = 0.45;
  private static readonly DOTTED_THROW_CHANCE = 0.22;
  private static readonly THROW_KICK = 620;
  // ── Pop-and-lock arm poses (2026-07-15, Jake: "elbows and hand pop and
  // lock freely like the beat on each bar knocks them into the next
  // motion") — researched: real popping/locking is a sharp muscle "hit"
  // that snaps into a held freeze pose (locking) rather than continuous
  // flowing motion; the snap itself matters as much as the pose. This
  // REPLACES the old continuous sine-wobble raised-arm target: instead of
  // a target that's always drifting, the target now only changes once per
  // bar (every 4th detected beat hit — standard 4/4 assumption, matches
  // house/EDM), landing on a freshly randomized WIDE elbows-out offset
  // each time ("freely" — not a fixed repeating pattern), then holding
  // completely still (locked) until the next bar. The already-tight
  // armFreq/armDamp spring (see computeArmTargets) delivers the snap; this
  // just makes the TARGET itself discrete instead of continuously moving. */
  private barBeatCounter = 0;
  private static readonly BAR_BEATS = 4;
  // Non-zero defaults (not 0,0) so the pose reads as an intentional wide
  // hold from the very first frame of dancing, not a collapsed pose while
  // waiting for the first bar to complete.
  private lockLeadOffsetX = 18;
  private lockLeadOffsetY = -18;
  private lockBackOffsetX = -16;
  private lockBackOffsetY = -16;
  // Second, SLOWER/softer oscillator layered on the elbow itself (not the
  // hand) — a literal pendulum-on-a-pendulum: the hand spring (armFreq
  // ~5.2-7.2Hz) is the fast outer swing, this is the lagging inner joint
  // (Jake: "think of a pendulum on a pendulum, the end of a pendulum").
  // Perturbs solveTwoBone's `bend` multiplier by a few % so the elbow
  // visibly keeps swinging/settling on its own after the hand has already
  // snapped onto its locked target, instead of the elbow being a mute
  // point that's 100% geometrically implied by the hand position.
  private leadElbowWobble: SpringState = springState(0);
  private backElbowWobble: SpringState = springState(0);
  private static readonly ELBOW_WOBBLE_FREQ_HZ = 2.6;
  private static readonly ELBOW_WOBBLE_DAMP = 0.28;
  private static readonly ELBOW_WOBBLE_KICK = 3.4;
  /** ms of sustained high dance energy, clamped to DANCE_RAISE_BUILD_MS —
   *  climbs while dancing, falls back down (faster than it climbs) once
   *  the energy gate drops. Not a one-shot trigger: this directly drives
   *  danceRaise below, so a longer sustained groove keeps lifting the arms
   *  higher and higher rather than popping into one fixed pose. */
  private idleDanceMs = 0;
  private static readonly DANCE_RAISE_GATE = 0.55;
  private static readonly DANCE_RAISE_BUILD_MS = 4200;
  private static readonly DANCE_RAISE_FALL_RATE = 2.4; // ms of idleDanceMs lost per ms once you stop
  /** Smoothed 0..1 — how far the fists have climbed toward the raised
   *  overhead pump pose. Eased against idleDanceMs/BUILD_MS so the climb
   *  (and the fall back to hanging) is a continuous lift, never a snap.
   *  computeArmTargets blends the hang and raised targets by this value. */
  private danceRaise = 0;
  /** Optional external audio-driven glow input, 0..~1 — e.g. TutorialScene
   *  feeding a real isolated-vocal-stem envelope so the hero visibly sings
   *  along (see TutorialStemAnalyser). Purely additive to danceGlowBoost;
   *  never set by MatchScene/OnlineMatchScene, so it defaults to 0 and
   *  changes nothing for them. */
  externalAudioBoost = 0;
  /** Optional external CameraHype input, 0..1 — OnlineMatchScene feeds the
   *  local player's ~20s sustained-dance camera-hype accumulator here so the
   *  peak "you kept it going" moment reads through the SAME lighting
   *  language as everything else (danceGlowBoost, below), not a separate
   *  screen-space effect. Purely additive; defaults to 0, so scenes that
   *  never set it (Tutorial, practice) are unaffected. */
  externalHypeBoost = 0;
  /** Smoothed |vx| walk weight — kills step-phase stutter from sim velocity steps. */
  private walkBlend = 0;
  /** Smoothed SPRINT weight: 0 through walk speeds, 1 approaching max ground
   *  speed (330). Drives the run-cycle restyle studied from stick-figure run
   *  reference footage (5-key sprint cycle: drive → flight → reach → contact
   *  → gather-squash): an upright jog at low speed becomes a deep-lean
   *  attack sprint at full tilt, instead of one gait scaled by volume. */
  private sprintBlend = 0;
  /** Previous-frame vx — reversal detection for the stumble kick. */
  private prevVelX = 0;
  /** Smoothed horizontal acceleration (px/s²) — drives the Disney layer:
   *  anticipation lean on launch (slow-out) and brake lean on deceleration
   *  (slow-in). Velocity says how fast; acceleration says what the body is
   *  TRYING to do — that intent is what reads as personality. */
  private accelSmooth = 0;
  /** Landing/launch cushion spring (px, +down on the body chain): kicked by
   *  impacts and launches, settles underdamped — the dip-and-rebound that
   *  makes weight read (Disney: squash on contact, cushion the recovery). */
  private landCushion: SpringState = springState(0);
  /** Idle life clock — breathing + weight-shift phases (appeal: the vessel
   *  is alive even when nothing is happening). */
  private idlePhase = Math.random() * Math.PI * 2;
  /** Smoothed airborne pose axis: +1 rising (legs TUCK, knees up), -1
   *  falling (lead leg REACHES for the landing, back leg folds). Replaces
   *  the old airborne behavior of feet dangling at full extension and
   *  swinging with the (meaningless mid-air) stride cycle — the "silly
   *  jump." */
  private airPose = 0;
  /** ms remaining in the combat stance after the last shot — outside this
   *  window the arms are ARMS (hang at rest, swing while walking), not a
   *  permanent shuriken-cocked pose. Set by triggerFire, decays in update. */
  private combatHoldMs = 0;
  /** One-shot: the next draw() velocity-kicks the throwing hand's spring
   *  along aim, so a shot from ANY stance (hang, walk, sweep) pops as one
   *  crisp whip instead of a spring easing across the whole journey. */
  private pendingThrowKick = false;
  /** ms remaining in the outro's victory/induction pose — arms raised wide
   *  overhead, the physical beat of the recognition being SEALED (see
   *  tutorial-song.ts's hero:victory-pose cue). Highest priority in the
   *  arm ladder: overrides combat/sprint/idle entirely while active. */
  private victoryPoseMs = 0;
  private static readonly WALK_BLEND_TAU_MS = 55;
  private static readonly FACING_TAU_MS = 90;
  private firePulse = 0;
  // ALTERNATING SHURIKEN THROW. The two hands throw independently and take
  // turns: each shot flicks ONE hand out toward aim (a fast shuriken snap)
  // while the other stays ready, then alternates. `throwHand` is whose turn
  // it is; `leadThrow`/`backThrow` (0-1) are each hand's own flick progress,
  // set to 1 on that hand's shot and decaying over FIRE_RECOIL_MS. The
  // projectile leaves from the throwing hand at the peak of its flick.
  private throwHand: 0 | 1 = 0;
  private leadThrow = 0;
  private backThrow = 0;
  private static readonly FIRE_RECOIL_MS = 200;
  private meleePoseMs = 0;
  private meleePoseDurationMs = 1;
  private meleePoseStyle: "interstice" | "kindred" = "interstice";
  private meleePoseDir = 1;
  // Live blade-tip trail for the Kindled Edge's swept-ribbon read
  // (drawKindledSwing's tipHistory param) — sampled once per frame while a
  // swing is active, cleared on the next triggerMeleeSwing(). Deliberately a
  // per-frame accumulator, not the offline construct-harness's analytic
  // whole-timeline precompute (that only works because the harness is
  // scrubbing a fixed, already-known duration; live play only knows "now").
  private meleeTipHistory: { x: number; y: number }[] = [];
  private static readonly MELEE_TIP_HISTORY_MAX = 24;
  private abilityPoseMs = 0;
  private abilityPoseDurationMs = 1;
  private abilityPoseKind: AbilityKind = "sunlance";
  // Spin phase for the held/thrown shuriken shards (wall-clock, visual only).
  private shurikenSpin = 0;
  // Visual-only knockback. Set by triggerHit(); decays over HIT_DECAY_MS.
  // Per game-feel-juice §5 — render layer overshoots authoritative position.
  private hitOffsetX = 0;
  private hitOffsetY = 0;
  private hitDecay = 0;
  private static readonly HIT_DECAY_MS = 90;
  private readonly trailPositions: { x: number; y: number; t: number }[] = [];
  private lastTrailSampleMs = 0;
  // Parry flash — the dash-bash guard just turned an attack (slide-parry reflect,
  // timed parry, or a bash clash). Set by triggerParryFlash(); while active
  // the shield arc overdrives to white and an impact ring expands outward.
  private parryFlashMs = 0;
  private static readonly PARRY_FLASH_MS = 240;

  // Kill pulse — earned-not-bought reactive cosmetics (Vessel Creator
  // design doc §5: "a brief intensity bump on a confirmed kill... reads
  // instantly"). Set by triggerKillPulse() on the killer's rig from the
  // player-killed sim event; briefly overdrives the palm glow and the mad
  // aura's brightness/radius, same "vibes lighting" plumbing the dance
  // system already uses, so it reads as one lighting language, not a new
  // one. Zero persistence, purely a live render-layer reaction.
  private killPulseMs = 0;
  private static readonly KILL_PULSE_MS = 320;

  // Wobbly-leg secondary motion: each foot's IK target chases footPos()
  // through a spring instead of snapping to it, so plants/direction changes/
  // landings overshoot and settle. Pure render layer — solveTwoBone still
  // clamps reach, so an aggressive wobble just reads as the leg straining.
  private footSpringsReady = false;
  private footLSpringX: SpringState = springState(0);
  private footLSpringY: SpringState = springState(0);
  private footRSpringX: SpringState = springState(0);
  private footRSpringY: SpringState = springState(0);
  private wasGrounded = true;
  private prevVelY = 0;
  // Drunken-master legs: underdamped chase so plants overshoot and settle
  // (floppy) while root motion is α-smoothed so we don't ring every sim tick.
  private static readonly WOBBLE_FREQUENCY_HZ = 7.5;
  private static readonly WOBBLE_DAMPING = 0.48;
  private static readonly LANDING_KICK_SCALE = 0.42;
  private static readonly LANDING_KICK_MAX = 820;

  // Wall-jump kick-off: the instant the player leaves a wall while airborne,
  // both foot springs get a velocity kick away from the wall (and up).
  private wasWallDir = 0;
  private static readonly WALL_KICK_X = 480;
  private static readonly WALL_KICK_Y = -320;

  // Torso chain lag (drunken master): lean / chest / head spring behind the
  // hip so the body reads as loose segments, not a rigid plate.
  private leanSpring: SpringState = springState(0);
  private chestLagX: SpringState = springState(0);
  private chestLagY: SpringState = springState(0);
  private headLagX: SpringState = springState(0);
  private headLagY: SpringState = springState(0);
  private static readonly TORSO_FREQ = 4.2;
  private static readonly TORSO_DAMP = 0.42;
  private static readonly HEAD_FREQ = 5.5;
  private static readonly HEAD_DAMP = 0.38;

  // Arms, rebuilt ground-up: BOTH arms are the exact same length (upper ==
  // lower, lead == back) and hang perfectly STRAIGHT by default — the
  // two-bone solve only bends when the hand target is placed closer than
  // the arm's full reach. Bending is reserved for two purposeful states:
  // gripping a wall, and the natural swing while running. Idle, airborne,
  // and dashing all keep both arms dead straight — an alien stillness that
  // breaks the instant the vessel actually moves or grabs something.
  private static readonly ARM_UPPER = 20;
  private static readonly ARM_LOWER = 20;
  private static readonly ARM_REACH = ProceduralPlayerRig.ARM_UPPER + ProceduralPlayerRig.ARM_LOWER;
  private leadHandSpringReady = false;
  private leadHandSpringX: SpringState = springState(0);
  private leadHandSpringY: SpringState = springState(0);
  private backHandSpringReady = false;
  private backHandSpringX: SpringState = springState(0);
  private backHandSpringY: SpringState = springState(0);
  // Last drawn hand positions in WORLD coords — exposed read-only so the melee
  // construct VFX can anchor a swung blade to the actual hand (not the feet).
  // Updated every draw(); read via getHandWorld(). Null until first draw.
  private lastLeadHandWorld: { x: number; y: number } | null = null;
  private lastBackHandWorld: { x: number; y: number } | null = null;
  // Floppy arms — hang late, overshoot on throw, settle soft (drunken master).
  private static readonly ARM_FREQUENCY_HZ = 5.2;
  private static readonly ARM_DAMPING = 0.52;

  // Hip drape — cloth whip, very underdamped.
  private drapeSpringReady = false;
  private drapeSpringX: SpringState = springState(0);
  private drapeSpringY: SpringState = springState(0);
  private static readonly DRAPE_FREQUENCY_HZ = 3.8;
  private static readonly DRAPE_DAMPING = 0.28;

  // "Mad aura" — fewer motes on lite; full still irregular (not a UI ring).
  private static readonly AURA_MOTE_COUNT = 8;
  private static readonly AURA_MOTE_LITE = 3;
  private readonly auraSeed = Math.random() * Math.PI * 2;

  constructor(scene: Phaser.Scene, options: ProceduralPlayerRigOptions) {
    // Depth 12: above arena near-layer (~-4), platforms, pickups, fire, beams.
    // Players must own the mid-frame silhouette over cosmic vault chrome.
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(12);
    // Space Mono + a warm gold tint — the house font used everywhere else
    // in the game's own HUD/numerics (index.html's font stack). Generic
    // "Inter, Arial" here was a real seam: everything around it is
    // stylized sacred-geometry gold/cyan, and the nameplate was plain
    // default web text with zero relationship to that language.
    this.nameText = scene.add
      .text(0, 0, options.name, {
        color: "#e8c992",
        fontFamily: '"Space Mono", monospace',
        // Touch screens sit further from the eye per CSS px — 11px plates
        // were illegible on phones (cosmetic only; no pose/draw change).
        fontSize: `${Math.round((window.matchMedia?.("(pointer: coarse)")?.matches ? 14 : 11) * (options.scale ?? 1))}px`,
        fontStyle: "700",
        // Glyph texture density must match the DPR-aware backing store or
        // names blur on phones (crispness only — no pose/draw change).
        resolution: Math.max(1, getRenderScale()),
      })
      .setOrigin(0.5, 1)
      .setDepth(13)
      .setStroke("#05080f", 3)
      .setShadow(0, 0, "#ffd76b", 6, false, true);
    this.color = options.color;
    this.colorDark = shadeColor(options.color, -0.4);
    this.accentColor = options.accentColor ?? ACCENT;
    this.visorColor = options.visorColor ?? this.accentColor;
    this.palmColor = options.palmColor ?? this.accentColor;
    this.jointColor = options.jointColor ?? this.accentColor;
    this.auraColor = options.auraColor ?? this.accentColor;
    this.classId = options.classId ?? "wizard";
    this.name = options.name;
    this.identitySeed = options.identitySeed ?? options.name;
    this.scale = options.scale ?? 1;
    this.detail = options.detail ?? "full";
  }

  private lastDrawX = 0;
  private lastDrawY = 0;

  update(deltaMs: number, pose: ProceduralPlayerPose) {
    this.lastDrawX = pose.position.x;
    this.lastDrawY = pose.position.y;
    if (!this.graphics.visible) return;

    const walkTarget = Phaser.Math.Clamp(Math.abs(pose.velocity.x) / 180, 0, 1);
    if (deltaMs > 0) {
      const wk = 1 - Math.exp(-deltaMs / ProceduralPlayerRig.WALK_BLEND_TAU_MS);
      this.walkBlend += (walkTarget - this.walkBlend) * wk;
    } else {
      this.walkBlend = walkTarget;
    }
    const walkAmount = this.walkBlend;
    const sprintTarget = Phaser.Math.Clamp((Math.abs(pose.velocity.x) - 140) / 170, 0, 1);
    if (deltaMs > 0) {
      const sk = 1 - Math.exp(-deltaMs / ProceduralPlayerRig.WALK_BLEND_TAU_MS);
      this.sprintBlend += (sprintTarget - this.sprintBlend) * sk;
    } else {
      this.sprintBlend = sprintTarget;
    }
    // Cadence rises with sprint on top of the walk rate — a sprint is a
    // faster cycle, not just a bigger one. A slow ±5% drift on the rate
    // keeps the cycle from ever being metronome-perfect (perfectly even
    // timing is the single biggest "robot" tell).
    this.stepPhase +=
      deltaMs *
      (0.006 + walkAmount * 0.01 + this.sprintBlend * 0.0045) *
      (1 + Math.sin(this.stepPhase * 0.37) * 0.05);
    this.firePulse = Math.max(0, this.firePulse - deltaMs * 0.004);
    this.leadThrow = Math.max(0, this.leadThrow - deltaMs / ProceduralPlayerRig.FIRE_RECOIL_MS);
    this.backThrow = Math.max(0, this.backThrow - deltaMs / ProceduralPlayerRig.FIRE_RECOIL_MS);
    this.shurikenSpin += deltaMs * 0.02;
    this.hitDecay = Math.max(0, this.hitDecay - deltaMs / ProceduralPlayerRig.HIT_DECAY_MS);
    this.parryFlashMs = Math.max(0, this.parryFlashMs - deltaMs);
    this.killPulseMs = Math.max(0, this.killPulseMs - deltaMs);
    this.combatHoldMs = Math.max(0, this.combatHoldMs - deltaMs);
    this.victoryPoseMs = Math.max(0, this.victoryPoseMs - deltaMs);
    this.meleePoseMs = Math.max(0, this.meleePoseMs - deltaMs);
    this.abilityPoseMs = Math.max(0, this.abilityPoseMs - deltaMs);

    // Facing target with hysteresis, then smooth ease so IK bend doesn't pop.
    let facingTarget = this.facingSmooth >= 0 ? 1 : -1;
    if (Math.abs(pose.velocity.x) > 18) {
      facingTarget = Math.sign(pose.velocity.x);
    } else if (
      Math.abs(pose.velocity.x) < 6 &&
      Math.abs(pose.aimTarget.x - pose.position.x) > 28
    ) {
      facingTarget = Math.sign(pose.aimTarget.x - pose.position.x);
    }
    if (deltaMs > 0) {
      const fk = 1 - Math.exp(-deltaMs / ProceduralPlayerRig.FACING_TAU_MS);
      this.facingSmooth += (facingTarget - this.facingSmooth) * fk;
    }
    this.facing = this.facingSmooth >= 0 ? 1 : -1;

    // Aim spin-speed detector: body-relative (not chest-relative — a spin
    // detector doesn't need that precision), sampled BEFORE pelvis/chest
    // are known so it's cheap and independent of the rest of the pose.
    if (deltaMs > 0) {
      const rawAimAngle = Math.atan2(
        pose.aimTarget.y - pose.position.y,
        pose.aimTarget.x - pose.position.x,
      );
      if (this.prevAimAngleValid) {
        // Wrap the delta to [-PI, PI] so crossing the +/-PI seam doesn't
        // register as a huge spurious spin.
        const rawDelta = rawAimAngle - this.prevAimAngle;
        const dAngle = Math.atan2(Math.sin(rawDelta), Math.cos(rawDelta));
        const instVelRadPs = Math.abs(dAngle) / (deltaMs / 1000);
        const velK = 1 - Math.exp(-deltaMs / 140);
        this.aimAngularVel += (instVelRadPs - this.aimAngularVel) * velK;
      }
      this.prevAimAngle = rawAimAngle;
      this.prevAimAngleValid = true;
    }

    // Ease crouch so half-height / pelvis drop isn't a hard step.
    const crouchTarget = pose.crouching ? 1 : 0;
    if (deltaMs > 0) {
      const k = 1 - Math.exp(-deltaMs / ProceduralPlayerRig.CROUCH_BLEND_TAU_MS);
      this.crouchBlend += (crouchTarget - this.crouchBlend) * k;
      if (Math.abs(this.crouchBlend - crouchTarget) < 0.001) {
        this.crouchBlend = crouchTarget;
      }
    }

    // Trail sampling — local/full only (remotes skip for CPU).
    if (this.detail === "full") {
      const now = Date.now();
      if (now - this.lastTrailSampleMs >= 48) {
        this.trailPositions.push({ x: pose.position.x, y: pose.position.y, t: now });
        if (this.trailPositions.length > 5) {
          this.trailPositions.shift();
        }
        this.lastTrailSampleMs = now;
      }
    }

    // Landing impact: the frame grounded flips true, kick both foot springs'
    // vertical velocity from the fall speed carried in on the PREVIOUS frame
    // (this frame's velocity.y is typically already zeroed by the collision
    // resolve, so the pre-landing value is the one that reads as "impact").
    if (pose.grounded && !this.wasGrounded) {
      const kick = Phaser.Math.Clamp(
        this.prevVelY * ProceduralPlayerRig.LANDING_KICK_SCALE,
        -ProceduralPlayerRig.LANDING_KICK_MAX,
        ProceduralPlayerRig.LANDING_KICK_MAX,
      );
      this.footLSpringY = springKick(this.footLSpringY, kick);
      this.footRSpringY = springKick(this.footRSpringY, kick);
      // Landing cushion (Disney: squash the contact, cushion the recovery):
      // the body chain dips with the impact and rebounds underdamped —
      // kicked HERE because prevVelY still holds the true fall speed (it's
      // overwritten just below).
      this.landCushion = springKick(
        this.landCushion,
        Phaser.Math.Clamp(Math.abs(this.prevVelY) * 0.28, 0, 420),
      );
    }
    this.wasGrounded = pose.grounded;
    this.prevVelY = pose.velocity.y;

    // Wall-jump kick-off: the tick the player leaves a wall while still
    // airborne (a true wall-jump, or just sliding off the end of one — both
    // read correctly as "the legs just pushed off"), kick both feet away
    // from the wall and upward.
    const wallDir = pose.touchingWallDir ?? 0;
    if (this.wasWallDir !== 0 && wallDir === 0 && !pose.grounded) {
      const kickDir = -this.wasWallDir;
      this.footLSpringX = springKick(this.footLSpringX, kickDir * ProceduralPlayerRig.WALL_KICK_X);
      this.footRSpringX = springKick(this.footRSpringX, kickDir * ProceduralPlayerRig.WALL_KICK_X);
      this.footLSpringY = springKick(this.footLSpringY, ProceduralPlayerRig.WALL_KICK_Y);
      this.footRSpringY = springKick(this.footRSpringY, ProceduralPlayerRig.WALL_KICK_Y);
    }
    this.wasWallDir = wallDir;

    // ── The Disney layer: transitions are where personality lives. ──────
    // Smoothed acceleration = what the body INTENDS (velocity only says
    // what it's doing). Computed against last frame's vx before updating it.
    if (deltaMs > 0) {
      const rawAccel = (pose.velocity.x - this.prevVelX) / (deltaMs / 1000);
      this.accelSmooth += (rawAccel - this.accelSmooth) * (1 - Math.exp(-deltaMs / 90));
    }
    this.idlePhase += deltaMs * 0.0012;
    // Airborne pose axis: rising tucks the legs, falling reaches for the
    // landing (see airPose docblock). Smoothed so apex transitions arc.
    const airTarget = pose.grounded ? 0 : Phaser.Math.Clamp(-pose.velocity.y / 650, -1, 1);
    if (deltaMs > 0) {
      this.airPose += (airTarget - this.airPose) * (1 - Math.exp(-deltaMs / 70));
    }

    if (pose.grounded && Math.abs(this.prevVelX) > 200 && pose.velocity.x * this.prevVelX < 0) {
      // STUMBLE (reversal): the torso keeps traveling the way the momentum
      // was going (the legs stop first) — kick the lean spring toward the
      // OLD direction and let its underdamped overshoot-and-recover BE the
      // stumble; the feet get a splayed kick (one thrown ahead, one
      // dragging) for the scramble-step read. Pure secondary motion.
      const dir = Math.sign(this.prevVelX);
      this.leanSpring = springKick(this.leanSpring, dir * 240);
      this.footLSpringX = springKick(this.footLSpringX, dir * 260);
      this.footRSpringX = springKick(this.footRSpringX, -dir * 140);
      this.landCushion = springKick(this.landCushion, 120);
    } else if (pose.grounded && Math.abs(this.prevVelX) < 40 && Math.abs(pose.velocity.x) > 70) {
      // ANTICIPATION (launch): the body coils OPPOSITE the new direction
      // for a beat before the drive-lean whips it forward — the classic
      // wind-up. One backward kick on the underdamped lean spring gives
      // dip-back → whip-forward for free; the cushion kick adds the
      // crouch-coil dip under it.
      this.leanSpring = springKick(this.leanSpring, -Math.sign(pose.velocity.x) * 210);
      this.landCushion = springKick(this.landCushion, 150);
    } else if (pose.grounded && Math.abs(this.prevVelX) > 220 && Math.abs(pose.velocity.x) < 40) {
      // FOLLOW-THROUGH (hard stop): parts settle at different rates — the
      // torso pitches past the stop and recovers, one foot skids ahead,
      // the body sinks into the brake and rises out of it.
      const dir = Math.sign(this.prevVelX);
      this.leanSpring = springKick(this.leanSpring, dir * 300);
      this.footLSpringX = springKick(this.footLSpringX, dir * 230);
      this.landCushion = springKick(this.landCushion, 160);
    }
    this.prevVelX = pose.velocity.x;

    // Cushion always settles toward zero, underdamped — every kick above
    // (landing, launch coil, stop brake, stumble) dips and rebounds.
    this.landCushion = springTo(this.landCushion, 0, deltaMs, 3.4, 0.5);

    this.draw(pose, walkAmount, deltaMs);
  }

  destroy() {
    this.graphics.destroy();
    this.nameText.destroy();
  }

  /** Public read of the "circle the mouse to dance" state (see aimAngularVel
   *  above) — danceEnergy is "is the player doing it right now" (0-1,
   *  springed over ~260ms attack / 900ms release), danceRaise is "how long
   *  has it been sustained" (0-1, climbs over DANCE_RAISE_BUILD_MS ≈ 4.2s of
   *  held groove). Consumed by camera systems that want to react to the same
   *  gesture the rig's own animation already responds to, without
   *  reimplementing the spin-speed detector. */
  getDanceState(): { energy: number; raise: number } {
    return { energy: this.danceEnergy, raise: this.danceRaise };
  }

  /** Renderer-truth snapshot for the __rigDebug probe hook: what this rig
   *  last drew and whether it's currently visible. */
  debugInfo(): {
    visible: boolean;
    x: number;
    y: number;
    danceEnergy: number;
    idleDanceMs: number;
    danceRaise: number;
  } {
    return {
      visible: this.graphics.visible,
      x: this.lastDrawX,
      y: this.lastDrawY,
      danceEnergy: this.danceEnergy,
      idleDanceMs: this.idleDanceMs,
      danceRaise: this.danceRaise,
    };
  }

  setVisible(visible: boolean) {
    this.graphics.setVisible(visible);
    this.nameText.setVisible(visible);
    if (!visible) this.graphics.clear();
  }

  /** Call on every shot fired. Flicks the throwing hand out toward aim (a
   *  shuriken snap) and flashes the muzzle glow. `hand` is the sim's
   *  authoritative throwing hand (0 = lead, 1 = back) from the shot-fired
   *  event — using it keeps the rig's hand in lock-step with where the sim
   *  spawned the projectile (the shard leaves the exact hand). Falls back to
   *  local alternation if omitted. */
  triggerFire(hand?: 0 | 1) {
    this.firePulse = 1;
    this.combatHoldMs = 1600; // stay in the cocked combat stance ~1.6s after the last shot
    this.pendingThrowKick = true; // consumed in draw(): velocity-kick the throwing hand along aim
    this.throwHand = hand ?? (this.throwHand === 0 ? 1 : 0);
    if (this.throwHand === 0) this.leadThrow = 1;
    else this.backThrow = 1;
  }

  /** Render-only melee sentence: coil, cross-body cut, committed travel past
   * contact, then recovery. Simulation hit timing and position never move. */
  triggerMeleeSwing(style: "interstice" | "kindred", dir: number): void {
    this.meleePoseStyle = style;
    this.meleePoseDir = dir >= 0 ? 1 : -1;
    this.meleePoseDurationMs = style === "interstice" ? 360 : 560;
    this.meleePoseMs = this.meleePoseDurationMs;
    this.combatHoldMs = Math.max(this.combatHoldMs, 900);
    this.meleeTipHistory = [];
  }

  /** Render-only authored gesture for every drafted active. The exhaustive
   * contract owns timing/physical verb per AbilityKind; sim effect timing and
   * movement remain authoritative and untouched. */
  triggerAbility(kind: AbilityKind): void {
    const contract = ABILITY_ANIMATIONS[kind];
    this.abilityPoseKind = kind;
    this.abilityPoseDurationMs = contract.durationMs;
    this.abilityPoseMs = contract.durationMs;
    this.combatHoldMs = Math.max(this.combatHoldMs, contract.durationMs + 300);
  }

  /** Which hand is throwing right now (for the muzzle/spawn point). 0 = lead,
   *  1 = back. Whichever hand's flick is furthest along is the active one. */
  activeThrowHandIndex(): 0 | 1 {
    return this.leadThrow >= this.backThrow ? 0 : 1;
  }

  /** Live world position of a hand from the last draw() — for anchoring melee
   *  construct VFX (a swung blade) to the actual hand, not the feet. Returns
   *  null before the first draw. hand: 0 = lead (dominant), 1 = back. */
  getHandWorld(hand: 0 | 1 = 0): { x: number; y: number } | null {
    return hand === 0 ? this.lastLeadHandWorld : this.lastBackHandWorld;
  }

  /**
   * Trigger a visual knockback on hit. Direction is unit-ish; magnitude is
   * scaled internally. Pure render — does not affect the authoritative sim.
   * Per game-feel-juice §5.
   */
  triggerHit(dirX: number, dirY: number) {
    const MAG = 6;
    this.hitOffsetX = dirX * MAG;
    this.hitOffsetY = dirY * MAG;
    this.hitDecay = 1;
  }

  /** The guard just TURNED an attack — slide-parry reflect, timed parry, or a
   *  bash clash. Overdrives the dash-bash arc to white and fires an expanding
   *  impact ring. Pure render; driven by the parry-deflected sim event. */
  triggerParryFlash() {
    this.parryFlashMs = ProceduralPlayerRig.PARRY_FLASH_MS;
  }

  /** A confirmed kill — earned reactive cosmetics, not a purchase (Vessel
   *  Creator §5). Pure render; driven by the killer's own player-killed
   *  sim event, resets every trigger so a fast multi-kill re-punches
   *  rather than fading through a stale decay. */
  triggerKillPulse() {
    this.killPulseMs = ProceduralPlayerRig.KILL_PULSE_MS;
  }

  /** The outro's induction beat — both arms raised wide overhead, held.
   *  Not a combat animation; the physical moment the recognition (Sephia's
   *  gasp, the self-authorship realized) gets SEALED. `holdMs` lets the
   *  caller match it to however long the outro's hold actually is. */
  triggerVictoryPose(holdMs = 2600) {
    this.victoryPoseMs = holdMs;
  }

  private draw(pose: ProceduralPlayerPose, walkAmount: number, deltaMs: number) {
    const g = this.graphics;
    const s = this.scale;
    // Quadratic ease-out — strong overshoot, fast snap-back. Visual only.
    const hitEased = this.hitDecay * this.hitDecay;
    const ground = pose.position.y + this.hitOffsetY * hitEased;
    // Smoothed crouch (0..1) — geometric crouch only; pose.crouching still
    // gates locomotion (bob) so we don't bob mid-duck.
    const cr = this.crouchBlend;
    const sprint = this.sprintBlend;
    // Soft sine bob (less hard plant) + drunk side-sway on the hip. Bob
    // amplitude more than doubles at sprint — the flight phase genuinely rises.
    const bob =
      pose.grounded && cr < 0.35
        ? Math.pow(Math.abs(Math.sin(this.stepPhase)), 1.2) *
          Phaser.Math.Linear(2.4, 5.4, sprint) *
          walkAmount *
          (1 - cr)
        : 0;
    // GATHER-SQUASH (run-reference keyframe 5): at the instant both feet
    // pass under the body the whole figure compresses — the coiled frame
    // between strides that makes a run read hand-animated instead of
    // floating. Peaks exactly where bob bottoms out (they share the phase),
    // so the pelvis path becomes rise-fall-DIP, not a pure sine.
    const gather =
      pose.grounded && cr < 0.35
        ? Math.pow(1 - Math.abs(Math.sin(this.stepPhase)), 2) * 3.4 * sprint * walkAmount
        : 0;
    const drunkSway =
      pose.grounded && walkAmount > 0.08
        ? Math.sin(this.stepPhase * 0.5) * 3.2 * s * walkAmount
        : Math.sin(this.stepPhase * 0.35) * 0.8 * s;

    // Squash & stretch (visual only): the body ELONGATES on a powerful launch
    // and COMPRESSES on a fast fall (airborne), and now also compresses on
    // the grounded gather frame at sprint.
    const stretchY = pose.grounded
      ? 1 + Math.sin(this.stepPhase * 2) * 0.015 * walkAmount - gather * 0.012
      : 1 + Phaser.Math.Clamp(-pose.velocity.y / 2600, -0.14, 0.3);
    const sy = s * stretchY;

    const wallDir = pose.touchingWallDir ?? 0;
    const wallSliding = wallDir !== 0 && !pose.grounded;
    const dashing = pose.dashing ?? false;
    // Forward lean scales hard with sprint (run reference: the sprint torso
    // pitches 30-45°; the old flat 3.2px cap read as a stroll at any speed).
    const sprintLean =
      pose.grounded
        ? Phaser.Math.Clamp(pose.velocity.x / 300, -1, 1) *
          Phaser.Math.Linear(3.2, 13, sprint) *
          s
        : 0;
    const throwEnglish = Math.max(this.leadThrow, this.backThrow);
    const throwDrop = throwEnglish * 3.2 * s;
    // Drive lean (slow-in/slow-out): acceleration pitches the body INTO the
    // effort — accelerating hard leans further forward than steady-state
    // (the wind-up), braking leans back against momentum. Velocity says how
    // fast; this says how hard it's trying, which is what reads as intent.
    const driveLean =
      Phaser.Math.Clamp(this.accelSmooth / 900, -1, 1) * 5.5 * s * (pose.grounded ? 1 : 0.35);
    // Target lean — springed so direction changes read as drunk recovery.
    const leanTarget =
      (wallSliding ? wallDir * 2.5 * s : 0) +
      (dashing ? this.facingSmooth * 5 * s : 0) +
      sprintLean +
      driveLean +
      this.facingSmooth * throwEnglish * 10 * s +
      drunkSway;
    this.leanSpring = springTo(
      this.leanSpring,
      leanTarget,
      deltaMs,
      ProceduralPlayerRig.TORSO_FREQ,
      ProceduralPlayerRig.TORSO_DAMP,
    );
    const leanX = this.leanSpring.value;

    // Landing/launch/brake cushion — px of body-chain dip from the spring;
    // clamped so a catastrophic fall can't fold the rig into the floor.
    const cushion = Phaser.Math.Clamp(this.landCushion.value * 0.05, 0, 9) * s;
    // Idle life (appeal): breathing + a slow side-to-side weight shift when
    // still — the vessel never reads as a paused animation. Fades out the
    // moment real movement starts (walkAmount gate), grounded only.
    const idleLife = pose.grounded ? 1 - Math.min(1, walkAmount * 3) : 0;
    const breathe = Math.sin(this.idlePhase * 2.1) * 1.1 * s * idleLife;

    // Dance energy: grounded, idling (not walking), not mid-dash, and
    // actively spinning the aim fast enough to read as a deliberate orbit
    // rather than just re-aiming at a target. Asymmetric attack/release so
    // it ramps in quickly once you start circling and eases out gently a
    // beat after you stop, instead of snapping.
    const danceTarget =
      idleLife > 0.6 && !dashing
        ? Phaser.Math.Clamp(
            (this.aimAngularVel - 1.0) /
              (ProceduralPlayerRig.DANCE_SPIN_THRESHOLD_RADPS - 1.0),
            0,
            1,
          )
        : 0;
    if (deltaMs > 0) {
      const danceTau =
        danceTarget > this.danceEnergy
          ? ProceduralPlayerRig.DANCE_ATTACK_MS
          : ProceduralPlayerRig.DANCE_RELEASE_MS;
      const dk = 1 - Math.exp(-deltaMs / danceTau);
      this.danceEnergy += (danceTarget - this.danceEnergy) * dk;
    }
    // Sustained-dance arm-raise: idleDanceMs climbs while the dance holds
    // (clamped to the build window) and falls back FASTER once the energy
    // gate drops — the longer you keep circling, the higher the arms
    // climb; stopping eases them back down instead of a pop-and-snap.
    if (this.danceEnergy > ProceduralPlayerRig.DANCE_RAISE_GATE) {
      this.idleDanceMs = Math.min(
        ProceduralPlayerRig.DANCE_RAISE_BUILD_MS,
        this.idleDanceMs + deltaMs,
      );
    } else {
      this.idleDanceMs = Math.max(
        0,
        this.idleDanceMs - deltaMs * ProceduralPlayerRig.DANCE_RAISE_FALL_RATE,
      );
    }
    const raiseTarget = Phaser.Math.Clamp(
      this.idleDanceMs / ProceduralPlayerRig.DANCE_RAISE_BUILD_MS,
      0,
      1,
    );
    if (deltaMs > 0) {
      const rk = 1 - Math.exp(-deltaMs / 480);
      this.danceRaise += (raiseTarget - this.danceRaise) * rk;
    }
    // Always-ticking clock (silent-fallback tempo) so the groove reads as
    // intentional even muted; SonicField's live pulse/beat only scale the
    // AMPLITUDE (louder music = bigger groove), never re-time the phase.
    this.groovePhase += deltaMs * 0.001 * Math.PI * 2 * ProceduralPlayerRig.GROOVE_HZ;
    const sonic = getSonicField();
    const musicEnergy = Math.max(sonic.pulse, sonic.beat * 0.8);
    const grooveAmp = this.danceEnergy * Phaser.Math.Linear(0.4, 1, musicEnergy);
    // groove = the bounce (pelvis/chest/head Y, applied below); grooveSway
    // = the hip/shoulder counter-sway (half-time, phase-offset from the
    // bounce — real weight-shift dancing alternates lean and lift, it
    // doesn't bounce and sway in lockstep).
    const groove = Math.sin(this.groovePhase) * grooveAmp;
    const grooveSway = Math.sin(this.groovePhase * 0.5 + 0.6) * grooveAmp;
    // Real tempo-sync: rising-edge detect SonicField's live beat-transient
    // envelope (an actual bass-onset detector on whatever's playing, not a
    // guessed BPM) and kick an underdamped impulse spring HARD on every
    // detected hit — this is the "going IN on the drop" reaction. Gated on
    // danceEnergy so it's silent unless the player is actually dancing.
    this.msClock += deltaMs;
    if (
      this.danceEnergy > 0.05 &&
      sonic.beat > ProceduralPlayerRig.BEAT_HIT_THRESHOLD &&
      sonic.beat - this.prevBeatEnv > ProceduralPlayerRig.BEAT_HIT_RISE_DELTA
    ) {
      this.beatHitSpring = springKick(
        this.beatHitSpring,
        ProceduralPlayerRig.BEAT_HIT_KICK * this.danceEnergy,
      );
      // Spasmodic arm-throw roll (2026-07-15) — genuinely randomized per
      // hit, SOME of the time, not every hit (Jake: "rhythmically
      // spasmodically... in dotted time SOME of the time"). Three
      // outcomes: fire immediately (on-beat), schedule for a dotted
      // subdivision of the just-measured live beat interval (syncopated,
      // off-beat), or nothing extra this hit — the existing headbang/
      // chest-pop/fist-pump still happens regardless, this just layers an
      // occasional wild fling on top.
      const interval = this.msClock - this.lastBeatHitMs;
      if (interval > 100 && interval < 2000) {
        this.beatIntervalEstimateMs = interval;
      }
      this.lastBeatHitMs = this.msClock;
      const roll = Math.random();
      const hand: 0 | 1 = Math.random() < 0.5 ? 0 : 1;
      if (roll < ProceduralPlayerRig.THROW_CHANCE) {
        this.triggerArmThrow(hand);
      } else if (roll < ProceduralPlayerRig.THROW_CHANCE + ProceduralPlayerRig.DOTTED_THROW_CHANCE) {
        this.dottedThrowAtMs = this.msClock + this.beatIntervalEstimateMs * 1.5;
        this.dottedThrowHand = hand;
      }
      // Pop-and-lock bar counter — every 4th detected beat hit (one bar,
      // 4/4 assumption) rolls a fresh wide locked pose (see rollLockPose).
      this.barBeatCounter += 1;
      if (this.barBeatCounter >= ProceduralPlayerRig.BAR_BEATS) {
        this.barBeatCounter = 0;
        this.rollLockPose();
      }
    }
    if (this.dottedThrowAtMs >= 0 && this.msClock >= this.dottedThrowAtMs) {
      this.triggerArmThrow(this.dottedThrowHand);
      this.dottedThrowAtMs = -1;
    }
    this.prevBeatEnv = sonic.beat;
    this.beatHitSpring = springTo(
      this.beatHitSpring,
      0,
      deltaMs,
      ProceduralPlayerRig.BEAT_HIT_FREQ_HZ,
      ProceduralPlayerRig.BEAT_HIT_DAMP,
    );
    this.leadElbowWobble = springTo(
      this.leadElbowWobble,
      0,
      deltaMs,
      ProceduralPlayerRig.ELBOW_WOBBLE_FREQ_HZ,
      ProceduralPlayerRig.ELBOW_WOBBLE_DAMP,
    );
    this.backElbowWobble = springTo(
      this.backElbowWobble,
      0,
      deltaMs,
      ProceduralPlayerRig.ELBOW_WOBBLE_FREQ_HZ,
      ProceduralPlayerRig.ELBOW_WOBBLE_DAMP,
    );
    // Clamped + rectified: only the downward punch of the ring-down reads
    // as a hit (a hit that also produced upward recoil would look like a
    // second bounce, not a snap-and-settle).
    const beatHit = Math.max(0, this.beatHitSpring.value) * this.danceEnergy;
    // Vibes lighting: brightens continuously with the raise, and once the
    // arms are fully up a slow shimmer rides on top ("working miracles")
    // instead of the glow just sitting flat at max.
    const miracleT = Phaser.Math.Clamp((this.danceRaise - 0.8) / 0.2, 0, 1);
    const miraclePulse = miracleT * (0.5 + 0.5 * Math.sin(this.groovePhase * 2.3));
    // Kill pulse rides the SAME "boost" channel the dance system charges —
    // one lighting language, not a second bespoke one — eased out over its
    // window rather than a hard cutoff so a kill doesn't visibly snap off.
    const killBoost =
      (this.killPulseMs / ProceduralPlayerRig.KILL_PULSE_MS) *
      (this.killPulseMs / ProceduralPlayerRig.KILL_PULSE_MS);
    const danceGlowBoost = Phaser.Math.Clamp(
      this.danceRaise * 0.85 +
        miraclePulse * 0.5 +
        this.externalAudioBoost +
        this.externalHypeBoost * 0.7 +
        killBoost * 0.9 +
        beatHit * 0.6,
      0,
      1.35,
    );

    const weightShift =
      Math.sin(this.idlePhase) * 2.2 * s * idleLife + grooveSway * 6.5 * s;
    const meleeT = this.meleePoseMs > 0
      ? 1 - this.meleePoseMs / this.meleePoseDurationMs
      : 1;
    const meleeAnticipationEnd = this.meleePoseStyle === "kindred" ? 0.38 : 0.32;
    const meleeCutEnd = this.meleePoseStyle === "kindred" ? 0.61 : 0.52;
    // Load from the floor: hips/chest/head sink together during anticipation,
    // then rise sharply into the cut. Feet retain their authoritative contact.
    const meleeGroundLoad = this.meleePoseMs <= 0
      ? 0
      : meleeT < meleeAnticipationEnd
        ? Math.sin((meleeT / meleeAnticipationEnd) * Math.PI * 0.5) *
          (this.meleePoseStyle === "kindred" ? 14 : 10) * s
        : meleeT < meleeCutEnd
          ? (1 - (meleeT - meleeAnticipationEnd) /
            (meleeCutEnd - meleeAnticipationEnd)) *
            (this.meleePoseStyle === "kindred" ? 14 : 10) * s
          : 0;
    // Key positions — head/chest lag hip for floppy chain.
    // gather dips the whole chain, slightly harder toward the head — the
    // upper body rounds over the coil, not a rigid elevator drop. cushion
    // rides the same shape (impacts dip the body, spring rebounds it).
    // Deepened 2026-07-13 (Jake: "doesn't crouch very well") — the old
    // 52->32/78->56/100->76 range barely outpaced the leg-length shrink
    // below, so hip drop mostly read as a hunch, not a squat. Bigger drops
    // here + less leg-length shrink (see legLen1/legLen2) force the IK
    // solver into real, visible knee bend.
    // beatHit adds a SHARP downward snap on top of the smooth groove sine —
    // headbang is strongest at the head (inverted from the old damp-toward-
    // head shape, since a real headbang is the head snapping hardest, not
    // softest), chest gets a real pop, pelvis just grounds the hit. Bounce
    // coefficients tightened 2026-07-15 (Jake: "close more vert bounce") —
    // arms (pop-and-lock, below) are now the primary read; the body bounce
    // is a grounding undertone, not competing for attention.
    const pelvisY =
      ground - Phaser.Math.Linear(52, 28, cr) * sy - bob + gather * s + cushion + breathe * 0.4 + throwDrop - groove * 1.6 * sy + beatHit * 1 * sy + meleeGroundLoad;
    const chestYTarget =
      ground - Phaser.Math.Linear(78, 52, cr) * sy - bob + gather * 1.2 * s + cushion * 1.15 + breathe + throwDrop * 0.5 - groove * 1.2 * sy + beatHit * 3 * sy + meleeGroundLoad * 0.82;
    const headYTarget =
      ground - Phaser.Math.Linear(100, 72, cr) * sy - bob + gather * 1.4 * s + cushion * 1.25 + breathe * 1.4 + throwDrop * 0.3 - groove * 1 * sy + beatHit * 5 * sy + meleeGroundLoad * 0.68;
    const cx = pose.position.x + this.hitOffsetX * hitEased + drunkSway * 0.35;
    // Forward CENTRE OF MASS: the whole body chain (pelvis up) rides ahead
    // of the feet while moving — the falling-forward posture that makes a
    // run feel committed rather than upright-with-busy-legs. Feet keep
    // planting at the sim position (footPos still uses raw cx), so the legs
    // visibly drive from BEHIND the mass — the sprinter silhouette. Present
    // even at walk speed (a touch), strong at sprint, half-kept airborne so
    // a leap carries the attitude through the air.
    const comShift =
      Phaser.Math.Clamp(pose.velocity.x / 300, -1, 1) *
      (1.5 + sprint * 5.5) *
      (pose.grounded ? 1 : 0.55) *
      s;
    const meleeChain = this.meleePoseMs > 0
      ? meleeKineticChain(meleeT, this.meleePoseStyle)
      : { pelvisDrive: 0, chestDrive: 0, headDrive: 0, shoulderTwist: 0, frontBrace: 0 };
    const abilityContract = ABILITY_ANIMATIONS[this.abilityPoseKind];
    const abilityT = this.abilityPoseMs > 0
      ? 1 - this.abilityPoseMs / this.abilityPoseDurationMs
      : 1;
    const abilityCommit = this.abilityPoseMs <= 0 || this.meleePoseMs > 0
      ? 0
      : abilityT < abilityContract.anticipationEnd
        ? -Math.sin((abilityT / abilityContract.anticipationEnd) * Math.PI) * abilityContract.bodyCommit * 0.28
        : abilityT < abilityContract.actionEnd
          ? Math.sin(((abilityT - abilityContract.anticipationEnd) /
            (abilityContract.actionEnd - abilityContract.anticipationEnd)) * Math.PI * 0.5) * abilityContract.bodyCommit
          : (1 - (abilityT - abilityContract.actionEnd) /
            Math.max(0.01, 1 - abilityContract.actionEnd)) * abilityContract.bodyCommit;
    const bodyCx = cx + comShift + weightShift +
      this.facing * (meleeChain.pelvisDrive + abilityCommit) * s;

    this.chestLagX = springTo(
      this.chestLagX,
      leanX * 0.85,
      deltaMs,
      ProceduralPlayerRig.TORSO_FREQ,
      ProceduralPlayerRig.TORSO_DAMP,
    );
    this.chestLagY = springTo(
      this.chestLagY,
      chestYTarget,
      deltaMs,
      ProceduralPlayerRig.TORSO_FREQ * 1.1,
      ProceduralPlayerRig.TORSO_DAMP,
    );
    this.headLagX = springTo(
      this.headLagX,
      // Head punches further ahead of the chest at sprint — the reference
      // run leads with the head/chin, not an upright bob on a leaning body.
      this.chestLagX.value + this.facingSmooth * (2.4 + sprint * 4.5) * s,
      deltaMs,
      ProceduralPlayerRig.HEAD_FREQ,
      ProceduralPlayerRig.HEAD_DAMP,
    );
    this.headLagY = springTo(
      this.headLagY,
      headYTarget,
      deltaMs,
      ProceduralPlayerRig.HEAD_FREQ,
      ProceduralPlayerRig.HEAD_DAMP,
    );

    const pelvis = vec(bodyCx, pelvisY);
    const chest = vec(
      bodyCx + this.chestLagX.value +
        this.facing * (meleeChain.chestDrive - meleeChain.pelvisDrive) * s,
      this.chestLagY.value,
    );
    const head = vec(
      bodyCx + this.headLagX.value +
        this.facing * (meleeChain.headDrive - meleeChain.pelvisDrive) * s,
      this.headLagY.value,
    );

    // Aim
    const aimAngle = Math.atan2(pose.aimTarget.y - chest.y, pose.aimTarget.x - chest.x);
    const aim = vec(Math.cos(aimAngle), Math.sin(aimAngle));
    const shoulderAxis = Math.atan2(aim.x, -aim.y) +
      this.meleePoseDir * meleeChain.shoulderTwist;
    const perp = vec(Math.cos(shoulderAxis), Math.sin(shoulderAxis));

    // Joints
    const hipL = vec(pelvis.x - 7 * s, pelvis.y);
    const hipR = vec(pelvis.x + 7 * s, pelvis.y);
    const shoulderLead = vec(chest.x + perp.x * 7 * s, chest.y + perp.y * 7 * s);
    const shoulderBack = vec(chest.x - perp.x * 7 * s, chest.y - perp.y * 7 * s);

    // Hip drape: hangs straight down at rest, kicked backward by horizontal
    // speed (trails behind a sprint/dash) and by falling speed (streams up
    // behind a fast descent) — a springed target so it whips out and settles
    // rather than snapping. Range widened (was ±6) so a dash (780px/s) reads
    // as a real whip-out, clearly beyond a normal sprint's (330px/s) sway.
    const drapeTargetRaw = vec(
      pelvis.x - Phaser.Math.Clamp(pose.velocity.x / 45, -14, 14) * s,
      pelvis.y + 14 * s - Phaser.Math.Clamp(pose.velocity.y / 140, -3, 3) * s,
    );
    if (!this.drapeSpringReady) {
      this.drapeSpringX = springState(drapeTargetRaw.x);
      this.drapeSpringY = springState(drapeTargetRaw.y);
      this.drapeSpringReady = true;
    }
    this.drapeSpringX = springTo(
      this.drapeSpringX,
      drapeTargetRaw.x,
      deltaMs,
      ProceduralPlayerRig.DRAPE_FREQUENCY_HZ,
      ProceduralPlayerRig.DRAPE_DAMPING,
    );
    this.drapeSpringY = springTo(
      this.drapeSpringY,
      drapeTargetRaw.y,
      deltaMs,
      ProceduralPlayerRig.DRAPE_FREQUENCY_HZ,
      ProceduralPlayerRig.DRAPE_DAMPING,
    );
    const drapeTip = vec(this.drapeSpringX.value, this.drapeSpringY.value);

    // Two INDEPENDENT hands (see computeArmTargets): each rests at its own
    // ready position and flicks out toward aim on its own throw
    // (leadThrow/backThrow), alternating per shot. Wall-plant bends the
    // gripping hand; dash braces both forward (the dash-bash guard). Springed so
    // state changes settle instead of popping.
    const armTargets = this.computeArmTargets(
      shoulderLead,
      shoulderBack,
      aim,
      walkAmount,
      wallDir,
      dashing,
      this.leadThrow,
      this.backThrow,
      s,
      sprint,
      this.victoryPoseMs,
    );

    if (this.meleePoseMs > 0) {
      // Kindred always cuts with the sword hand; alternating the combo only
      // reverses its travel. Interstice really alternates its two daggers.
      // Treating Kindred's shield hand as a sword hand on every other swing
      // detached the visible blade from the anatomy.
      const activeLead = this.meleePoseStyle === "kindred" || this.meleePoseDir > 0;
      const shoulder = activeLead ? shoulderLead : shoulderBack;
      const guardShoulder = activeLead ? shoulderBack : shoulderLead;
      const active = activeLead ? armTargets.lead : armTargets.back;
      const guard = activeLead ? armTargets.back : armTargets.lead;
      // Shoulder→hand and hand→blade are two linked arcs, not one rigid
      // spoke. The elbow loads/bends first, the hand extends through contact,
      // and the wrist/blade continues into the follow-through.
      const handPose = meleeHandPose(
        aimAngle,
        this.meleePoseDir,
        meleeT,
        this.meleePoseStyle,
      );
      active.x = shoulder.x + Math.cos(handPose.angle) * handPose.reach * s;
      active.y = shoulder.y + Math.sin(handPose.angle) * handPose.reach * s;
      if (this.meleePoseStyle === "interstice") {
        const offPose = meleeOffhandPose(aimAngle, this.meleePoseDir, meleeT);
        guard.x = guardShoulder.x + Math.cos(offPose.angle) * offPose.reach * s;
        guard.y = guardShoulder.y + Math.sin(offPose.angle) * offPose.reach * s;
      } else {
        const brace = meleeStage(meleeT, "kindred");
        const braceOpen = brace.recovery;
        const guardAngle = aimAngle - this.meleePoseDir * (0.55 - braceOpen * 0.22);
        const guardReach = (25 + braceOpen * 4) * s;
        guard.x = guardShoulder.x + Math.cos(guardAngle) * guardReach;
        guard.y = guardShoulder.y + Math.sin(guardAngle) * guardReach;
      }
    } else if (this.abilityPoseMs > 0) {
      const a = abilityContract;
      const wind = Phaser.Math.Clamp(abilityT / a.anticipationEnd, 0, 1);
      const act = Phaser.Math.Clamp(
        (abilityT - a.anticipationEnd) / Math.max(0.01, a.actionEnd - a.anticipationEnd),
        0,
        1,
      );
      const recover = Phaser.Math.Clamp((abilityT - 0.86) / 0.14, 0, 1);
      const reach = a.reach * s;
      const side = a.handedness === 0 ? this.facing : a.handedness;
      const lead = armTargets.lead;
      const back = armTargets.back;
      const setPolar = (hand: Vec2, shoulder: Vec2, angle: number, distance: number): void => {
        hand.x = shoulder.x + Math.cos(angle) * distance;
        hand.y = shoulder.y + Math.sin(angle) * distance;
      };
      const forward = aimAngle;
      switch (a.gesture) {
        case "thrust":
          setPolar(lead, shoulderLead, forward + side * (0.65 * (1 - act)), reach * (0.55 + 0.45 * act - 0.22 * recover));
          setPolar(back, shoulderBack, forward + Math.PI - side * 0.25, 16 * s);
          break;
        case "fan":
          setPolar(lead, shoulderLead, forward - side * (1.05 - act * 1.55), reach);
          setPolar(back, shoulderBack, forward + side * (1.05 - act * 1.55), reach);
          break;
        case "plant":
          setPolar(lead, shoulderLead, forward + side * (0.55 + act * 0.8), reach * (0.68 + act * 0.22));
          setPolar(back, shoulderBack, forward - side * (0.55 + act * 0.8), reach * (0.68 + act * 0.22));
          lead.y += act * 15 * s;
          back.y += act * 15 * s;
          break;
        case "guard":
          setPolar(lead, shoulderLead, forward - side * (0.9 - act * 0.35), reach * 0.78);
          setPolar(back, shoulderBack, forward + side * (0.9 - act * 0.35), reach * 0.78);
          break;
        case "gather": {
          const r = reach * (0.9 - act * 0.42 + recover * 0.25);
          setPolar(lead, shoulderLead, forward - side * (1.15 - wind * 0.45), r);
          setPolar(back, shoulderBack, forward + side * (1.15 - wind * 0.45), r);
          break;
        }
        case "mark":
          setPolar(lead, shoulderLead, forward, reach * (0.62 + act * 0.38 - recover * 0.2));
          setPolar(back, shoulderBack, forward + Math.PI * 0.72 * side, 17 * s);
          break;
        case "pulse": {
          const spread = 0.38 + act * 1.0 - recover * 0.35;
          setPolar(lead, shoulderLead, forward - side * spread, reach);
          setPolar(back, shoulderBack, forward + side * spread, reach);
          break;
        }
        case "step":
          setPolar(lead, shoulderLead, forward - side * (0.8 - act * 0.55), reach);
          setPolar(back, shoulderBack, forward + Math.PI - side * 0.35, 19 * s);
          break;
        case "weave": {
          const orbit = (wind * 0.9 + act * 1.8) * side;
          setPolar(lead, shoulderLead, forward - 0.75 + orbit, reach * 0.8);
          setPolar(back, shoulderBack, forward + 0.75 - orbit, reach * 0.8);
          break;
        }
        case "cut": {
          const sweep = -1.0 + act * 2.1 - recover * 0.35;
          setPolar(lead, shoulderLead, forward + side * sweep, reach);
          setPolar(back, shoulderBack, forward - side * 0.8, 18 * s);
          break;
        }
      }
    }

    if (!this.leadHandSpringReady) {
      this.leadHandSpringX = springState(armTargets.lead.x);
      this.leadHandSpringY = springState(armTargets.lead.y);
      this.leadHandSpringReady = true;
    }
    // Throw pop: the instant a shot fires, velocity-kick the throwing
    // hand's spring along aim — the whip reads crisp from ANY stance
    // (hang/walk/sweep) instead of the spring easing across the whole
    // draw distance. One-shot, set by triggerFire.
    if (this.pendingThrowKick && this.backHandSpringReady) {
      this.pendingThrowKick = false;
      const kick = 1100;
      if (this.throwHand === 0) {
        this.leadHandSpringX = springKick(this.leadHandSpringX, aim.x * kick);
        this.leadHandSpringY = springKick(this.leadHandSpringY, aim.y * kick);
      } else {
        this.backHandSpringX = springKick(this.backHandSpringX, aim.x * kick);
        this.backHandSpringY = springKick(this.backHandSpringY, aim.y * kick);
      }
    }
    // Fist-pump grooves (restyled 2026-07-15 from the old floaty-flow
    // version): the more the dance has taken over (danceRaise), the
    // SNAPPIER/tighter the arm springs get — a fist pump punches to a stop,
    // it doesn't drift there. Slightly past combat's own snap at full
    // raise, since a punched-up fist should feel harder than a readied
    // weapon, not softer.
    const baseArmFreq = Phaser.Math.Linear(
      ProceduralPlayerRig.ARM_FREQUENCY_HZ,
      7.2,
      this.danceRaise,
    );
    const baseArmDamp = Phaser.Math.Linear(ProceduralPlayerRig.ARM_DAMPING, 0.68, this.danceRaise);
    // The generic hand spring is intentionally soft for locomotion/idle, but
    // it erased a 70–130ms sword cut. During melee the arm follows the authored
    // kinetic chain crisply; anticipation remains slower than the contact beat
    // and Kindred remains weightier than Interstice.
    const meleeCutActive = this.meleePoseMs > 0 &&
      meleeT >= meleeAnticipationEnd && meleeT < meleeCutEnd;
    const armFreq = this.meleePoseMs <= 0
      ? baseArmFreq
      : meleeCutActive
        ? this.meleePoseStyle === "interstice" ? 18 : 12
        : this.meleePoseStyle === "interstice" ? 10 : 7.5;
    const armDamp = this.meleePoseMs <= 0 ? baseArmDamp : meleeCutActive ? 0.76 : 0.88;
    this.leadHandSpringX = springTo(this.leadHandSpringX, armTargets.lead.x, deltaMs, armFreq, armDamp);
    this.leadHandSpringY = springTo(this.leadHandSpringY, armTargets.lead.y, deltaMs, armFreq, armDamp);
    const handLead = vec(this.leadHandSpringX.value, this.leadHandSpringY.value);

    if (!this.backHandSpringReady) {
      this.backHandSpringX = springState(armTargets.back.x);
      this.backHandSpringY = springState(armTargets.back.y);
      this.backHandSpringReady = true;
    }
    this.backHandSpringX = springTo(this.backHandSpringX, armTargets.back.x, deltaMs, armFreq, armDamp);
    this.backHandSpringY = springTo(this.backHandSpringY, armTargets.back.y, deltaMs, armFreq, armDamp);
    const handBack = vec(this.backHandSpringX.value, this.backHandSpringY.value);
    // Publish the live hand positions (world coords) for the melee VFX anchor.
    this.lastLeadHandWorld = { x: handLead.x, y: handLead.y };
    this.lastBackHandWorld = { x: handBack.x, y: handBack.y };

    // Feet — raw stepping targets (or a wall-plant target while gripping),
    // then run through a spring so the IK end effector chases the target
    // with lag/overshoot instead of snapping.
    const footLTarget =
      wallSliding && wallDir === -1
        ? this.wallPlantFoot(cx, wallDir, pelvis, s)
        : this.footPos(cx, -1, ground, walkAmount, sprint, pose.crouching, pose.grounded);
    const footRTarget =
      wallSliding && wallDir === 1
        ? this.wallPlantFoot(cx, wallDir, pelvis, s)
        : this.footPos(cx, 1, ground, walkAmount, sprint, pose.crouching, pose.grounded);
    if (this.meleePoseMs > 0 && pose.grounded) {
      // Plant a real base under the cut: rear foot receives the coil, front
      // foot catches the body after contact. Feet do not skate with the torso.
      footLTarget.x = cx - this.facing * (13 + meleeChain.frontBrace) * s;
      footRTarget.x = cx + this.facing * (9 + meleeChain.frontBrace * 3) * s;
      footLTarget.y = ground;
      footRTarget.y = ground;
    }

    if (!this.footSpringsReady) {
      this.footLSpringX = springState(footLTarget.x);
      this.footLSpringY = springState(footLTarget.y);
      this.footRSpringX = springState(footRTarget.x);
      this.footRSpringY = springState(footRTarget.y);
      this.footSpringsReady = true;
    }
    const freq = ProceduralPlayerRig.WOBBLE_FREQUENCY_HZ;
    const damping = ProceduralPlayerRig.WOBBLE_DAMPING;
    this.footLSpringX = springTo(this.footLSpringX, footLTarget.x, deltaMs, freq, damping);
    this.footLSpringY = springTo(this.footLSpringY, footLTarget.y, deltaMs, freq, damping);
    this.footRSpringX = springTo(this.footRSpringX, footRTarget.x, deltaMs, freq, damping);
    this.footRSpringY = springTo(this.footRSpringY, footRTarget.y, deltaMs, freq, damping);
    const footL = vec(this.footLSpringX.value, this.footLSpringY.value);
    const footR = vec(this.footRSpringX.value, this.footRSpringY.value);

    // IK
    const legLen1 = Phaser.Math.Linear(28, 23, cr) * s;
    const legLen2 = Phaser.Math.Linear(28, 23, cr) * s;
    const legL = solveTwoBone(hipL, footL, legLen1, legLen2, -this.facing);
    const legR = solveTwoBone(hipR, footR, legLen1, legLen2, -this.facing);
    const armUpper = ProceduralPlayerRig.ARM_UPPER * s;
    const armLower = ProceduralPlayerRig.ARM_LOWER * s;
    const meleeLeadBend = this.meleePoseMs > 0 && this.meleePoseStyle === "kindred"
      ? -this.meleePoseDir * this.facing
      : -this.facing * (1 + this.leadElbowWobble.value * 0.15);
    const armLead = solveTwoBone(
      shoulderLead,
      handLead,
      armUpper,
      armLower,
      meleeLeadBend,
    );
    const armBack = solveTwoBone(
      shoulderBack,
      handBack,
      armUpper,
      armLower,
      this.facing * (1 + this.backElbowWobble.value * 0.15),
    );

    const healthRatio = (pose.health ?? 100) / Math.max(1, pose.maxHealth ?? 100);
    const full = this.detail === "full";

    g.clear();

    // --- TRAIL / dash streaks — full detail only ---
    if (full) {
      this.drawTrail(g, pose.position, pose.velocity, s);
      if (dashing) {
        this.drawDashStreaks(g, pose.position, pose.velocity, s);
      }
    }

    // --- DRAW ORDER (back to front) ---

    // 0a. Contact shadow
    g.fillStyle(0x000000, 0.28);
    g.fillEllipse(pelvis.x, ground + 2 * s, 22 * s, 7 * s);
    if (full) {
      g.fillStyle(0x000000, 0.12);
      g.fillEllipse(pelvis.x, ground + 2 * s, 30 * s, 10 * s);
    }

    // 0b. Soft under-glow — brightens and swells with the vibes-lighting
    // boost (danceGlowBoost), same "the longer you dance the more it
    // lights up" read as the aura below.
    g.fillStyle(this.color, (full ? 0.12 : 0.08) + danceGlowBoost * 0.1);
    g.fillCircle(chest.x, chest.y, (28 + danceGlowBoost * 7) * s);
    if (full) {
      g.fillStyle(this.accentColor, 0.1 + danceGlowBoost * 0.12);
      g.fillCircle(chest.x, chest.y, (18 + danceGlowBoost * 6) * s);
    }

    // 0c. Mad aura — full only (or reduced for lite); danceGlowBoost widens
    // and brightens the orbit so a sustained dance visibly charges it up.
    this.drawAura(g, pelvis, chest, s, danceGlowBoost);

    // 1. Nameplate + health bar (topmost layer visually but drawn first for z)
    this.drawNameplate(g, head.x, head.y - 24 * s, s, pose.health ?? 100, pose.maxHealth ?? 100);

    // 1b. Silhouette backing — a dark halo drawn BEHIND the whole figure
    // (audit finding: the hero is a mid-gray value that nearly vanishes
    // against a mid-gray/black backdrop — near-zero silhouette contrast,
    // the cardinal sin of character readability). A few overlapping dark
    // ellipses at torso/head/limb positions guarantee the rig pops against
    // ANY background brightness, the same trick outline shaders achieve
    // for sprites, done cheaply in Graphics without a second draw pass.
    this.drawSilhouetteBacking(g, pelvis, chest, head, hipL, hipR, footL, footR, s);

    // 2. Back leg
    this.drawThickLimb(g, hipR, legR, 5.5 * s, 4 * s);
    this.drawBoot(g, footR, s);

    // 3. Back arm + hand — an independent throwing hand holding a cocked
    // shuriken; it flashes and streaks on its OWN throw (backThrow).
    this.drawThickLimb(g, shoulderBack, armBack, 4.6 * s, 3.2 * s);
    this.drawShoulderArmor(g, shoulderBack, s);
    this.drawHandGlow(g, armBack.end, s, this.backThrow);
    this.drawShuriken(g, armBack.end, aim, s, this.backThrow);

    // 3b. Hip drape (the wizard sash) — behind the torso so only its
    // trailing edge peeks out, same layering a real cloak would have.
    this.drawHipDrape(g, pelvis, drapeTip, s);

    // 4. Torso (filled polygon - the character's MASS)
    this.drawTorso(g, pelvis, chest, s);

    // 5. Spine energy lines — dims while gripping a wall (conserving, not
    // spending, energy) versus the normal health-driven brightness.
    this.drawSpineGlow(g, pelvis, chest, s, healthRatio, wallSliding);

    // 6. Front leg
    this.drawThickLimb(g, hipL, legL, 6.2 * s, 4.6 * s);
    this.drawBoot(g, footL, s);

    // 7. Front arm + hand — the other independent throwing hand + its
    // shuriken; flashes and streaks on its own throw (leadThrow).
    this.drawThickLimb(g, shoulderLead, armLead, 5.4 * s, 3.8 * s);
    this.drawShoulderArmor(g, shoulderLead, s);
    this.drawHandGlow(g, armLead.end, s, this.leadThrow);
    this.drawShuriken(g, armLead.end, aim, s, this.leadThrow);

    // 10. Head + hood + visor
    this.drawHead(g, head, s, healthRatio);

    // 9b. Melee blade swing — the live weapon: renders only while an active
    // swing is running (meleePoseMs > 0). Reuses LightConstruct's
    // drawBladeSwing/drawKindledSwing — built for the offline construct
    // harness (constructHarness.ts) but never wired into the real rig, which
    // is why every melee swing in a live match has swung a fully invisible
    // weapon (Jake, playtest: "i am insterstice here cant see the blades").
    // Pivots off THIS frame's real spring-settled hand positions (handLead/
    // handBack — the same values getHandWorld() exposes), not a re-derived
    // pose, so the blade can never visually detach from the arm swinging it.
    // Drawn after the head so the swing silhouette is never occluded by the
    // body it's swinging past.
    const bladeParams = meleeBladeDrawParams(
      this.meleePoseStyle,
      this.meleePoseMs,
      this.meleePoseDurationMs,
      this.meleePoseDir,
      aimAngle,
      handLead,
      handBack,
    );
    if (bladeParams) {
      const tip = meleeBladeTip(
        bladeParams.activePivot,
        bladeParams.aimRad,
        bladeParams.sweepRad,
        bladeParams.dir,
        bladeParams.t,
        bladeParams.style,
        bladeParams.reach,
      );
      this.meleeTipHistory = appendBladeTip(
        this.meleeTipHistory,
        tip,
        ProceduralPlayerRig.MELEE_TIP_HISTORY_MAX,
      );
      if (bladeParams.style === "kindred") {
        drawKindledSwing(
          g,
          bladeParams.leadPivot,
          bladeParams.backPivot,
          bladeParams.aimRad,
          bladeParams.reach,
          KINDRED_TINT,
          bladeParams.sweepRad,
          bladeParams.dir,
          bladeParams.t,
          this.meleeTipHistory,
        );
      } else {
        drawBladeSwing(
          g,
          bladeParams.leadPivot,
          bladeParams.backPivot,
          bladeParams.aimRad,
          bladeParams.reach,
          INTERSTICE_TINT,
          bladeParams.sweepRad,
          bladeParams.dir,
          bladeParams.t,
        );
      }
    }

    // 11. Dash-bash shield — deployed only while dashing: a bright energy arc in
    // the lunge direction, the directional block made visible (matches the
    // 120° front-arc shield-dash block + bash in combat/World). Drawn last so
    // it reads as a shell out in front of the braced arms. Wide Parry widens
    // the cone (shieldArcScale).
    if (dashing) {
      this.drawAegisShield(g, chest, aim, s, pose.shieldArcScale ?? 1);
    }

    // 11b. Crystal Plating — hex shell outline so "more HP" reads on the body.
    if ((pose.platingGlow ?? 0) > 0) {
      const p = Math.min(1, pose.platingGlow ?? 0);
      g.lineStyle(2 * s, 0x86efac, 0.35 + p * 0.4);
      g.strokeCircle(chest.x, chest.y, 22 * s * (1 + p * 0.08));
      g.lineStyle(1 * s, 0xf0abfc, 0.25 + p * 0.3);
      g.strokeCircle(chest.x, chest.y, 26 * s * (1 + p * 0.1));
    }

    // 12. Parry flash — the guard just turned an attack. Drawn over
    // everything: the moment must be unmissable at a glance.
    if (this.parryFlashMs > 0) {
      this.drawParryFlash(g, chest, aim, s, dashing);
    }
  }

  /** The reflect moment: an impact ring expanding from the chest + (while
   *  sliding) the dash-bash arc overdriven to solid white. Progress eases out —
   *  violent at the instant of the turn, gone in a quarter second. */
  protected drawParryFlash(
    g: Phaser.GameObjects.Graphics,
    chest: Vec2,
    aim: Vec2,
    s: number,
    dashing: boolean,
  ) {
    const p = 1 - this.parryFlashMs / ProceduralPlayerRig.PARRY_FLASH_MS; // 0→1
    const fade = (1 - p) * (1 - p); // ease-out: bright birth, quick death
    // Birth flash — a filled white pop at the guard the first ~80ms. This is
    // what makes the turn UNMISSABLE; the ring alone read too faint.
    if (p < 0.34) {
      const pop = 1 - p / 0.34;
      g.fillStyle(WHITE, 0.55 * pop);
      g.fillCircle(chest.x, chest.y, 30 * s * (0.7 + 0.3 * pop));
    }
    // Expanding impact ring — white leading edge over an accent underlay.
    const ringR = (26 + p * 52) * s;
    g.lineStyle(9 * s * (1 - p), this.accentColor, 0.7 * fade);
    g.strokeCircle(chest.x, chest.y, ringR);
    g.lineStyle(3.5 * s, WHITE, fade);
    g.strokeCircle(chest.x, chest.y, ringR);
    // While sliding, the arc itself goes solid white — the shield "rings".
    if (dashing) {
      const aimAngle = Math.atan2(aim.y, aim.x);
      const halfArc = Math.PI / 3;
      g.lineStyle(7 * s, WHITE, 0.85 * fade);
      g.beginPath();
      g.arc(chest.x, chest.y, 42 * s, aimAngle - halfArc, aimAngle + halfArc);
      g.strokePath();
    }
  }

  /** The deployed shield-dash shell: a curved energy arc centred on the chest,
   *  spanning the 120° block cone around the lunge (aim) direction, with a
   *  bright shimmering leading rim and a faint field behind it. */
  protected drawAegisShield(
    g: Phaser.GameObjects.Graphics,
    chest: Vec2,
    aim: Vec2,
    s: number,
    arcScale = 1,
  ) {
    const aimAngle = Math.atan2(aim.y, aim.x);
    // Base 120° cone; Wide Parry multiplies coverage (clamped so it never wraps).
    const halfArc = Math.min(Math.PI * 0.92, (Math.PI / 3) * Math.max(0.5, arcScale));
    const r = 42 * s; // just past the braced hands
    const a0 = aimAngle - halfArc;
    const a1 = aimAngle + halfArc;
    const shimmer = 0.7 + 0.3 * Math.sin(this.stepPhase * 6);

    // Faint field emanating from the chest out to the shell.
    g.fillStyle(this.accentColor, 0.1 * shimmer);
    g.beginPath();
    g.moveTo(chest.x, chest.y);
    g.arc(chest.x, chest.y, r, a0, a1);
    g.closePath();
    g.fillPath();

    // Shell rim — an accent underlay + a bright white leading edge.
    g.lineStyle(5 * s, this.accentColor, 0.45 * shimmer);
    g.beginPath();
    g.arc(chest.x, chest.y, r, a0, a1);
    g.strokePath();
    g.lineStyle(2 * s, WHITE, 0.7 * shimmer);
    g.beginPath();
    g.arc(chest.x, chest.y, r, a0, a1);
    g.strokePath();
  }

  // --- TRAIL: Fading body-color dots at past positions ---
  protected drawTrail(
    g: Phaser.GameObjects.Graphics,
    currentPos: Vec2,
    velocity: Vec2,
    s: number,
  ): void {
    if (this.trailPositions.length < 2) return;

    // Velocity gate: compute speed from last 2 buffer entries
    const last = this.trailPositions[this.trailPositions.length - 1];
    const prev = this.trailPositions[this.trailPositions.length - 2];
    if (!last || !prev) return;

    const dt = Math.max(1, last.t - prev.t);
    const dx = last.x - prev.x;
    const dy = last.y - prev.y;
    const speed = Math.hypot(dx, dy) / (dt / 1000);

    // Also check live velocity as a fallback (covers the very first few frames)
    const liveSpeed = Math.hypot(velocity.x, velocity.y);
    const topSpeed = Math.max(speed, liveSpeed);
    if (topSpeed <= 60) return;

    // Intensity ramps with speed so a SPRINT card reads as a brighter streak
    // and a DASH (>~500 px/s, above the normal max) blazes white-hot after-
    // images. Card feedback with zero sim coupling — pure velocity read.
    const intensity = Phaser.Math.Clamp((topSpeed - 60) / 720, 0, 1);
    const dashing = topSpeed > 500;
    const col = dashing ? 0xffffff : this.color;

    const len = this.trailPositions.length;
    for (let i = 0; i < len; i++) {
      const entry = this.trailPositions[i];
      if (!entry) continue;

      // Skip dots too close to current position (avoids smear when near-stationary)
      const distToCurrent = Math.hypot(entry.x - currentPos.x, entry.y - currentPos.y);
      if (distToCurrent < 4) continue;

      // Older entries have lower index → lower alpha; boosted by speed.
      const alpha = ((i + 1) / len) * (0.4 + intensity * 0.5);
      const radius = (3 + intensity * 3) * s;
      g.fillStyle(col, alpha);
      g.fillCircle(entry.x, entry.y, radius);
    }
  }

  // --- SPEED-STREAKS: tapered motion lines during the dash-bash slide ---
  /** Three staggered lines trailing opposite the launch vector, longest in the
   *  middle — the classic anime speed-line read. Length/alpha scale with
   *  speed so the tail end of the slide relaxes instead of cutting off. */
  protected drawDashStreaks(
    g: Phaser.GameObjects.Graphics,
    pos: Vec2,
    velocity: Vec2,
    s: number,
  ): void {
    const speed = Math.hypot(velocity.x, velocity.y);
    if (speed < 200) return;
    const ux = -velocity.x / speed; // unit vector opposite travel
    const uy = -velocity.y / speed;
    const px = -uy; // perpendicular for the stagger
    const py = ux;
    const boost = Phaser.Math.Clamp(speed / 940, 0, 1);
    // [perp offset, length multiplier] — middle streak longest.
    const STREAKS: [number, number][] = [
      [-14, 0.72],
      [0, 1],
      [13, 0.62],
    ];
    for (const [off, lenMul] of STREAKS) {
      const ox = pos.x + px * off * s;
      const oy = pos.y - 28 * s + py * off * s; // originate near the torso
      const len = 46 * lenMul * boost * s;
      // Tapered: a wide accent base under a thin white core, both fading
      // along their length via three shrinking segments.
      for (let seg = 0; seg < 3; seg++) {
        const t0 = seg / 3;
        const t1 = (seg + 1) / 3;
        const a = 0.4 * boost * (1 - t0);
        g.lineStyle((3.4 - seg) * s, this.accentColor, a);
        g.beginPath();
        g.moveTo(ox + ux * len * t0, oy + uy * len * t0);
        g.lineTo(ox + ux * len * t1, oy + uy * len * t1);
        g.strokePath();
      }
      g.lineStyle(1.4 * s, WHITE, 0.5 * boost);
      g.beginPath();
      g.moveTo(ox, oy);
      g.lineTo(ox + ux * len * 0.55, oy + uy * len * 0.55);
      g.strokePath();
    }
  }

  // --- SILHOUETTE BACKING: guarantees contrast against ANY backdrop ---
  /** A dark halo behind the whole figure — existing per-limb outlines
   *  (see drawTorso's own 1-2px dark edge) are too thin to read as a
   *  silhouette at normal on-screen scale; this is broader and covers
   *  the full pose extent so the rig pops regardless of what's behind it. */
  protected drawSilhouetteBacking(
    g: Phaser.GameObjects.Graphics,
    pelvis: Vec2,
    chest: Vec2,
    head: Vec2,
    hipL: Vec2,
    hipR: Vec2,
    footL: Vec2,
    footR: Vec2,
    s: number,
  ) {
    g.fillStyle(DARK, 0.62);
    g.fillEllipse(chest.x, chest.y, 15 * s, 19 * s);
    g.fillEllipse(pelvis.x, pelvis.y, 12 * s, 12 * s);
    g.fillEllipse(head.x, head.y, 11 * s, 13 * s);
    g.fillEllipse((hipL.x + footL.x) / 2, (hipL.y + footL.y) / 2, 6 * s, (footL.y - hipL.y) / 2 + 4 * s);
    g.fillEllipse((hipR.x + footR.x) / 2, (hipR.y + footR.y) / 2, 6 * s, (footR.y - hipR.y) / 2 + 4 * s);
  }

  // --- TORSO: Filled armored body ---
  protected drawTorso(g: Phaser.GameObjects.Graphics, pelvis: Vec2, chest: Vec2, s: number) {
    const w1 = 11 * s; // chest width — leaner vessel taper, not armored bulk
    const w2 = 7.5 * s; // pelvis width

    // Dark outline
    g.fillStyle(DARK, 1);
    g.beginPath();
    g.moveTo(chest.x - w1 / 2 - 1, chest.y - 2 * s);
    g.lineTo(chest.x + w1 / 2 + 1, chest.y - 2 * s);
    g.lineTo(pelvis.x + w2 / 2 + 1, pelvis.y + 2 * s);
    g.lineTo(pelvis.x - w2 / 2 - 1, pelvis.y + 2 * s);
    g.closePath();
    g.fillPath();

    // Main body fill
    g.fillStyle(this.colorDark, 1);
    g.beginPath();
    g.moveTo(chest.x - w1 / 2, chest.y);
    g.lineTo(chest.x + w1 / 2, chest.y);
    g.lineTo(pelvis.x + w2 / 2, pelvis.y);
    g.lineTo(pelvis.x - w2 / 2, pelvis.y);
    g.closePath();
    g.fillPath();

    // Chest plate highlight
    g.fillStyle(this.color, 0.8);
    g.beginPath();
    g.moveTo(chest.x - w1 * 0.35, chest.y + 2 * s);
    g.lineTo(chest.x + w1 * 0.35, chest.y + 2 * s);
    g.lineTo(pelvis.x + w2 * 0.25, pelvis.y - 4 * s);
    g.lineTo(pelvis.x - w2 * 0.25, pelvis.y - 4 * s);
    g.closePath();
    g.fillPath();

    // Belt line
    g.fillStyle(DARK, 0.9);
    g.fillRect(pelvis.x - w2 / 2 + 1, pelvis.y - 3 * s, w2 - 2, 4 * s);

    // Upper-hemisphere rim arc — simulates directional light from above.
    // 200° → 340° (top arc), 2px, light warm color at alpha 0.20.
    g.lineStyle(2 * s, PALETTE.lightBeamWarm, 0.20);
    g.beginPath();
    g.arc(
      chest.x,
      chest.y,
      w1 / 2 + 1,
      Phaser.Math.DegToRad(200),
      Phaser.Math.DegToRad(340),
      false,
    );
    g.strokePath();
  }

  // --- SPINE GLOW: Energy filaments showing health ---
  protected drawSpineGlow(
    g: Phaser.GameObjects.Graphics,
    pelvis: Vec2,
    chest: Vec2,
    s: number,
    healthRatio: number,
    gripping: boolean,
  ) {
    const alpha = (0.3 + 0.6 * healthRatio) * (gripping ? 0.55 : 1);
    const color = healthRatio < 0.25 ? 0xfb7185 : this.accentColor;

    g.lineStyle(2 * s, color, alpha);
    g.beginPath();
    g.moveTo(pelvis.x, pelvis.y - 2 * s);
    g.lineTo(chest.x, chest.y + 2 * s);
    g.strokePath();

    // Rib filaments — two thinner, dimmer seams flanking the spine, angled
    // slightly outward. Sells "something alive glowing inside the vessel"
    // rather than a single wire down the middle.
    g.lineStyle(1 * s, color, alpha * 0.5);
    for (const side of [-1, 1] as const) {
      g.beginPath();
      g.moveTo(pelvis.x + side * 2.5 * s, pelvis.y - 4 * s);
      g.lineTo(chest.x + side * 4 * s, chest.y + 3 * s);
      g.strokePath();
    }

    // Centre glow dot
    const midY = (pelvis.y + chest.y) / 2;
    g.fillStyle(color, alpha * 0.6);
    g.fillCircle(pelvis.x, midY, 3 * s);
  }

  // --- MAD AURA: a turbulent halo of motes orbiting the vessel, each
  // trailing a short comet-tail. Three summed sine frequencies per mote
  // instead of a clean circular orbit — deliberately irregular, reads as
  // barely-contained energy rather than a decorative UI ring. Envelops the
  // whole body (pelvis to well above the head), not just the torso. ---
  protected drawAura(
    g: Phaser.GameObjects.Graphics,
    pelvis: Vec2,
    chest: Vec2,
    s: number,
    boost = 0,
  ) {
    const n =
      this.detail === "full"
        ? ProceduralPlayerRig.AURA_MOTE_COUNT
        : ProceduralPlayerRig.AURA_MOTE_LITE;
    if (n <= 0) return;
    const cx = (pelvis.x + chest.x) / 2;
    const cy = (pelvis.y + chest.y) / 2 - 10 * s;
    const t = this.stepPhase + this.auraSeed;
    const tails = this.detail === "full" ? 3 : 0;
    // Vibes lighting: sustained dancing charges the aura wider and
    // brighter, continuously — reads as the vessel visibly powering up
    // the longer the groove holds, with a slow shimmer once fully raised.
    const radiusBoost = 1 + boost * 0.32;
    const glowBoost = Math.min(1.6, 1 + boost * 0.65);

    const motePos = (i: number, tt: number): { x: number; y: number } => {
      const off = (i / n) * Math.PI * 2;
      const radius = (20 + 7 * Math.sin(tt * 0.7 + off * 2)) * s * radiusBoost;
      const angle = tt * (1.1 + i * 0.17) + off;
      const wobbleR = radius + 4 * s * Math.sin(tt * 2.3 + off);
      return {
        x: cx + Math.cos(angle) * wobbleR,
        y: cy + Math.sin(angle) * wobbleR * 0.8,
      };
    };

    for (let i = 0; i < n; i++) {
      const off = (i / n) * Math.PI * 2;
      const twinkle = (0.6 + 0.4 * Math.sin(t * 3.1 + off * 3)) * glowBoost;

      for (let e = tails; e >= 1; e--) {
        const echo = motePos(i, t - e * 0.05);
        const tailAlpha = twinkle * (0.28 - e * 0.05);
        g.fillStyle(this.auraColor, Math.max(0, tailAlpha));
        g.fillCircle(echo.x, echo.y, (2.5 - e * 0.4) * s);
      }

      const p = motePos(i, t);
      g.fillStyle(this.auraColor, Math.min(1, twinkle * 0.5));
      g.fillCircle(p.x, p.y, (5 + boost * 1.5) * s);
      g.fillStyle(this.auraColor, Math.min(1, twinkle * 0.95));
      g.fillCircle(p.x, p.y, 2.7 * s);
      if (this.detail === "full") {
        g.fillStyle(WHITE, Math.min(1, twinkle * 0.9));
        g.fillCircle(p.x, p.y, 1.15 * s);
      }
    }
  }

  // --- HIP DRAPE: a short cloth strip trailing off the pelvis — the
  // "wizard sash" that keeps the vessel from reading as pure armor plate.
  protected drawHipDrape(g: Phaser.GameObjects.Graphics, pelvis: Vec2, tip: Vec2, s: number) {
    const w = 5 * s;
    const nx = -(tip.y - pelvis.y);
    const ny = tip.x - pelvis.x;
    const len = Math.hypot(nx, ny) || 1;
    const px = (nx / len) * w;
    const py = (ny / len) * w;

    // Dark outline first (same outline-then-fill pattern as the limbs) so
    // the drape keeps a visible silhouette edge against the torso/legs
    // instead of blending into them.
    g.fillStyle(DARK, 1);
    g.beginPath();
    g.moveTo(pelvis.x - px * 0.7 - 1, pelvis.y - py * 0.7 - 1);
    g.lineTo(pelvis.x + px * 0.7 + 1, pelvis.y + py * 0.7 + 1);
    g.lineTo(tip.x + px * 0.3, tip.y + py * 0.3);
    g.lineTo(tip.x - px * 0.3, tip.y - py * 0.3);
    g.closePath();
    g.fillPath();

    g.fillStyle(this.colorDark, 1);
    g.beginPath();
    g.moveTo(pelvis.x - px * 0.6, pelvis.y - py * 0.6);
    g.lineTo(pelvis.x + px * 0.6, pelvis.y + py * 0.6);
    g.lineTo(tip.x + px * 0.25, tip.y + py * 0.25);
    g.lineTo(tip.x - px * 0.25, tip.y - py * 0.25);
    g.closePath();
    g.fillPath();

    // Accent glow trim, bolder than the first pass, along both edges.
    g.lineStyle(1.2 * s, this.accentColor, 0.6);
    g.beginPath();
    g.moveTo(pelvis.x + px * 0.6, pelvis.y + py * 0.6);
    g.lineTo(tip.x + px * 0.25, tip.y + py * 0.25);
    g.strokePath();
  }

  // --- HEAD CREST: the swept blade/fin every Warframe silhouette shares —
  // the single strongest identity marker the vessel was missing. Drawn
  // BEHIND the hood so the hood's base overlaps its root and only the
  // swept blade reads clearly above/behind the skull. ---
  protected drawHeadCrest(g: Phaser.GameObjects.Graphics, head: Vec2, s: number) {
    const f = this.facing;
    // Chassis silhouette (docs/chassis-design-axioms.md CA3): per-class
    // crest geometry lives in chassisSilhouette.ts as pure, unit-tested
    // point math. `classId` defaults to "wizard" (see the constructor),
    // which returns the EXACT pre-existing swept-fin geometry — a rig with
    // no classId passed draws byte-identical to before this branch
    // existed. Syzygist (priest) returns null: CA3's "no crest, no crown,
    // no fins... the quietest silhouette" — draw nothing.
    const crest = headCrestGeometry(this.classId, head, s, f);
    if (!crest) return;

    // Dark base — bigger swept silhouette than the first pass, so it reads
    // as a real fin/horn rather than a hood wrinkle.
    g.fillStyle(DARK, 1);
    g.beginPath();
    g.moveTo(crest.darkBase[0].x, crest.darkBase[0].y);
    g.lineTo(crest.darkBase[1].x, crest.darkBase[1].y);
    g.lineTo(crest.darkBase[2].x, crest.darkBase[2].y);
    g.closePath();
    g.fillPath();

    // Bright plate fill — full player color (not the darkened body shade),
    // so the crest visually separates from the hood instead of blending
    // into it.
    g.fillStyle(this.color, 1);
    g.beginPath();
    g.moveTo(crest.brightPlate[0].x, crest.brightPlate[0].y);
    g.lineTo(crest.brightPlate[1].x, crest.brightPlate[1].y);
    g.lineTo(crest.brightPlate[2].x, crest.brightPlate[2].y);
    g.closePath();
    g.fillPath();

    // Accent glow edge along the leading (upper) side, plus a soft outer
    // halo so the crest reads as energized, matching the visor.
    g.lineStyle(1.4 * s, this.visorColor, 0.8);
    g.beginPath();
    g.moveTo(crest.edgeLine[0].x, crest.edgeLine[0].y);
    g.lineTo(crest.edgeLine[1].x, crest.edgeLine[1].y);
    g.strokePath();
    g.fillStyle(this.visorColor, 0.35);
    g.fillCircle(crest.tipGlow.x, crest.tipGlow.y, 2 * s);
  }

  // --- HEAD: Hood + helmet + visor ---
  protected drawHead(g: Phaser.GameObjects.Graphics, head: Vec2, s: number, healthRatio: number) {
    const f = this.facing;

    this.drawHeadCrest(g, head, s);

    // Chassis silhouette (CA3): per-class hood outline, same
    // classId-defaults-to-"wizard" byte-identical-default-path guarantee
    // as drawHeadCrest above — see chassisSilhouette.ts.
    const hood = headHoodGeometry(this.classId, head, s, f);

    // Hood shadow (larger dark shape behind head) — narrower than the old
    // helmet build, reads as a sealed vessel-hull rather than a hard helmet.
    g.fillStyle(DARK, 1);
    g.beginPath();
    g.moveTo(hood.shadow[0].x, hood.shadow[0].y);
    g.lineTo(hood.shadow[1].x, hood.shadow[1].y);
    g.lineTo(hood.shadow[2].x, hood.shadow[2].y);
    g.lineTo(hood.shadow[3].x, hood.shadow[3].y);
    g.closePath();
    g.fillPath();

    // Hood main (player colored)
    g.fillStyle(this.colorDark, 1);
    g.beginPath();
    g.moveTo(hood.main[0].x, hood.main[0].y);
    g.lineTo(hood.main[1].x, hood.main[1].y);
    g.lineTo(hood.main[2].x, hood.main[2].y);
    g.lineTo(hood.main[3].x, hood.main[3].y);
    g.closePath();
    g.fillPath();

    // Face plate (darker inset)
    g.fillStyle(DARK2, 0.9);
    g.fillRoundedRect(head.x + f * 2 * s - 5 * s, head.y - 6 * s, 10 * s, 9 * s, 2 * s);

    // VISOR SEAM — the vessel's "face" is a thin line of light, not a thick
    // eye-slit: longer and narrower than the old helmet visor.
    const visorColor = healthRatio < 0.25 ? 0xfb7185 : this.visorColor;
    const visorAlpha = 0.7 + 0.3 * Math.sin(this.stepPhase * 2);

    // Outer glow
    g.fillStyle(visorColor, visorAlpha * 0.35);
    g.fillRoundedRect(head.x + f * 3 * s - 7.5 * s, head.y - 2.6 * s, 15 * s, 3 * s, 1.5 * s);

    // Core seam
    g.fillStyle(visorColor, visorAlpha);
    g.fillRect(head.x + f * 3 * s - 6.25 * s, head.y - 1.8 * s, 12.5 * s, 1.8 * s);

    // Inner bright spot (represents eye direction)
    g.fillStyle(WHITE, visorAlpha * 0.8);
    g.fillRect(head.x + f * 5 * s - 2 * s, head.y - 1.4 * s, 4 * s, 1.1 * s);
  }

  // --- SHOULDER STUB: crystal joint seal, not a bulky pauldron ---
  protected drawShoulderArmor(g: Phaser.GameObjects.Graphics, shoulder: Vec2, s: number) {
    g.fillStyle(DARK, 1);
    g.fillCircle(shoulder.x, shoulder.y, 4.5 * s);
    g.fillStyle(this.color, 0.9);
    g.fillCircle(shoulder.x, shoulder.y, 3.4 * s);

    // Crystal accent on shoulder
    g.fillStyle(this.jointColor, 0.7);
    g.fillCircle(shoulder.x, shoulder.y, 1.6 * s);
  }

  // --- HAND GLOW: a bare channeling hand, not a gun. Both hands get one —
  // the vessel doesn't hold a weapon, it channels straight from the palm.
  // `pulse` (0-1) is the ability/cast-trigger hook: triggerFire() drives
  // the lead hand's pulse today, but any future ability effect can drive
  // either hand's pulse the same way without touching this method. ---
  protected drawHandGlow(g: Phaser.GameObjects.Graphics, hand: Vec2, s: number, pulse: number) {
    // Bare palm — small dark disc, no barrel/weapon geometry.
    g.fillStyle(DARK, 1);
    g.fillCircle(hand.x, hand.y, 2.6 * s);
    g.fillStyle(this.colorDark, 1);
    g.fillCircle(hand.x, hand.y, 1.8 * s);

    // Channeled energy point just past the fingertips — ambient even at
    // rest (a wizard's hand is never fully dark), brighter and pulsing
    // when an ability/cast triggers OR a kill just landed (both hands read
    // the kill equally — it's not a hand-specific event).
    const killPulse = this.killPulseMs / ProceduralPlayerRig.KILL_PULSE_MS;
    pulse = Math.max(pulse, killPulse * 0.85);
    const baseGlow = 0.35;
    const pulseSize = 1 + pulse * 0.9;
    const radius = 3 * s * pulseSize;

    g.fillStyle(this.palmColor, (baseGlow * 0.5 + pulse * 0.35));
    g.fillCircle(hand.x, hand.y, radius * 2.2);
    g.fillStyle(this.palmColor, (baseGlow + pulse * 0.4));
    g.fillCircle(hand.x, hand.y, radius * 1.2);
    g.fillStyle(WHITE, (baseGlow * 0.6 + pulse * 0.4));
    g.fillCircle(hand.x, hand.y, radius * 0.5);
  }

  // --- SHURIKEN: a small 4-point spinning star cocked in each hand, the
  // projectile-in-waiting. Always spinning (idle read); on that hand's throw
  // (`throwAmount` 0-1) it brightens and stretches a motion streak along aim
  // — the shuriken leaving the hand. The shard spawn point IS this hand, so
  // a shot visibly launches from the exact hand mid-flick.
  protected drawShuriken(
    g: Phaser.GameObjects.Graphics,
    hand: Vec2,
    aim: Vec2,
    s: number,
    throwAmount: number,
  ) {
    const spin = this.shurikenSpin + (hand.x + hand.y) * 0.02; // desync L/R
    const size = (3.2 + throwAmount * 1.6) * s;
    const bright = 0.55 + throwAmount * 0.45;

    // Motion streak along aim as it's flung.
    if (throwAmount > 0.15) {
      const streak = throwAmount * 16 * s;
      g.lineStyle(2.2 * s, WHITE, throwAmount * 0.7);
      g.beginPath();
      g.moveTo(hand.x - aim.x * streak * 0.3, hand.y - aim.y * streak * 0.3);
      g.lineTo(hand.x + aim.x * streak, hand.y + aim.y * streak);
      g.strokePath();
    }

    // 4-point star (two crossed blades) spinning.
    g.lineStyle(1.8 * s, this.palmColor, bright);
    for (let i = 0; i < 2; i++) {
      const a = spin + (i * Math.PI) / 2;
      const dx = Math.cos(a) * size;
      const dy = Math.sin(a) * size;
      g.beginPath();
      g.moveTo(hand.x - dx, hand.y - dy);
      g.lineTo(hand.x + dx, hand.y + dy);
      g.strokePath();
    }
    // Bright core.
    g.fillStyle(WHITE, bright);
    g.fillCircle(hand.x, hand.y, 1.4 * s);
  }

  // --- THICK LIMB: Filled polygon instead of line ---
  protected drawThickLimb(
    g: Phaser.GameObjects.Graphics,
    root: Vec2,
    solve: LimbSolve,
    outerW: number,
    innerW: number,
  ) {
    // Dark outline limb — thicker so vessel reads over dense vault geometry
    g.lineStyle(outerW + 3.5, DARK, 1);
    g.beginPath();
    g.moveTo(root.x, root.y);
    g.lineTo(solve.joint.x, solve.joint.y);
    g.lineTo(solve.end.x, solve.end.y);
    g.strokePath();

    // Colored limb fill
    g.lineStyle(outerW, this.colorDark, 1);
    g.beginPath();
    g.moveTo(root.x, root.y);
    g.lineTo(solve.joint.x, solve.joint.y);
    g.lineTo(solve.end.x, solve.end.y);
    g.strokePath();

    // Inner highlight
    g.lineStyle(innerW * 0.5, this.color, 0.5);
    g.beginPath();
    g.moveTo(root.x, root.y);
    g.lineTo(solve.joint.x, solve.joint.y);
    g.strokePath();

    // Joint circle
    g.fillStyle(DARK, 1);
    g.fillCircle(solve.joint.x, solve.joint.y, outerW * 0.45);
    g.fillStyle(this.colorDark, 0.9);
    g.fillCircle(solve.joint.x, solve.joint.y, outerW * 0.3);
  }

  // --- BOOT: Sleek greave, not a heavy armored boot ---
  // Anchor convention: `foot.y` = the platform-top contact point (i.e.
  // the bottom edge of the boot sole). All three rects sit ABOVE foot.y.
  // Pre-fix, the sole rect spanned [foot.y - 0.3*bh, foot.y + 0.7*bh] —
  // bottom 4 px below the contact, so even a perfectly-grounded rig
  // visibly sank into the platform top. Combined with the airborne
  // walk-cycle lift this drove the user-visible flicker between "feet
  // floating" (lift trough) and "feet inside platform" (no-lift, sink).
  // See commit 7027a82 for the matching footPos gate.
  protected drawBoot(g: Phaser.GameObjects.Graphics, foot: Vec2, s: number) {
    const f = this.facing;
    const bw = 8 * s;
    const bh = 5 * s;

    // Boot sole — bottom edge at foot.y, full height bh above.
    g.fillStyle(DARK, 1);
    g.fillRoundedRect(foot.x - bw * 0.4 + f * 2 * s, foot.y - bh, bw, bh, 2 * s);

    // Boot upper — sits on top of the sole. Height 0.8*bh.
    g.fillStyle(this.colorDark, 1);
    g.fillRoundedRect(foot.x - bw * 0.35 + f * 2 * s, foot.y - bh - bh * 0.8, bw * 0.85, bh * 0.8, 2 * s);

    // Boot accent stripe — runs across the upper, ~half-height up.
    g.fillStyle(this.color, 0.6);
    g.fillRect(foot.x - bw * 0.2 + f * 2 * s, foot.y - bh - bh * 0.4, bw * 0.5, 2 * s);
  }

  // --- NAMEPLATE (plate-less) ---
  // No background rect. Name in textHi. Thin 2px hpLime underline as HP bar.
  /** Portrait badge radius (world px, pre-scale) — sized to sit flush
   *  against the plate's left edge without crowding short names. */
  private static readonly BADGE_R = 9;

  private drawNameplate(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    s: number,
    health: number,
    maxHealth: number,
  ) {
    const nameWidth = Math.max(52, this.name.length * 6.5) * s;
    const healthRatio = Phaser.Math.Clamp(health / Math.max(1, maxHealth), 0, 1);
    const badgeR = ProceduralPlayerRig.BADGE_R * s;
    // Plate spans the badge + a gap + the name; badge sits at the LEFT edge,
    // name text re-centers into the remaining width so short/long names both
    // stay visually balanced against the badge rather than the badge
    // floating off-center once names get long.
    const gap = 5 * s;
    const plateW = badgeR * 2 + gap + nameWidth;
    const plateLeft = x - plateW / 2;
    const badgeCx = plateLeft + badgeR;
    const nameCx = plateLeft + badgeR * 2 + gap + nameWidth / 2;
    const plateTop = y - 17 * s;
    const plateH = 15 * s;

    // Plate — soft drop shadow (directional, not a blur filter) then a
    // dark chip with a colored top-edge rule. Grounds the badge+name as
    // ONE unit instead of text just floating on the arena backdrop.
    g.fillStyle(0x000000, 0.28);
    g.fillRoundedRect(plateLeft - 3 * s + 1, plateTop + 1.5 * s, plateW + 6 * s, plateH, 6 * s);
    g.fillStyle(0x0b0e16, 0.62);
    g.fillRoundedRect(plateLeft - 3 * s, plateTop, plateW + 6 * s, plateH, 6 * s);

    // Portrait badge — a solid disc in the player's OWN rig color (the
    // "picture of the char" — this is literally their equipped color/
    // silhouette identity, not a generic avatar). Shared recipe with
    // HudSystem's screen-anchored badges (portraitBadge.ts) so the
    // in-world nameplate and the HUD frames read as the same identity
    // system, not two different avatar styles.
    drawPortraitBadge(
      g,
      badgeCx,
      y - 9.5 * s,
      badgeR,
      this.color,
      this.identitySeed,
      this.colorDark,
      this.accentColor,
    );

    // Name text — re-centered into the plate's name column (see nameCx).
    this.nameText.setText(this.name);
    this.nameText.setPosition(nameCx, y - 6 * s);

    // Gold instrument-rule underline (dim track + live gold fill) doubles
    // as the health readout — matches the platform hull-chrome's own
    // gold-rule language (PlatformPainter's drawRimHighlight) rather than
    // a disconnected default-HUD health-bar color. Now spans the FULL
    // plate (badge included) so the health state reads for the whole
    // identity chip, not just the name half.
    const lineY = y - 4 * s;
    const lineX = plateLeft - 3 * s + 4 * s;
    const lineW = plateW + 6 * s - 8 * s;
    g.fillStyle(0x3a3020, 0.7);
    g.fillRect(lineX, lineY, lineW, 2);
    g.fillStyle(0xffd76b, 1);
    g.fillRect(lineX, lineY, lineW * healthRatio, 2);
  }

  // --- WALL-PLANT FOOT: a tucked knee bracing flat against the gripped
  // wall — closer to the body than a straight-leg reach (was 42*s out at
  // pelvis+6, a long diagonal that combined with the wall-plant arm's own
  // diagonal read as a symmetric cross/pinwheel silhouette from some
  // angles). Doesn't need the wall's actual world-space position: pushing
  // the target this far toward it is enough for solveTwoBone's reach clamp
  // to read as "bracing against something in that direction."
  private wallPlantFoot(cx: number, wallDir: number, pelvis: Vec2, s: number): Vec2 {
    return vec(cx + wallDir * 22 * s, pelvis.y - 6 * s);
  }

  // --- ARM TARGETS: a two-handed Kamehameha-style charge stance, not two
  // independently-posed limbs. Both arms are IDENTICAL length
  // (ARM_UPPER/ARM_LOWER); "straight" is never a special-cased draw path,
  // it's just an IK hand target placed exactly at the edge of the reach
  // circle (see straightTarget()) — solveTwoBone's own reach clamp then
  // yields a joint angle of ~0. The only two states that place a target
  // CLOSER than full reach (and so actually bend) are the wall-plant and
  // the release thrust's back hand trailing a hair short of the lead.
  //
  // The first version of this gave each arm its own running-gait swing,
  // which read as tangled/broken (the two independently-bent limbs kept
  // crossing in front of the torso). Converging both hands on one shared
  // charge point removes that failure mode entirely: there's only ever
  // ONE bend geometry to solve for a moving/idle vessel, not two competing
  // ones. It also gives the "orb between the hands" a real anchor point —
  // the natural spawn origin for a future projectile/ability effect. ---
  private computeArmTargets(
    shoulderLead: Vec2,
    shoulderBack: Vec2,
    aim: Vec2,
    walkAmount: number,
    wallDir: number,
    dashing: boolean,
    leadThrow: number,
    backThrow: number,
    s: number,
    sprint = 0,
    victoryPoseMs = 0,
  ): { lead: Vec2; back: Vec2 } {
    const reach = ProceduralPlayerRig.ARM_REACH * s;

    if (victoryPoseMs > 0) {
      // The induction pose: both arms raised wide overhead, a fixed target
      // (springs settle into it, so it arrives with weight, not a snap).
      // Highest priority — overrides combat/dash/sprint entirely.
      return {
        lead: vec(shoulderLead.x + this.facing * 14 * s, shoulderLead.y - 46 * s),
        back: vec(shoulderBack.x - this.facing * 14 * s, shoulderBack.y - 46 * s),
      };
    }

    if (dashing) {
      // DASH-BASH guard: both arms brace forward along the lunge — the shield
      // deployed in the travel direction.
      return {
        lead: this.straightTarget(shoulderLead, aim, reach),
        back: this.straightTarget(shoulderBack, aim, reach * 0.94),
      };
    }

    if (wallDir !== 0) {
      // Back hand plants against the gripped wall; the FREE (lead) hand still
      // throws — route whichever throw is live to it so a shot off the wall
      // always reads on the working hand.
      return {
        lead: this.recoilTarget(
          this.readyHandTarget(shoulderLead, aim, s),
          shoulderLead,
          aim,
          reach,
          Math.max(leadThrow, backThrow),
        ),
        back: vec(shoulderBack.x + wallDir * 20 * s, shoulderBack.y + 2 * s),
      };
    }

    // SPRINT ARM PUMP (run reference: fists pump counter-phase, the forward
    // fist rising toward the face, the rear arm driving back) — only while
    // genuinely sprinting and NOT actively shooting: any live throw or
    // recent fire falls through to the ready/recoil stance below, so
    // run-and-gun always reads the shot first and resumes pumping ~a second
    // after the last shot. Tangle-safe by construction: the two targets are
    // mirror-symmetric along the facing axis (they can only meet at the
    // crossover instant, where their heights differ), unlike the old
    // independent-gait arms that could cross mid-torso.
    // The arm behavior LADDER — arms are ARMS first, weapons second:
    //   combat (shot in the last ~1.6s) → cocked ready/throw stance
    //   top-speed sprint                → ninja sweep (both trail back)
    //   mid-speed run                   → counter-phase pump
    //   walking                        → natural low arm swing
    //   still                          → hang at the sides, breathing
    // The permanent shuriken-by-the-ear pose was the "don't behave like
    // arms" bug: it's a combat stance, so now it only appears in combat.
    const firingNow = leadThrow > 0.01 || backThrow > 0.01 || this.firePulse > 0.04;
    const inCombat = firingNow || this.combatHoldMs > 0;

    if (!inCombat && sprint <= 0.35) {
      // LOW-KEY READY: relaxed is never limp — the LEAD hand rides
      // half-cocked at the front hip (a gunslinger's rest, shuriken
      // palmed), so the draw-to-throw is one short whip, not a full
      // hip-to-ear-to-extend journey. Only the back arm truly hangs.
      const f = this.facing;
      if (walkAmount > 0.15) {
        // NATURAL WALK SWING: back hand swings low counter-phase like a
        // person walking; lead hand keeps its half-cock with a soft echo
        // of the swing.
        const swingL = Math.sin(this.stepPhase + Math.PI) * 3 * s * walkAmount;
        const swingB = Math.sin(this.stepPhase) * 5 * s * walkAmount;
        return {
          lead: vec(shoulderLead.x + f * (4 * s + swingL * 0.5), shoulderLead.y + 9 * s),
          back: vec(shoulderBack.x + f * swingB, shoulderBack.y + 15 * s - Math.abs(swingB) * 0.2),
        };
      }
      // HANG (idle): lead half-cocked at the hip, back arm resting,
      // both drifting with the breath.
      const sway = Math.sin(this.idlePhase * 2.1) * 0.8 * s;
      const hangLead = vec(shoulderLead.x + f * 4 * s, shoulderLead.y + 9 * s + sway);
      const hangBack = vec(shoulderBack.x - f * 1.5 * s, shoulderBack.y + 16 * s + sway * 0.7);
      if (this.danceRaise > 0.01) {
        // POP AND LOCK (restyled 2026-07-15 from a continuous fist-pump
        // wobble): the longer a sustained dance groove holds, the higher
        // the arms climb toward ready-to-pop — continuously blended
        // against danceRaise (0..1), same mechanism as before. What's
        // different is the target itself: rollLockPose() only changes it
        // once per bar (this.lockLeadOffsetX/Y etc — see its own comment),
        // so between bars the target is COMPLETELY FIXED — the already-
        // snappy armFreq/armDamp spring settles onto it and holds still
        // (the "lock"), instead of continuously drifting/waving. The snap
        // ITSELF is the beat reaction now, not an added wobble on top of
        // one. beatHit still nudges the reach slightly for a little extra
        // punch right on the hit that changes the lock.
        const beatHit = Math.max(0, this.beatHitSpring.value) * this.danceEnergy;
        const raisedLead = vec(
          shoulderLead.x + this.lockLeadOffsetX * s * (1 + beatHit * 0.12),
          shoulderLead.y + this.lockLeadOffsetY * s * (1 + beatHit * 0.12),
        );
        const raisedBack = vec(
          shoulderBack.x + this.lockBackOffsetX * s * (1 + beatHit * 0.12),
          shoulderBack.y + this.lockBackOffsetY * s * (1 + beatHit * 0.12),
        );
        const r = this.danceRaise;
        return {
          lead: vec(
            Phaser.Math.Linear(hangLead.x, raisedLead.x, r),
            Phaser.Math.Linear(hangLead.y, raisedLead.y, r),
          ),
          back: vec(
            Phaser.Math.Linear(hangBack.x, raisedBack.x, r),
            Phaser.Math.Linear(hangBack.y, raisedBack.y, r),
          ),
        };
      }
      return { lead: hangLead, back: hangBack };
    }

    // NINJA SWEEP (top speed): past ~¾ sprint both arms stream BACK behind
    // the torso, low, with a small counter-phase flutter — the anime-ninja
    // full-commitment silhouette (run-reference style #2, torso near
    // horizontal, arms trailing). Any shot still snaps straight to the
    // throw stance below — run-and-gun overrides the sweep instantly.
    if (!firingNow && sprint > 0.72) {
      const n = (sprint - 0.72) / 0.28;
      const f = this.facing;
      const flutterL = Math.sin(this.stepPhase + Math.PI) * 2.5 * s;
      const flutterB = Math.sin(this.stepPhase) * 2.5 * s;
      return {
        lead: vec(
          shoulderLead.x - f * (14 + n * 6) * s,
          shoulderLead.y + (4 + n * 4) * s + flutterL,
        ),
        back: vec(
          shoulderBack.x - f * (12 + n * 6) * s,
          shoulderBack.y + (6 + n * 4) * s + flutterB,
        ),
      };
    }
    if (!firingNow && sprint > 0.35) {
      const pump = (sprint - 0.35) / 0.65;
      const f = this.facing;
      const amp = Phaser.Math.Linear(4, 12, pump) * s;
      const swingLead = Math.sin(this.stepPhase + Math.PI); // counter-phase to its own-side leg
      const swingBack = Math.sin(this.stepPhase);
      return {
        lead: vec(
          shoulderLead.x + f * swingLead * amp - f * 2 * s,
          shoulderLead.y - 3 * s - Math.max(0, swingLead) * 6 * s * pump + Math.max(0, -swingLead) * 3 * s,
        ),
        back: vec(
          shoulderBack.x + f * swingBack * amp - f * 2 * s,
          shoulderBack.y - 3 * s - Math.max(0, swingBack) * 6 * s * pump + Math.max(0, -swingBack) * 3 * s,
        ),
      };
    }

    // Idle / running / airborne: each hand rests INDEPENDENTLY at its own
    // ready position (a shuriken cocked at each hip) and flicks out toward
    // aim only on ITS OWN throw — the alternation means only one hand is
    // extended at a time, so the two limbs never cross (the old failure mode
    // the converged charge-stance was avoiding). A gentle opposite-phase bob
    // keeps the idle/run read alive.
    const leadBob = walkAmount > 0.05 ? Math.sin(this.stepPhase * 2) * 2 * s * walkAmount : 0;
    const backBob = walkAmount > 0.05 ? Math.sin(this.stepPhase * 2 + Math.PI) * 2 * s * walkAmount : 0;
    return {
      lead: this.recoilTarget(
        this.readyHandTarget(shoulderLead, aim, s, leadBob),
        shoulderLead,
        aim,
        reach,
        leadThrow,
      ),
      back: this.recoilTarget(
        this.readyHandTarget(shoulderBack, aim, s, backBob),
        shoulderBack,
        aim,
        reach,
        backThrow,
      ),
    };
  }

  /** The COCKED ready pose for one hand: shuriken held up and slightly
   *  BEHIND its own shoulder (by the ear), a pitcher's set position. The
   *  throw whips from here forward toward aim, so the arm travels UP-and-OVER
   *  the top — an overhand/baseball pitch, not a side-arm lob. Independent
   *  per hand (keys off its own shoulder). `bob` adds the idle/run rhythm.
   *  `aim` is unused for the rest pose but kept for signature symmetry. */
  private readyHandTarget(shoulder: Vec2, _aim: Vec2, s: number, bob = 0): Vec2 {
    return vec(
      shoulder.x - this.facing * 7 * s, // cocked slightly BEHIND the shoulder
      shoulder.y - 11 * s + bob, // and UP, above the shoulder (by the ear)
    );
  }

  /** Blend a resting (charge-hold) hand target toward a full thrust along
   *  `aim` by `fireRecoil` (0-1). The hand spring lags the blend, so a shot
   *  reads as a snap-out toward the target and a settle back — the throw
   *  motion — rather than the arm just teleporting to the extended pose. */
  private recoilTarget(
    hold: Vec2,
    shoulder: Vec2,
    aim: Vec2,
    reach: number,
    fireRecoil: number,
  ): Vec2 {
    if (fireRecoil <= 0) return hold;
    const thrust = this.straightTarget(shoulder, aim, reach);
    return vec(
      hold.x + (thrust.x - hold.x) * fireRecoil,
      hold.y + (thrust.y - hold.y) * fireRecoil,
    );
  }

  /** A hand target at EXACTLY max arm reach in direction `dir` from
   *  `shoulder`. solveTwoBone's own dist clamp then yields a joint angle
   *  of ~0 — a dead-straight limb — with zero special-casing. */
  private straightTarget(shoulder: Vec2, dir: Vec2, reach: number): Vec2 {
    return vec(shoulder.x + dir.x * reach, shoulder.y + dir.y * reach);
  }

  /** Spasmodic arm-throw (2026-07-15) — kicks `hand`'s spring wide, up,
   *  and outward with a randomized angle + magnitude so repeated throws
   *  don't look identical (Jake: "spasmodically"). Called from the
   *  beat-hit block above, both for immediate on-beat throws and for
   *  throws scheduled on a dotted (syncopated) subdivision. Pure velocity
   *  kick — armFreq/armDamp (already snappy at high danceRaise) pull it
   *  back to the normal target afterward, so this reads as a sudden fling
   *  that gets reeled back in, not a pose change. */
  private triggerArmThrow(hand: 0 | 1): void {
    const s = this.scale;
    const outSign = hand === 0 ? this.facing : -this.facing;
    const baseAngle = -Math.PI * 0.6; // mostly up, biased outward
    const angle = baseAngle + (Math.random() - 0.5) * 1.1;
    const mag = ProceduralPlayerRig.THROW_KICK * (0.7 + Math.random() * 0.55) * s;
    const vx = Math.cos(angle) * mag * outSign;
    const vy = Math.sin(angle) * mag;
    const wobbleKick = ProceduralPlayerRig.ELBOW_WOBBLE_KICK * (Math.random() < 0.5 ? -1 : 1);
    if (hand === 0) {
      this.leadHandSpringX = springKick(this.leadHandSpringX, vx);
      this.leadHandSpringY = springKick(this.leadHandSpringY, vy);
      this.leadElbowWobble = springKick(this.leadElbowWobble, wobbleKick);
    } else {
      this.backHandSpringX = springKick(this.backHandSpringX, vx);
      this.backHandSpringY = springKick(this.backHandSpringY, vy);
      this.backElbowWobble = springKick(this.backElbowWobble, wobbleKick);
    }
  }

  /** Pop-and-lock pose roll (2026-07-15) — picks a fresh WIDE, elbows-out
   *  offset pair for both hands, called once per bar (every 4th detected
   *  beat hit). "freely" (Jake) means genuinely randomized, not a fixed
   *  rotation of a small pose set — every bar looks a little different.
   *  Both hands always land outward (away from the body, via `this.facing`)
   *  and at a varied height, echoing the "arms drawn above shoulder, held"
   *  reference pose without repeating it exactly every time. */
  private rollLockPose(): void {
    // Budgeted to comfortably under ARM_REACH (40): worst case
    // hypot(24, 28) ≈ 37. Past ~37-38 solveTwoBone's own reach clamp
    // (upper+lower) pins the elbow dead-center on the shoulder→hand line
    // (jointAngle → 0) — a rigid straight rod with NO visible elbow at
    // all, which is exactly what "arms dont swing past the elbows" was
    // catching (the old 20-42/-62-14 range hit ~75, nearly 2x reach,
    // maxed out every single time). Staying under budget guarantees a
    // real, visible elbow bend at every locked pose.
    const wideMin = 10;
    const wideMax = 24;
    const highMin = -28; // most above the shoulder
    const highMax = -6; // some closer to shoulder height
    this.lockLeadOffsetX = (wideMin + Math.random() * (wideMax - wideMin)) * this.facing;
    this.lockLeadOffsetY = highMin + Math.random() * (highMax - highMin);
    this.lockBackOffsetX = -(wideMin + Math.random() * (wideMax - wideMin)) * this.facing;
    this.lockBackOffsetY = highMin + Math.random() * (highMax - highMin);
    // A fresh bar-lock is a big snap for both arms — kick both elbow
    // wobblers (independently signed) so they trail into the new pose.
    this.leadElbowWobble = springKick(
      this.leadElbowWobble,
      ProceduralPlayerRig.ELBOW_WOBBLE_KICK * (Math.random() < 0.5 ? -1 : 1),
    );
    this.backElbowWobble = springKick(
      this.backElbowWobble,
      ProceduralPlayerRig.ELBOW_WOBBLE_KICK * (Math.random() < 0.5 ? -1 : 1),
    );
  }

  // --- FOOT POSITION ---
  private footPos(
    cx: number,
    side: -1 | 1,
    ground: number,
    walk: number,
    sprint: number,
    _crouch: boolean,
    grounded: boolean,
  ): Vec2 {
    const s = this.scale;
    // Use continuous crouch blend so stride/lift ease with duck/stand.
    const cr = this.crouchBlend;
    const cycle = this.stepPhase + (side === -1 ? 0 : Math.PI);
    // Stride lengthens hard at sprint (run reference keyframe 2: the flight
    // pose is a near-full split, not a shuffle) and lift rises with it —
    // higher exponent at sprint = snappier plant, longer float.
    const stride = Phaser.Math.Linear(20, 11, cr) * (1 + sprint * 0.75) * s * walk;
    const liftRaw = Math.max(0, Math.sin(cycle));
    const lift = grounded
      ? Math.pow(liftRaw, Phaser.Math.Linear(1.55, 2.1, sprint)) *
        Phaser.Math.Linear(9, 4.5, cr) *
        (1 + sprint * 0.9) *
        s *
        walk
      : 0;
    const spread = Phaser.Math.Linear(7.5, 11, cr) * s;

    // AIRBORNE POSE (fixes the "silly jump"): rising = both legs TUCK
    // (knees up under the body, lead knee higher), falling = the lead leg
    // REACHES down-and-forward for the landing while the back leg folds up
    // behind. Replaces feet dangling at full extension and swinging with
    // the (meaningless mid-air) stride cycle.
    if (!grounded) {
      const isLead = side === -1;
      const up = Math.max(0, this.airPose);
      const down = Math.max(0, -this.airPose);
      const f = this.facing;
      const tuckLift = (isLead ? 24 * up + 2 * down : 15 * up + 12 * down) * s;
      const push = (isLead ? f * (3 * up + 8 * down) : f * (-6 * up - 5 * down)) * s;
      return vec(cx + side * spread + push, ground - tuckLift);
    }

    // PERTH SHUFFLE footwork (2026-07-15) — only when truly idle (not
    // blended with real walking) and actively dancing. Running Man:
    // anti-phase per foot (same shape as the walk cycle above, but on
    // groovePhase — tempo-synced to the beat — instead of the separate
    // walk-cycle stepPhase, so footwork speeds up with the actual dance
    // energy exactly like the torso bounce does). T-step is approximated
    // as a stance-width pulse (see the class-field header comment on why
    // — a 2D side-view rig has no true lateral axis for the literal
    // 3-axis technique). Previously this branch didn't exist at all —
    // feet were completely static while idle-dancing.
    if (walk < 0.05 && this.danceEnergy > 0.05) {
      const shuffleCycle =
        this.groovePhase * ProceduralPlayerRig.SHUFFLE_STEP_HZ_MULT + (side === -1 ? 0 : Math.PI);
      const shuffleLiftRaw = Math.max(0, Math.sin(shuffleCycle));
      const shuffleLift =
        Math.pow(shuffleLiftRaw, 1.6) * ProceduralPlayerRig.SHUFFLE_LIFT_PX * s * this.danceEnergy;
      const shuffleStride =
        -Math.cos(shuffleCycle) *
        ProceduralPlayerRig.SHUFFLE_STRIDE_PX *
        s *
        this.danceEnergy *
        this.facing;
      const spreadPulse =
        Math.sin(shuffleCycle * 0.5) *
        ProceduralPlayerRig.SHUFFLE_SPREAD_PULSE_PX *
        s *
        this.danceEnergy;
      return vec(cx + side * (spread + spreadPulse) + shuffleStride, ground - shuffleLift);
    }

    // Slight out-of-phase lateral wobble per foot for floppy gait.
    const drunkFoot = Math.sin(cycle * 0.5 + side) * 1.6 * s * walk;
    // KNEE DRIVE (run reference keyframe 1): the lifted recovery leg punches
    // FORWARD of the hip at sprint, not just up — this is what turns a
    // leg-swing into a sprinter's drive.
    const kneeDrive = liftRaw * sprint * 7 * s * this.facing * walk;
    return vec(
      cx + side * spread - Math.cos(cycle) * stride * this.facing + drunkFoot + kneeDrive,
      ground - lift,
    );
  }
}

// --- Utility ---

function solveTwoBone(
  root: Vec2,
  target: Vec2,
  upper: number,
  lower: number,
  bend: number,
): LimbSolve {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const dist = Phaser.Math.Clamp(Math.hypot(dx, dy), 0.001, upper + lower - 0.001);
  const angle = Math.atan2(dy, dx);
  const jointAngle = Math.acos(
    Phaser.Math.Clamp((upper * upper + dist * dist - lower * lower) / (2 * upper * dist), -1, 1),
  );
  const ua = angle + jointAngle * bend;
  return {
    joint: vec(root.x + Math.cos(ua) * upper, root.y + Math.sin(ua) * upper),
    end: target,
  };
}

function vec(x: number, y: number): Vec2 {
  return { x, y };
}
