// Live-Phaser construct harness — boots the ACTUAL construct code in a real
// Phaser engine (not the offline canvas mock), so the presentation harness loop
// can read the real render + MOTION without wiring into the live match scene
// (uncommitted/dirty under a parallel pass). Collision-free: a standalone entry
// (client/harness.html) served by JAKESJAM's own vite dev server (:5174).
//
// Two demos, switched by command:
//  - "entangle" (default): drives the REAL ConstructVfxController with a
//    synthetic WorldState — state -> planEntanglement -> controller -> off-pool
//    tether + pooled bursts/motes; mark/unmark fire bind/snap via real state.
//  - "kindled": the paladin divine ward — a persistent faceted dome drawn into a
//    dedicated off-pool layer (never the shared pool), plus raise/absorb/drop
//    one-shots and the Kindled Edge weapon.
//
// A page-error surfaces to the screenshot script — the port + integration
// validation the offline preview cannot do.

import Phaser from "phaser";
import { ParticlePool } from "./game/systems/ParticlePool";
import { transientVfx } from "./game/render/TransientVfx";
import { ConstructVfxController } from "./game/systems/ConstructVfxController";
import { StatusVfxController } from "./game/systems/StatusVfxController";
import {
  spawnCrystalShards,
  drawWardSlab,
  spawnWardRaise,
  spawnWardAbsorb,
  spawnWardDrop,
  GEOMETRICIAN_TINT,
  KINDLED_TINT,
  INTERSTICE_TINT,
  SYZYGIST_TINT,
  drawBladeSwing,
  drawKindledSwing,
  drawKindledBash,
  drawHeldDaggers,
  drawHeldEdges,
  spawnNovaBurst,
  drawBuffAura,
  spawnBlinkStreak,
  drawGroundField,
  spawnGhostGuardDodge,
  spawnMeleeDebris,
  spawnKillShockRing,
} from "./game/render/LightConstruct";
import { meleeBladeAngle } from "./game/render/meleeTiming.js";
import type { CharacterArchetype, PlayerId, SimEvent, Vec2, WorldState } from "./sim";
import {
  ProceduralPlayerRig,
  type ProceduralPlayerPose,
} from "./game/rendering/ProceduralPlayerRig.js";
import type { AbilityKind, ClassId } from "./sim/data/cardTypes.js";
import { ABILITY_ANIMATIONS, isAbilityKind } from "./game/render/abilityAnimation.js";

type HarnessWindow = Window & {
  __harnessReady?: boolean;
  __harnessHasBash?: boolean;
  __harnessHasIdle?: boolean;
  /** Victim-channel review actions ("hurt"/"hurt-kill") exist — K2's
   *  "harness can't stage victim interaction" limitation is closed. */
  __harnessHasHurt?: boolean;
  __cmd?: string | null;
  harnessFire?: (name: string) => void;
  harnessMeleeFrame?: (kind: "ninja" | "paladin", t: number) => void;
  harnessRigFrame?: (
    classId: ClassId,
    action: AbilityKind | "melee" | "bash" | "idle" | "run" | "hurt" | "hurt-kill",
    t: number,
  ) => void;
};

const resolveClassId = (cid: CharacterArchetype): string => (cid === "shielded" ? "priest" : "wizard");

const KINDLED_POS: Vec2 = { x: 340, y: 200 }; // paladin body
const KINDLED_SLAB: Vec2 = { x: 402, y: 208 }; // the shield HELD to the front

class HarnessScene extends Phaser.Scene {
  private pool!: ParticlePool;
  private controller!: ConstructVfxController;
  private wardLayer!: Phaser.GameObjects.Graphics;
  private meleeReviewLayer!: Phaser.GameObjects.Graphics;
  private priest!: Phaser.GameObjects.Arc;
  private priestHalo!: Phaser.GameObjects.Arc;
  private victim!: Phaser.GameObjects.Arc;
  private victimHalo!: Phaser.GameObjects.Arc;
  private kindled!: Phaser.GameObjects.Arc;
  private kindledHalo!: Phaser.GameObjects.Arc;
  private t = 0;
  private wardPhase = 0;
  private markActive = true;
  private mode: "entangle" | "kindled" = "entangle";
  private wardActive = false;
  private wardIntensity = 0; // eases toward wardActive so raise/drop ramp smoothly
  private victimPos: Vec2 = { x: 520, y: 170 };
  private meleeReview: { kind: "ninja" | "paladin"; t: number } | null = null;
  private reviewRig: ProceduralPlayerRig | null = null;
  private rigReview: {
    classId: ClassId;
    action: AbilityKind | "melee" | "bash" | "idle" | "run" | "hurt" | "hurt-kill";
    t: number;
    lead: Vec2;
    back: Vec2;
    tipHistory: Vec2[];
  } | null = null;
  // Phase 3 primitive demo state — continuous-redraw layers (aura/field) plus
  // toggle booleans; nova/blink/dodge are one-shot pooled transients fired
  // straight from the switch below, same as "shards".
  private auraDemoLayer!: Phaser.GameObjects.Graphics;
  private fieldDemoLayer!: Phaser.GameObjects.Graphics;
  private auraDemoStyle: "slash" | "ooze" | "shatter" | "seal" | null = null;
  private fieldDemoActive = false;
  // Track L status-read driver (StatusVfxController): synthetic fields
  // merged into the demo fighters each frame + a one-frame event queue.
  // "st-*" harnessFire commands set these; the ORBITING victim doubles as
  // the read's body so tracking is visible in the filmstrip.
  private statusCtl!: StatusVfxController;
  private bodyFields: Record<string, unknown> = {};
  private hunterFields: Record<string, unknown> = {};
  private statusEvents: SimEvent[] = [];

  constructor() {
    super("harness");
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#12151c");
    this.pool = new ParticlePool(this);
    transientVfx.attach(this);
    this.controller = new ConstructVfxController(this, this.pool);
    this.statusCtl = new StatusVfxController(this, this.pool);

    // Off-pool ward layer (mirrors the controller's off-pool tether layer).
    this.wardLayer = this.add.graphics();
    this.wardLayer.setBlendMode(Phaser.BlendModes.ADD);
    this.wardLayer.setDepth(6);
    this.meleeReviewLayer = this.add.graphics().setDepth(30);
    this.meleeReviewLayer.setBlendMode(Phaser.BlendModes.ADD);
    this.auraDemoLayer = this.add.graphics().setDepth(9);
    this.auraDemoLayer.setBlendMode(Phaser.BlendModes.ADD);
    this.fieldDemoLayer = this.add.graphics().setDepth(3);
    this.fieldDemoLayer.setBlendMode(Phaser.BlendModes.ADD);

    this.priestHalo = this.add
      .circle(200, 220, 30, 0xffcc88, 0.18)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(20);
    this.priest = this.add.circle(200, 220, 13, 0x8fd0ff, 1).setDepth(20);
    this.victimHalo = this.add.circle(520, 170, 30, 0xffcc88, 0.28).setBlendMode(Phaser.BlendModes.ADD).setDepth(20);
    this.victim = this.add.circle(520, 170, 13, 0xf0c48a, 1).setDepth(20);

    // Kindled paladin — hidden until switched to.
    this.kindledHalo = this.add
      .circle(KINDLED_POS.x, KINDLED_POS.y, 26, 0xffd9a0, 0.22)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(20)
      .setVisible(false);
    this.kindled = this.add.circle(KINDLED_POS.x, KINDLED_POS.y, 13, 0xffe6b0, 1).setDepth(20).setVisible(false);

    const w = window as HarnessWindow;
    w.__cmd = null;
    w.harnessFire = (name: string) => {
      w.__cmd = name;
    };
    w.__harnessHasBash = true;
    w.__harnessHasIdle = true;
    w.__harnessHasHurt = true;
    w.harnessMeleeFrame = (kind, t) => {
      this.meleeReview = { kind, t: Math.max(0, Math.min(0.999, t)) };
      this.rigReview = null;
    };
    w.harnessRigFrame = (classId, action, rawT) => {
      const t = Math.max(0, Math.min(0.999, rawT));
      const stanceAction = action === "idle" || action === "run";
      const hurtAction = action === "hurt" || action === "hurt-kill";
      if (action !== "melee" && action !== "bash" && !stanceAction && !hurtAction && !isAbilityKind(action)) return;
      this.meleeReview = null;
      // Isolate the fighter review: hidden entanglement-demo actors must not
      // keep a live mark/tether behind the pose and contaminate silhouettes.
      this.markActive = false;
      this.reviewRig?.destroy();
      const colors: Record<ClassId, { body: number; accent: number; name: string }> = {
        wizard: { body: 0x8fcfff, accent: 0x67e8f9, name: "GEOMETRICIAN" },
        ninja: { body: 0x69e6ff, accent: 0x22d3ee, name: "INTERSTICE" },
        paladin: { body: 0xffd98a, accent: 0xfbbf24, name: "KINDLED" },
        priest: { body: 0xe7edf7, accent: 0xcbd5e1, name: "SYZYGIST" },
      };
      const skin = colors[classId];
      this.reviewRig = new ProceduralPlayerRig(this, {
        color: skin.body,
        accentColor: skin.accent,
        classId,
        name: skin.name,
        identitySeed: `harness-${classId}`,
        detail: "full",
        scale: 1.15,
      });
      const pose: ProceduralPlayerPose = {
        position: { x: 330, y: 350 },
        velocity: { x: 0, y: 0 },
        aimTarget: { x: 560, y: 285 },
        grounded: true,
        crouching: false,
        health: 100,
        maxHealth: 100,
      };
      // Establish stable springs before the authored event, then advance in
      // fixed 120 Hz increments. Rebuilding per requested frame makes captures
      // independent of browser/screenshot latency.
      for (let i = 0; i < 16; i++) this.reviewRig.update(1000 / 120, pose);
      // Stance reviews (braced idle / locomotion): no authored event — just
      // settle the rig in the stance long enough for the springs to speak.
      if (stanceAction) {
        const stancePose: ProceduralPlayerPose = action === "run"
          ? { ...pose, velocity: { x: 300, y: 0 } }
          : pose;
        for (let i = 0; i < 240; i++) this.reviewRig.update(1000 / 120, stancePose);
        this.rigReview = {
          classId,
          action,
          t,
          lead: this.reviewRig.getHandWorld(0) ?? { x: 360, y: 300 },
          back: this.reviewRig.getHandWorld(1) ?? { x: 340, y: 310 },
          tipHistory: [],
        };
        for (const obj of [this.priest, this.priestHalo, this.victim, this.victimHalo, this.kindled, this.kindledHalo]) {
          obj.setVisible(false);
        }
        return;
      }
      // Victim-channel review (R1 rows 3-8; K6/K8 wave 2 — closes K2's
      // "harness can't stage victim interaction" limitation): stage the
      // contact chord ON the rig exactly as SimEventRouter would —
      // applyPairImpact with the class chassis — and advance t across a
      // 700ms envelope (pair hold + flash decay + squash spring all
      // complete inside it; kill tier's 225ms victim hold included). The
      // hit vector is left-to-right with a slight downward bite so the
      // directional flinch and squash read against the grounded stance.
      if (hurtAction) {
        const chassis = classId === "paladin" ? "kindled" : "interstice";
        this.reviewRig.applyPairImpact("victim", 1, 0.15, chassis, action === "hurt-kill");
        const HURT_ENVELOPE_MS = 700;
        const totalMs = HURT_ENVELOPE_MS * t;
        const steps = Math.max(1, Math.ceil(totalMs / (1000 / 120)));
        for (let i = 0; i < steps; i++) {
          const dt = i === steps - 1 ? Math.max(0, totalMs - i * (1000 / 120)) : 1000 / 120;
          this.reviewRig.update(dt, pose);
        }
        this.rigReview = {
          classId,
          action,
          t,
          lead: this.reviewRig.getHandWorld(0) ?? { x: 360, y: 300 },
          back: this.reviewRig.getHandWorld(1) ?? { x: 340, y: 310 },
          tipHistory: [],
        };
        for (const obj of [this.priest, this.priestHalo, this.victim, this.victimHalo, this.kindled, this.kindledHalo]) {
          obj.setVisible(false);
        }
        return;
      }
      const style = classId === "paladin" ? "kindled" : "interstice";
      const duration = action === "melee" || action === "bash"
        ? style === "kindled" ? 560 : 360
        : ABILITY_ANIMATIONS[action].durationMs;
      if (action === "melee") this.reviewRig.triggerMeleeSwing(style, 1);
      else if (action === "bash") this.reviewRig.triggerMeleeSwing("kindled", 1, "bash");
      else this.reviewRig.triggerAbility(action);
      const tipHistory: Vec2[] = [];
      const totalMs = duration * t;
      const steps = Math.max(1, Math.ceil(totalMs / (1000 / 120)));
      for (let i = 0; i < steps; i++) {
        const elapsed = Math.min(totalMs, (i + 1) * (1000 / 120));
        const dt = i === steps - 1 ? Math.max(0, totalMs - i * (1000 / 120)) : 1000 / 120;
        this.reviewRig.update(dt, pose);
        if (action === "melee") {
          const q = elapsed / duration;
          const trailStart = style === "kindled" ? 0.38 : 0.32;
          const trailEnd = style === "kindled" ? 0.88 : 0.84;
          if (q >= trailStart && q <= trailEnd) {
            const hand = this.reviewRig.getHandWorld(0);
            if (hand) {
              const reach = style === "kindled" ? 88 : 82;
              const sweep = style === "kindled" ? 2.5 : 2.25;
              const a = meleeBladeAngle(-0.276, sweep, 1, q, style);
              tipHistory.push({ x: hand.x + Math.cos(a) * reach, y: hand.y + Math.sin(a) * reach });
            }
          }
        }
      }
      this.rigReview = {
        classId,
        action,
        t,
        lead: this.reviewRig.getHandWorld(0) ?? { x: 360, y: 300 },
        back: this.reviewRig.getHandWorld(1) ?? { x: 340, y: 310 },
        tipHistory: tipHistory.slice(-18),
      };
      for (const obj of [this.priest, this.priestHalo, this.victim, this.victimHalo, this.kindled, this.kindledHalo]) {
        obj.setVisible(false);
      }
    };
    w.__harnessReady = true;
  }

  private hitOnSlab(): Vec2 {
    // A hit landing on the shield's outward (left) face.
    return { x: KINDLED_SLAB.x - 30, y: KINDLED_SLAB.y - 8 };
  }

  update(_time: number, delta: number): void {
    this.t += delta;
    this.wardPhase += delta / 1000;

    // Victim orbits (the tether must track it).
    this.victimPos = { x: 500 + Math.cos(this.t * 0.0016) * 70, y: 180 + Math.sin(this.t * 0.0016) * 45 };
    this.victim.setPosition(this.victimPos.x, this.victimPos.y);
    this.victimHalo.setPosition(this.victimPos.x, this.victimPos.y);

    const w = window as HarnessWindow;
    const cmd = w.__cmd;
    if (cmd) {
      w.__cmd = null;
      switch (cmd) {
        case "kindled":
          this.mode = "kindled";
          this.markActive = false;
          this.wardActive = false;
          this.priest.setVisible(false);
          this.priestHalo.setVisible(false);
          this.victim.setVisible(false);
          this.victimHalo.setVisible(false);
          this.kindled.setVisible(true);
          this.kindledHalo.setVisible(true);
          break;
        case "mark":
          this.markActive = true;
          break;
        case "unmark":
          this.markActive = false;
          break;
        case "blade":
          // Interstice twin-dagger slash — driven through the controller's
          // persistent swing layer (advanced each frame in controller.update).
          this.controller.triggerSwing(
            "ninja",
            { x: 360, y: 330 },
            { x: 344, y: 338 },
            -0.35,
          );
          break;
        case "shards":
          // Geometrician conjures a volley of cyan crystal shards from the palm.
          spawnCrystalShards(this.pool, { x: 250, y: 320 }, -0.15, GEOMETRICIAN_TINT);
          break;
        case "raise":
          this.wardActive = true;
          spawnWardRaise(this.pool, KINDLED_SLAB, KINDLED_TINT);
          break;
        case "absorb":
          spawnWardAbsorb(this.pool, KINDLED_POS, this.hitOnSlab(), KINDLED_TINT);
          break;
        case "drop":
          this.wardActive = false;
          spawnWardDrop(this.pool, KINDLED_SLAB, KINDLED_TINT);
          break;
        case "edge":
          // Kindled crystal-edge swing to the LEFT, clear of the shield held on
          // the right — driven through the controller's persistent swing layer.
          this.controller.triggerSwing(
            "paladin",
            KINDLED_POS,
            { x: KINDLED_POS.x - 16, y: KINDLED_POS.y + 4 },
            2.3,
          );
          break;
        case "edge-low":
          // Same controller-path swing but aimed so the arc EXITS low —
          // exercises the ground-dust gate (R1 row 10) the fixed 2.3-rad
          // aim never satisfies.
          this.controller.triggerSwing(
            "paladin",
            KINDLED_POS,
            { x: KINDLED_POS.x - 16, y: KINDLED_POS.y + 4 },
            0.5,
          );
          break;
        case "bash-swing":
          // SHIELD BASH through the controller path (slab plate + drag
          // smear + front-foot dust) — the render half a live bash chain's
          // third slash-started drives.
          this.controller.triggerSwing(
            "paladin",
            KINDLED_POS,
            { x: KINDLED_POS.x + 10, y: KINDLED_POS.y + 6 },
            0,
            1,
            undefined,
            1,
            true,
          );
          break;
        // ── R1 rows 17/18 (K9, 2026-07-24) — melee contact debris + the
        //    Kindled melee-kill ground shock ring ──────────────────────────
        case "debris-edge":
          // Edge contact: tight spray CONTINUING the cut line (left-to-right
          // hit, slight downward bite — matches the hurt review's vector).
          spawnMeleeDebris(this.pool, { x: 430, y: 300 }, 0.15, KINDLED_TINT, "edge");
          break;
        case "debris-bash":
          spawnMeleeDebris(this.pool, { x: 430, y: 300 }, 0.15, KINDLED_TINT, "bash");
          break;
        case "kill-ring":
          spawnKillShockRing(this.pool, { x: 430, y: 356 }, KINDLED_TINT);
          break;
        // ── Phase 3 primitive demos (2026-07-20) ──────────────────────────
        case "nova-slash":
          spawnNovaBurst(this.pool, { x: 300, y: 250 }, 90, INTERSTICE_TINT, "slash");
          break;
        case "nova-ooze":
          spawnNovaBurst(this.pool, { x: 300, y: 250 }, 90, SYZYGIST_TINT, "ooze");
          break;
        case "nova-shatter":
          spawnNovaBurst(this.pool, { x: 300, y: 250 }, 90, GEOMETRICIAN_TINT, "shatter");
          break;
        case "nova-seal":
          spawnNovaBurst(this.pool, { x: 300, y: 250 }, 90, KINDLED_TINT, "seal");
          break;
        case "aura-slash":
          this.auraDemoStyle = this.auraDemoStyle === "slash" ? null : "slash";
          break;
        case "aura-ooze":
          this.auraDemoStyle = this.auraDemoStyle === "ooze" ? null : "ooze";
          break;
        case "aura-shatter":
          this.auraDemoStyle = this.auraDemoStyle === "shatter" ? null : "shatter";
          break;
        case "aura-seal":
          this.auraDemoStyle = this.auraDemoStyle === "seal" ? null : "seal";
          break;
        case "field":
          this.fieldDemoActive = !this.fieldDemoActive;
          break;
        case "blink-trail":
          // Drift Step (priest) — the one blink ability in scope that gets
          // the connecting afterimage trail (CA5's tether-rights gating).
          spawnBlinkStreak(this.pool, { x: 200, y: 300 }, { x: 460, y: 220 }, SYZYGIST_TINT, "ooze");
          break;
        case "blink-commit":
          // Slip Node/Plant Charge/Bulwark Step — no trail, departure +
          // arrival burst only (CA5 bans the echo register for these classes).
          spawnBlinkStreak(this.pool, { x: 200, y: 300 }, { x: 460, y: 220 }, KINDLED_TINT, "seal");
          break;
        case "dodge":
          spawnGhostGuardDodge(this.pool, { x: 380, y: 260 }, INTERSTICE_TINT);
          break;
        // ── Track L status reads (StatusVfxController) ──────────────────
        // Marks live on the HUNTER (the priest dummy), windows on the BODY
        // (the orbiting victim dummy). "st-clear" wipes everything.
        default: {
          if (!cmd.startsWith("st-")) break;
          const tickNow = Math.floor(this.t / 16);
          const until = tickNow + 150; // ~2.5s window
          const short = tickNow + 40; // counter-length window
          switch (cmd) {
            case "st-clear":
              this.bodyFields = {};
              this.hunterFields = {};
              break;
            case "st-facet":
              this.hunterFields = { facetTargetId: "victim", facetMarkUntilTick: until };
              break;
            case "st-judgment":
              this.hunterFields = { judgmentTargetId: "victim", judgmentMarkUntilTick: until };
              break;
            case "st-read":
              this.hunterFields = { readTargetId: "victim", readMarkUntilTick: until };
              break;
            case "st-counter":
              this.bodyFields = { counterUntilTick: short };
              break;
            case "st-seal":
              this.bodyFields = { sealUntilTick: until };
              break;
            case "st-tithe":
              this.bodyFields = { titheUntilTick: until };
              break;
            case "st-measure":
              this.bodyFields = { measureUntilTick: until };
              break;
            case "st-surge":
              this.bodyFields = { speedBoostUntilTick: until };
              break;
            case "st-vuln":
              this.bodyFields = { vulnerabilityUntilTick: until };
              break;
            case "st-jam":
              this.bodyFields = { blockJammerUntilTick: until };
              break;
            case "st-fooled":
              this.bodyFields = { fooledUntilTick: until };
              break;
            case "st-aegis":
              this.bodyFields = { aegisShareUntilTick: until };
              break;
            case "st-fangs":
              this.bodyFields = { pendingLockCharges: 2, pendingLockExpiresAtTick: until };
              break;
            case "st-resonance":
              this.bodyFields = { resonanceUntilTick: until };
              break;
            case "st-refund":
              this.statusEvents.push({
                t: "shield-refunded",
                playerId: "victim" as PlayerId,
                amount: 20,
                x: this.victimPos.x,
                y: this.victimPos.y,
              });
              break;
            case "st-amped":
              this.statusEvents.push({
                t: "hit-confirmed",
                victimId: "victim" as PlayerId,
                damage: 28,
                sourceProjectileId: null,
                amped: true,
              });
              break;
            case "st-pierced":
              this.statusEvents.push({
                t: "hit-confirmed",
                victimId: "victim" as PlayerId,
                damage: 20,
                sourceProjectileId: null,
                pierced: true,
              });
              break;
            case "st-contagion":
              this.statusEvents.push({
                t: "contagion-jump",
                sourceId: "priest" as PlayerId,
                targetId: "victim" as PlayerId,
                fromX: this.priest.x,
                fromY: this.priest.y,
                toX: this.victimPos.x,
                toY: this.victimPos.y,
              });
              break;
            case "st-resglyph":
              this.statusEvents.push({
                t: "resonance-triggered",
                playerId: "victim" as PlayerId,
                sourceKind: "shelter-seal",
                kind: "crimson-tithe",
                x: this.victimPos.x,
                y: this.victimPos.y,
              });
              break;
          }
          break;
        }
      }
    }

    // hold — the paladin's held slab shield, drawn every frame into the off-pool
    // layer (rune-screen alive via wardPhase). Its intensity eases toward the
    // ward state, so raise fades it IN and drop fades it OUT (no instant pop).
    const wardTarget = this.mode === "kindled" && this.wardActive ? 1 : 0;
    this.wardIntensity += (wardTarget - this.wardIntensity) * Math.min(1, delta / 160);
    this.wardLayer.clear();
    if (this.wardIntensity > 0.02) {
      drawWardSlab(this.wardLayer, KINDLED_SLAB, KINDLED_TINT, this.wardPhase, this.wardIntensity);
    }

    // Phase 3 continuous-redraw demos — aura pulse + ground field, driven by
    // the SAME wardPhase clock (reuse, not a new counter).
    this.auraDemoLayer.clear();
    if (this.auraDemoStyle) {
      const tint =
        this.auraDemoStyle === "slash" ? INTERSTICE_TINT
        : this.auraDemoStyle === "ooze" ? SYZYGIST_TINT
        : this.auraDemoStyle === "shatter" ? GEOMETRICIAN_TINT
        : KINDLED_TINT;
      drawBuffAura(this.auraDemoLayer, { x: 550, y: 320 }, tint, this.auraDemoStyle, this.wardPhase, 24, 1);
    }
    this.fieldDemoLayer.clear();
    if (this.fieldDemoActive) {
      drawGroundField(this.fieldDemoLayer, { x: 420, y: 340 }, 90, GEOMETRICIAN_TINT, "shatter", 1, this.wardPhase);
    }

    this.meleeReviewLayer.clear();
    if (this.rigReview?.action === "melee") {
      const r = this.rigReview;
      if (r.classId === "paladin") {
        drawKindledSwing(this.meleeReviewLayer, r.lead, r.back, -0.276, 88, KINDLED_TINT, 2.5, 1, r.t, r.tipHistory);
      } else {
        drawBladeSwing(this.meleeReviewLayer, r.lead, r.back, -0.276, 82, INTERSTICE_TINT, 2.25, 1, r.t);
      }
    } else if (this.rigReview?.action === "bash") {
      // SHIELD BASH review — slab leads at the shield hand, sword chambers.
      const r = this.rigReview;
      drawKindledBash(this.meleeReviewLayer, r.back, r.lead, -0.276, KINDLED_TINT, r.t);
    } else if (this.rigReview && (this.rigReview.action === "idle" || this.rigReview.action === "run")) {
      // Stance review — the held/resting weapons at the settled hands (the
      // live game's ConstructVfxController held layer, reproduced here so
      // the braced idle tapes WITH its loadout).
      const r = this.rigReview;
      if (r.classId === "paladin") {
        drawHeldEdges(this.meleeReviewLayer, r.lead, r.back, -0.276, KINDLED_TINT, 1);
      } else if (r.classId === "ninja") {
        drawHeldDaggers(this.meleeReviewLayer, r.lead, r.back, -0.276, INTERSTICE_TINT, 1);
      }
    } else if (this.meleeReview?.kind === "ninja") {
      const t = this.meleeReview.t;
      const pivotAt = (q: number): Vec2 => {
        const x = q < 0.32 ? -5 * (q / 0.32) : q < 0.84 ? -5 + 17 * ((q - 0.32) / 0.52) : 12 * (1 - (q - 0.84) / 0.16);
        const y = q < 0.32 ? 10 * Math.sin((q / 0.32) * Math.PI * 0.5) : q < 0.52 ? 10 * (1 - (q - 0.32) / 0.2) : 0;
        return { x: 360 + x, y: 230 + y };
      };
      const trailStart = 0.32;
      const trailEnd = Math.min(t, 0.84);
      const tipHistory = t < trailStart ? [] : Array.from({ length: 18 }, (_, i) => trailStart + (trailEnd - trailStart) * (i / 17))
        .map((q) => {
          const p = pivotAt(q);
          const a = meleeBladeAngle(-0.2, 2.25, 1, q, "interstice");
          return { x: p.x + Math.cos(a) * 82, y: p.y + Math.sin(a) * 82 };
        });
      drawBladeSwing(
        this.meleeReviewLayer,
        pivotAt(t),
        { x: 340, y: 244 },
        -0.2,
        82,
        INTERSTICE_TINT,
        2.25,
        1,
        t,
      );
      void tipHistory;
    } else if (this.meleeReview?.kind === "paladin") {
      const t = this.meleeReview.t;
      const pivotAt = (q: number): Vec2 => {
        const x = q < 0.38 ? -6 * (q / 0.38) : q < 0.88 ? -6 + 20 * ((q - 0.38) / 0.5) : 14 * (1 - (q - 0.88) / 0.12);
        const y = q < 0.38 ? 14 * Math.sin((q / 0.38) * Math.PI * 0.5) : q < 0.61 ? 14 * (1 - (q - 0.38) / 0.23) : 0;
        return { x: 360 + x, y: 230 + y };
      };
      const trailStart = 0.38;
      const trailEnd = Math.min(t, 0.88);
      const tipHistory = t < trailStart ? [] : Array.from({ length: 22 }, (_, i) => trailStart + (trailEnd - trailStart) * (i / 21))
        .map((q) => {
          const p = pivotAt(q);
          const a = meleeBladeAngle(-0.2, 2.5, 1, q, "kindled");
          return { x: p.x + Math.cos(a) * 88, y: p.y + Math.sin(a) * 88 };
        });
      drawKindledSwing(
        this.meleeReviewLayer,
        pivotAt(t),
        { x: 340, y: 244 },
        -0.2,
        88,
        KINDLED_TINT,
        2.5,
        1,
        t,
        tipHistory,
      );
    }

    // The REAL entanglement pipeline (does nothing in kindled mode: markActive off).
    const tick = Math.floor(this.t / 16);
    const state = {
      tick,
      players: {
        priest: { alive: true, characterId: "shielded" as CharacterArchetype },
        victim: {
          alive: true,
          characterId: "balanced" as CharacterArchetype,
          focusHexMarkUntilTick: this.markActive ? tick + 50 : 0,
        },
      },
    } as unknown as WorldState;
    const getPos = (id: PlayerId): Vec2 | undefined =>
      id === ("priest" as PlayerId)
        ? { x: this.priest.x, y: this.priest.y }
        : id === ("victim" as PlayerId)
          ? this.victimPos
          : undefined;
    this.controller.update(state, [], delta, getPos, resolveClassId);

    // Track L status reads — a second synthetic state carrying the
    // "st-*"-commanded fields (hunter = priest dummy, body = orbiting
    // victim dummy) so StatusVfxController's planners/painters run the
    // REAL pipeline headlessly.
    const statusState = {
      tick,
      players: {
        priest: { alive: true, vx: 0, ...this.hunterFields },
        victim: { alive: true, vx: 160, ...this.bodyFields },
      },
    } as unknown as WorldState;
    this.statusCtl.update(statusState, this.statusEvents, delta, getPos);
    this.statusEvents.length = 0;
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "harness-root",
  width: 720,
  height: 405,
  backgroundColor: "#12151c",
  scene: HarnessScene,
  fps: { target: 60 },
});
