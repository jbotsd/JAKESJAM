// ActionBarSystem — bottom-center Diablo-style hotkey bar.
//
// Jake, 2026-07-14: "design and build a diablo style hotkeys thing" +
// "i think therell be about the diablo amount of abilities" — grounded in
// sourced research across D2/D3/D4 (not recalled-only): dual resource orbs
// flanking a central ability row, consumable input ALWAYS separate from the
// ability slots (D2's belt keys, D3's locked "5", D4's "Q" — no mainline
// entry ever shares that key with an ability), max ~6 active slots as the
// converged build-depth/legibility ceiling (D3 Elective Mode, D4's skill
// bar), radial-wipe cooldowns over numeral overlays, and a buff/debuff icon
// row ABOVE the bar — capped and prioritized from day one, since D4 players
// have filed live complaints about that row hiding stacks when uncapped.
//
// Slot layout: Fire/M1, Dash/M2, then the EMISSION (E — the Emission
// Engine's composed cast, docs/emission-engine-goal.md; its diamond fills
// with abilityCharge and shows the point-of-light at full), then acquired
// card-granted capabilities claiming the remaining diamonds in hand order
// (acquiredAbilities.ts). Any still-unclaimed slots render RESERVED (dim
// outline) — the bar was pre-sized for the ability count Jake expects the
// card system to grow into, instead of a redesign later.
//
// Visual language matches the rest of the HUD, not a new style: chamfered
// "crystal-cut" diamonds (docs/asset-prompts/02-hud-chrome.md, "Ability
// Cooldown Diamond") and the same faceted-ring resource language as the
// nameplate column (facetedRing.ts) — one manufactured system, not a
// bolted-on ARPG skin.

import Phaser from "phaser";
import { uiWidth, uiHeight } from "../render/renderResolution.js";
import { PALETTE } from "./palette.js";
import { drawFacetedRing, healthRingColor } from "../render/facetedRing.js";
import type { HudChip } from "./HudSystem.js";
import type { AcquiredAbility, AcquiredAbilityKind } from "./acquiredAbilities.js";
import { drawActiveGlyph } from "./actionBarGlyphs.js";
import type { ClassId } from "../types/game.js";
import { isPortraitMobile, safeAreaInsetBottomPx } from "../input/mobile.js";

// ── Chassis-verb naming (2026-07-18 legibility pass, Jake: "we still have
// shift shield and mouse right click in the game what do we do about those
// those should be abilities") — Shield (held Shift) and Dash (right-click/C,
// the "dash-bash shield power-slide") are ALREADY class-specific mechanics
// under the hood (combat.ts's Kindled Ward branch, World.ts's ninja dash-
// through/evasion, weapon.ts's Priest innate directionalShield) but were
// rendering as an unlabeled resource orb and a bare "M2" slot with no name
// anywhere in the UI. This is a NAMING/LABELING pass only — no mechanic,
// number, or gating changes.
//
// "Kindled Ward" (paladin) is the session's own established name
// (combat.ts's WARD_* doc comments, class-overhaul-workboard.md chunks
// 2.2/2.3). "Slipstream" (ninja Dash) is pulled verbatim from
// docs/character-sheets-v1.md ("Slipstream / Read: Dash through them...")
// and is ALSO a currently-dead-code draft card of the same name
// (docs/card-pool-v2.md — CardSystem.ts/DraftScene.ts are dead per the
// class-overhaul session) with an IDENTICAL effect (dash-through grants
// energy + tags Read) — flagged as a future collision risk if the draft-
// card layer is ever revived. The remaining six (wizard's two, ninja's
// Shield, priest's two, paladin's Dash) have no established name in
// classes-goal.md / character-sheets-v1.md / class-ability-catalogs-v1.md,
// so these are freshly authored to each class's C4 tone register
// (classes-goal.md: wizard technical-awesome, ninja insidious-precise,
// paladin epic-settled/self-lit-not-liturgical, priest unsettling-
// benevolent) and checked against that class's own catalog vocabulary for
// collisions (Geometrician/Interstice/Kindled/Syzygist catalogs,
// docs/class-ability-catalogs-v1.md).
//
// Known gap this naming surfaces rather than hides: wizard's held-Shield is
// still the plain pre-class-split omnidirectional block today (see
// combat.ts's tryDeflectDamage step 2) — classes-goal.md's "DEFENSE IS A
// CLASS PROPERTY" section says wizard's true defense is parry, but it
// hasn't actually been retired from the universal Shield input yet. Only
// Paladin (Kindled Ward) and Priest (innate directional aim-shield) have a
// real classId-gated override for Shield's damage math.
//
// Ninja/Interstice is DIFFERENT from wizard's gap, not the same one: its
// Shield now HAS a real classId-gated override (combat.ts's
// tryDeflectDamage, "ninja" branch, 2026-07-18) — but the override is "deal
// zero mitigation, always", per the LOCKED doctrine that this class's whole
// defense IS the dash i-frame ("Dash i-frames only — never block",
// docs/character-sheets-v1.md's DI-Tempest/WoW-Rogue table; "dash
// i-frames — never blocks, only isn't there", docs/classes-goal.md). A
// previous pass here gave ninja's Shield-key the display name "Raised
// Guard" as a cosmetic kindness matching every other class — that actively
// misled players into believing Interstice has a real guard/block
// mechanic. Per docs/design-axioms.md A2 ("ship the missing feature, never
// the broken one"): rather than name a fake ability, the shield orb AND
// its name label are hidden entirely for ninja (see `shieldDisplayMax`
// below) — reusing the existing "no shield resource on this character"
// dim-empty-frame treatment this bar already has for that exact situation.
// SHIELD_NAME_BY_CLASS keeps a ninja entry anyway as a defense-in-depth
// fallback string (in case some future caller ever renders the name
// without going through `shieldDisplayMax`'s gate) — it must read as an
// honest absence, not an ability, in Interstice's insidious-precise voice.
const DASH_NAME_BY_CLASS: Record<ClassId, string> = {
  paladin: "Kindled Charge",
  wizard: "Vector Charge",
  ninja: "Slipstream",
  priest: "Tethered Charge",
};
const SHIELD_NAME_BY_CLASS: Record<ClassId, string> = {
  paladin: "Kindled Ward",
  wizard: "Prism Wall",
  ninja: "Nothing to Guard",
  priest: "Open Hand",
};

/** One drafted-active slot (six-axes-goal.md Layer 2): keys 1..3 in pick
 *  order (rack locked at exactly 3, docs/classes-goal.md "Rotation
 *  system"). readyFrac drives the cooldown sweep (0 = just used → 1 =
 *  ready); windowFrac > 0 means the effect window is live (Tithe's
 *  crimson beat). */
export type ActiveSlotVital = {
  kind: string;
  keyLabel: string;
  readyFrac: number;
  windowFrac: number;
};

export type ActionBarVitals = {
  health: number;
  maxHealth: number;
  shieldCharge: number;
  shieldMaxCharge: number;
  /** 0-1, dash-bash readiness (0 = just used, 1 = ready) — drives the M2 slot's ring. */
  dashReadyFrac: number;
  /** 0-1, Emission charge (abilityCharge / EMISSION_CHARGE_MAX — the
   *  Emission Engine meter, docs/emission-engine-goal.md). P0: the slot
   *  fills and pulses at full; the cast input ships in P1. */
  emissionChargeFrac: number;
  /** Drafted actives in pick order — claim the diamonds right after the
   *  Emission slot, keyed 1..3 (six-axes Layer 2; rack locked at 3). */
  actives: ActiveSlotVital[];
  /** Card-granted capabilities in acquisition order (acquiredAbilities.ts)
   *  — fill the remaining diamonds after the actives. */
  acquired: AcquiredAbility[];
  /** Live banked Stolen Fangs lock charges (player.pendingLockCharges) —
   *  drives that slot's ready ring when the fangs are acquired. */
  stolenFangsCharges: number;
  isDead: boolean;
  /** Local player's classId (classIdForArchetype(characterId)) — drives the
   *  Dash/Shield chassis-verb name labels (DASH_NAME_BY_CLASS /
   *  SHIELD_NAME_BY_CLASS above). Optional/absent-means-hidden so existing
   *  callers that don't resolve a classId (e.g. HangoutScene's lobby HUD)
   *  keep rendering exactly as before — no forced touch on that file. */
  classId?: ClassId;
};

const PAD_BOTTOM = 20;
const PAD_BOTTOM_COMPACT = 14;
// clusterA-01/clusterA-02 mobile-QA fix (2026-07-28): on touch+portrait,
// TouchControls.ts's `.tc-zone` joystick drag surface AND its floating-
// joystick base occupy the bottom `--tc-band` slice of the viewport
// (style.css, `@media (orientation: portrait)`, default 34vh) — a fixed
// bottom-padding constant here had no idea that band existed, so the bar's
// HP/shield orbs and M1/M2/E diamonds rendered INSIDE it: a floating stick
// spawning under the thumb could fully eclipse them (they're read-only HUD,
// not a touch target, so they have no business living in the drag zone at
// all). TOUCH_ZONE_CLEAR_MARGIN is the visual breathing room above the
// zone's top edge; kept independent of style.css's own `--tc-band` var
// (Phaser Graphics can't read a DOM custom property) via the matching
// fraction below — if that default ever changes, update both.
const TOUCH_BAND_VH_FRAC = 0.34;
const TOUCH_ZONE_CLEAR_MARGIN = 12;
// Full-size bar: HP orb + 6 slots + shield orb spans ~460px — overflows a
// 400px phone viewport (orbs clipped off both edges). Compact sizing keeps
// the same layout ratios at a scale that fits with margin either side.
const ORB_R = 38;
const ORB_R_COMPACT = 24;
const ORB_GAP = 26;
const ORB_GAP_COMPACT = 13;
const SLOT_R = 21;
const SLOT_R_COMPACT = 13;
const SLOT_GAP = 9;
const SLOT_GAP_COMPACT = 5;
const SLOT_COUNT = 6;
const BUFF_TICK_R = 9;
const BUFF_TICK_GAP = 6;
const MAX_BUFF_TICKS = 6; // D4's uncapped row is a documented cautionary tale — cap on day one.

const C_SHIELD = 0x93c5fd;
const C_FRAME = 0x2a3550;
const C_FRAME_DIM = 0x1c2438;

/** Linear RGB lerp between two 0xRRGGBB ints — used to make the ability
 *  slot's color/alpha genuinely track `ready` across the whole cooldown
 *  instead of snapping at the very last instant (see drawLiveSlot). */
function lerpHexColor(from: number, to: number, t: number): number {
  const k = Phaser.Math.Clamp(t, 0, 1);
  const fr = (from >> 16) & 0xff, fg = (from >> 8) & 0xff, fb = from & 0xff;
  const tr = (to >> 16) & 0xff, tg = (to >> 8) & 0xff, tb = to & 0xff;
  const r = Math.round(fr + (tr - fr) * k);
  const gr = Math.round(fg + (tg - fg) * k);
  const b = Math.round(fb + (tb - fb) * k);
  return (r << 16) | (gr << 8) | b;
}

type LiveSlot = { keyLabel: string; glyph: "shuriken" | "dash" };
const LIVE_SLOTS: LiveSlot[] = [
  { keyLabel: "M1", glyph: "shuriken" }, // Fire — no cooldown today, reads always-ready.
  { keyLabel: "M2", glyph: "dash" }, // Dash — ring driven by dashReadyFrac.
];

export class ActionBarSystem {
  private readonly scene: Phaser.Scene;
  private g!: Phaser.GameObjects.Graphics;
  private hpText!: Phaser.GameObjects.Text;
  private shText!: Phaser.GameObjects.Text;
  private slotKeyLabels: Phaser.GameObjects.Text[] = [];
  /** Chassis-verb name labels (2026-07-18 legibility pass) — dashNameText
   *  sits just above the M2 diamond, shieldNameText just above the shield
   *  orb. Both hidden when vitals.classId is absent (see that field's doc
   *  comment). wordWrap lets a two-word name (e.g. "Kindled Charge") break
   *  onto a second line instead of overflowing into the neighboring M1/E
   *  diamonds — this HUD row is tight, and pixel-perfect single-line fit
   *  isn't verifiable without a live screenshot (see task report). */
  private dashNameText!: Phaser.GameObjects.Text;
  private shieldNameText!: Phaser.GameObjects.Text;

  private compact = false;
  /** First-seen wall-clock per acquired kind — drives the acquisition
   *  pop-in (render-only; cleared when a kind leaves the build). */
  private readonly acquiredFirstSeenMs = new Map<AcquiredAbilityKind, number>();
  /** Presentation-side cooldown animator state, keyed per slot (see
   *  animateFrac) — display value + event timestamps, render-only. */
  private readonly slotAnim = new Map<string, { display: number; usedAtMs: number; readyAtMs: number }>();
  private lastAnimMs = 0;
  // Resolved sizes (compact vs full) — set once in build() from viewport
  // width, same convention as HudSystem's nameplateR.
  /** Slots visible this frame: live pair + Emission + actives + acquired
   *  (A4 — capped at SLOT_COUNT; reserved placeholders no longer render). */
  private visibleSlotCount = LIVE_SLOTS.length + 1;
  private orbR = ORB_R;
  private orbGap = ORB_GAP;
  private slotR = SLOT_R;
  private slotGap = SLOT_GAP;
  private padBottom = PAD_BOTTOM;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.build();
  }

  destroy(): void {
    this.scene.scale.off("resize", this.onResize, this);
    this.g.destroy();
    this.hpText.destroy();
    this.shText.destroy();
    this.dashNameText.destroy();
    this.shieldNameText.destroy();
    for (const t of this.slotKeyLabels) t.destroy();
    this.slotKeyLabels = [];
  }

  private build(): void {
    const s = this.scene;
    const depth = 900;
    this.compact = uiWidth(s) < 520;
    this.orbR = this.compact ? ORB_R_COMPACT : ORB_R;
    this.orbGap = this.compact ? ORB_GAP_COMPACT : ORB_GAP;
    this.slotR = this.compact ? SLOT_R_COMPACT : SLOT_R;
    this.slotGap = this.compact ? SLOT_GAP_COMPACT : SLOT_GAP;
    this.padBottom = this.resolvePadBottom();

    this.g = s.add.graphics().setScrollFactor(0).setDepth(depth + 1);

    const fontBase = {
      fontFamily: "'Space Mono', Consolas, 'Courier New', monospace",
      fontStyle: "bold",
      stroke: "#05080f",
      strokeThickness: 3,
    } as const;

    this.hpText = s.add
      .text(0, 0, "", { ...fontBase, fontSize: this.compact ? "11px" : "13px", color: "#b8f05a" })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(depth + 2);
    this.shText = s.add
      .text(0, 0, "", { ...fontBase, fontSize: this.compact ? "9px" : "10px", color: "#93c5fd" })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(depth + 2);

    // Chassis-verb name labels — same fontBase convention as every other
    // small HUD text here, just smaller/dimmer than the resource numbers
    // (this is flavor identification, not a stat the player reads mid-fight).
    const nameFontSize = this.compact ? "7px" : "8px";
    this.dashNameText = s.add
      .text(0, 0, "", {
        ...fontBase,
        fontSize: nameFontSize,
        color: "#8ff8ff",
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(depth + 2)
      .setVisible(false);
    this.shieldNameText = s.add
      .text(0, 0, "", {
        ...fontBase,
        fontSize: nameFontSize,
        color: "#93c5fd",
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(depth + 2)
      .setVisible(false);

    for (let i = 0; i < SLOT_COUNT; i++) {
      // Slot order: live slots, then the Emission (E — cast ships P1,
      // docs/emission-engine-goal.md), then reserved dashes.
      const labelText =
        i < LIVE_SLOTS.length ? LIVE_SLOTS[i]!.keyLabel : i === LIVE_SLOTS.length ? "E" : "—";
      const label = s.add
        .text(0, 0, labelText, {
          ...fontBase,
          fontSize: this.compact ? "7px" : "8px",
          color: i <= LIVE_SLOTS.length ? "#8ff8ff" : "#4b5568",
        })
        .setOrigin(0.5, 0)
        .setScrollFactor(0)
        .setDepth(depth + 2);
      this.slotKeyLabels.push(label);
    }

    s.scale.on("resize", this.onResize, this);
    this.layout();
  }

  private onResize(): void {
    this.layout();
  }

  /** Bottom clearance for the bar: the OS safe-area inset (home indicator /
   *  gesture-nav bar, `env(safe-area-inset-bottom)` — desktop's is 0) plus,
   *  on touch+portrait only, enough extra to clear TouchControls' bottom
   *  `.tc-zone` joystick band entirely (clusterA-01/clusterA-02 — see the
   *  constants' doc comment above). Read live (not just at build()) so a
   *  device rotation between landscape and portrait re-derives this without
   *  needing a width-threshold crossing to trigger a rebuild. */
  private resolvePadBottom(): number {
    const base = this.compact ? PAD_BOTTOM_COMPACT : PAD_BOTTOM;
    const safeBottom = safeAreaInsetBottomPx();
    if (!isPortraitMobile()) return base + safeBottom;
    const bandPx = uiHeight(this.scene) * TOUCH_BAND_VH_FRAC;
    return Math.max(base, bandPx + TOUCH_ZONE_CLEAR_MARGIN) + safeBottom;
  }

  /** Positions everything that doesn't move frame-to-frame (labels) — the
   *  Graphics itself is fully redrawn each update() call regardless. */
  private layout(): void {
    const s = this.scene;
    this.padBottom = this.resolvePadBottom();
    const w = uiWidth(s);
    const h = uiHeight(s);
    const centerX = w / 2;
    const barY = h - this.padBottom - Math.max(this.orbR, this.slotR);
    // A4 (docs/footage-removal-list.md): the bar GROWS as the hand earns
    // keys — no reserved placeholder diamonds. Row width derives from the
    // slots actually visible this frame (min: M1/M2/E).
    const count = this.visibleSlotCount;
    const rowW = count * this.slotR * 2 + (count - 1) * this.slotGap;
    const rowLeft = centerX - rowW / 2;

    this.hpText.setPosition(centerX - rowW / 2 - this.orbGap - this.orbR, barY);
    const shOrbX = centerX + rowW / 2 + this.orbGap + this.orbR;
    this.shText.setPosition(shOrbX, barY);
    // Shield name sits above its orb — plenty of clearance out there (it's
    // the outermost element, nothing else shares that space).
    this.shieldNameText.setPosition(shOrbX, barY - this.orbR - 6);
    this.shieldNameText.setWordWrapWidth(this.orbR * 2.6, true);

    for (let i = 0; i < SLOT_COUNT; i++) {
      const sx = rowLeft + this.slotR + i * (this.slotR * 2 + this.slotGap);
      this.slotKeyLabels[i]!.setVisible(i < count);
      this.slotKeyLabels[i]!.setPosition(sx, barY + this.slotR + 4);
      if (i === 1) {
        // M2/Dash slot — name label tucked just above the diamond, wrapped
        // to roughly one slot-cell width so a two-word name breaks onto a
        // second line instead of bleeding into the M1/E diamonds either
        // side of it.
        this.dashNameText.setPosition(sx, barY - this.slotR - 4);
        this.dashNameText.setWordWrapWidth(this.slotR * 2.4, true);
      }
    }
  }

  // Perf audit R5 (2026-07-18): flagged this full-clear-every-frame redraw
  // as a flat per-frame tax (~150-200 Graphics ops) independent of player
  // count. Deliberately left un-throttled: every slot's fill is driven by
  // `animateFrac`'s continuous lerp + usePop/readyPing pulses — the exact
  // mechanism this session's earlier fix ("cooldown animations don't
  // smoothly count down / don't pop off when hit") made correct. Gating this
  // redraw on a timer or a dirty-check would reintroduce that stutter for a
  // flat cost far smaller than the R1-R3 rig-cost cluster this audit
  // prioritizes above it. Revisit only alongside a real animation-state
  // "settled" signal, not a blind throttle.
  update(vitals: ActionBarVitals, chips: HudChip[]): void {
    this.visibleSlotCount = Math.min(
      SLOT_COUNT,
      LIVE_SLOTS.length + 1 + vitals.actives.length + vitals.acquired.length,
    );
    this.layout(); // cheap; keeps labels correct if uiWidth changed without a resize event
    const g = this.g;
    g.clear();

    const s = this.scene;
    const w = uiWidth(s);
    const h = uiHeight(s);
    const centerX = w / 2;
    const barY = h - this.padBottom - Math.max(this.orbR, this.slotR);
    const slotCount = this.visibleSlotCount;
    const rowW = slotCount * this.slotR * 2 + (slotCount - 1) * this.slotGap;
    const rowLeft = centerX - rowW / 2;
    const hpOrbX = centerX - rowW / 2 - this.orbGap - this.orbR;
    const shOrbX = centerX + rowW / 2 + this.orbGap + this.orbR;

    // ── Resource orbs (health left, shield right — dual-orb convention
    // held across D2/D3/D4; ratio-only fill, no liquid-sim, matching the
    // rest of the HUD's faceted-ring language rather than a new widget) ──
    const hpRatio = vitals.maxHealth > 0 ? Phaser.Math.Clamp(vitals.health / vitals.maxHealth, 0, 1) : 0;
    // Ninja/Interstice (2026-07-18, "no block" fix): the shield charge
    // resource still exists underneath (tickShield keeps draining/
    // recharging it class-agnostically — combat.ts is untouched there) but
    // it never mitigates a single point of damage for this class
    // (combat.ts's tryDeflectDamage "ninja" branch). Displaying a live orb
    // for a resource that does nothing defensively would be exactly the
    // "broken feature" docs/design-axioms.md A2 says to never ship — so the
    // bar treats ninja as if it had no shield resource at all, reusing the
    // existing "no shield resource on this character" dim-empty-frame path
    // below rather than inventing a new visual state.
    const shieldDisplayMax = vitals.classId === "ninja" ? 0 : vitals.shieldMaxCharge;
    const shRatio = shieldDisplayMax > 0 ? Phaser.Math.Clamp(vitals.shieldCharge / shieldDisplayMax, 0, 1) : 0;

    this.drawOrb(g, hpOrbX, barY, this.orbR, hpRatio, healthRingColor(hpRatio), vitals.isDead);
    this.hpText.setText(vitals.isDead ? "—" : `${Math.ceil(vitals.health)}`);
    this.hpText.setVisible(true);

    if (shieldDisplayMax > 0 && !vitals.isDead) {
      this.drawOrb(g, shOrbX, barY, this.orbR, shRatio, C_SHIELD, false);
      this.shText.setText(`${Math.ceil(vitals.shieldCharge)}`);
      this.shText.setVisible(true);
    } else if (shieldDisplayMax > 0) {
      // Dead — shield exists but isn't usable right now; show it extinguished
      // rather than a normal charged orb (the bar shouldn't claim you can
      // still block while eliminated).
      this.drawOrb(g, shOrbX, barY, this.orbR, shRatio, C_SHIELD, true);
      this.shText.setVisible(false);
    } else {
      // No shield resource on this character — dim empty frame, not a lit
      // "0" orb (a real absence reads differently from a drained resource).
      // Also the ninja path (shieldDisplayMax forced to 0 above): a real
      // charge resource exists underneath, but it does nothing, so it reads
      // as absent here rather than as a live-but-pointless orb.
      this.drawEmptyOrbFrame(g, shOrbX, barY, this.orbR);
      this.shText.setVisible(false);
    }

    // ── Chassis-verb name labels (2026-07-18 legibility pass) — only shown
    // once a classId is known; every existing caller that doesn't resolve
    // one (e.g. HangoutScene) just keeps the old unlabeled look. ──
    const dashName = vitals.classId ? DASH_NAME_BY_CLASS[vitals.classId] : undefined;
    this.dashNameText.setText(dashName ?? "");
    this.dashNameText.setVisible(dashName !== undefined && !vitals.isDead);
    const shieldName =
      vitals.classId && shieldDisplayMax > 0 ? SHIELD_NAME_BY_CLASS[vitals.classId] : undefined;
    this.shieldNameText.setText(shieldName ?? "");
    this.shieldNameText.setVisible(shieldName !== undefined && !vitals.isDead);

    // ── Ability slots — chamfered "crystal-cut" diamonds. Slot 0 = Fire
    // (M1, no cooldown today → always reads ready). Slot 1 = Dash (M2,
    // ring driven by dashReadyFrac). Slots 2-5 = reserved for future
    // abilities (Jake: "diablo amount of abilities") — dim outline only,
    // no glyph, so the bar doesn't need a redesign when they go live. While
    // dead, ALL live slots render disabled — the bar shouldn't keep reading
    // "ready to fire" when the input is actually inert (caught in a UI pass,
    // 2026-07-14: the bar only dimmed the HP orb, never the abilities). ──
    // Track acquisition pop-ins (render-only wall clock): a kind seen for
    // the first time this match gets a ~260ms scale-in + flash ring; kinds
    // that left the set (match reset / new hand) drop their timestamps so
    // a re-acquisition pops again.
    const nowMs = this.scene.time.now;
    const animDtMs = this.lastAnimMs === 0 ? 16.7 : Math.min(100, nowMs - this.lastAnimMs);
    this.lastAnimMs = nowMs;
    const liveKinds = new Set(vitals.acquired.map((a) => a.kind));
    for (const kind of [...this.acquiredFirstSeenMs.keys()]) {
      if (!liveKinds.has(kind)) this.acquiredFirstSeenMs.delete(kind);
    }
    for (const a of vitals.acquired) {
      if (!this.acquiredFirstSeenMs.has(a.kind)) {
        this.acquiredFirstSeenMs.set(a.kind, nowMs);
      }
    }

    for (let i = 0; i < slotCount; i++) {
      const sx = rowLeft + this.slotR + i * (this.slotR * 2 + this.slotGap);
      const live = LIVE_SLOTS[i];
      if (!live) {
        // Slot layout after the live pair (six-axes Layer 2):
        // [Emission][actives 1..3…][acquired passives…][reserved…].
        // The Emission meter fills with charge (Emission Engine P0/P1);
        // drafted ACTIVES claim the next diamonds in pick order (keys 1-3,
        // rack locked at 3, cooldown sweep); acquired passive capabilities
        // take what's left.
        if (i === LIVE_SLOTS.length) {
          // Emission is a charge meter, but the same animator applies: the
          // cast slams it to empty (use-pop), hits stair-step it up
          // (smoothed), full stamps the ready-ping.
          const em = this.animateFrac("emission", vitals.emissionChargeFrac, nowMs, animDtMs);
          this.drawEmissionSlot(g, sx, barY, this.slotR, em.frac, vitals.isDead);
          if (!vitals.isDead) this.drawSlotBeats(g, sx, barY, this.slotR, em.usePop, em.readyPing);
          continue;
        }
        const postEmission = i - LIVE_SLOTS.length - 1;
        const activeSlot = vitals.actives[postEmission];
        if (activeSlot) {
          const anim = this.animateFrac(`active:${activeSlot.keyLabel}`, activeSlot.readyFrac, nowMs, animDtMs);
          this.drawActiveSlot(g, sx, barY, this.slotR, { ...activeSlot, readyFrac: anim.frac }, vitals.isDead);
          if (!vitals.isDead) this.drawSlotBeats(g, sx, barY, this.slotR, anim.usePop, anim.readyPing);
          continue;
        }
        const acquired = vitals.acquired[postEmission - vitals.actives.length];
        if (acquired) {
          const firstSeen = this.acquiredFirstSeenMs.get(acquired.kind) ?? nowMs;
          const popT = Phaser.Math.Clamp((nowMs - firstSeen) / 260, 0, 1);
          this.drawAcquiredSlot(g, sx, barY, this.slotR, acquired, vitals, popT);
          continue;
        }
        this.drawReservedSlot(g, sx, barY, this.slotR);
        continue;
      }
      if (vitals.isDead) {
        this.drawDisabledSlot(g, sx, barY, this.slotR, live.glyph);
        continue;
      }
      if (live.glyph === "dash") {
        const anim = this.animateFrac("dash", vitals.dashReadyFrac, nowMs, animDtMs);
        this.drawLiveSlot(g, sx, barY, this.slotR, anim.frac, live.glyph);
        this.drawSlotBeats(g, sx, barY, this.slotR, anim.usePop, anim.readyPing);
      } else {
        this.drawLiveSlot(g, sx, barY, this.slotR, 1, live.glyph);
      }
    }

    // Key-label row: active slots show their HOTKEY (1-3 — they're
    // pressable); acquired passives show stack count (×N) — a count is
    // the honest label for a capability with no key.
    for (let i = LIVE_SLOTS.length + 1; i < slotCount; i++) {
      const postEmission = i - LIVE_SLOTS.length - 1;
      const label = this.slotKeyLabels[i];
      if (!label) continue;
      const activeSlot = vitals.actives[postEmission];
      if (activeSlot) {
        label.setText(activeSlot.keyLabel);
        label.setColor(activeSlot.readyFrac >= 1 ? "#8ff8ff" : "#4b5568");
        continue;
      }
      const acquired = vitals.acquired[postEmission - vitals.actives.length];
      if (acquired) {
        // Passives are ALWAYS-ON card capabilities, not unbound hotkeys —
        // "•" read as a missing shortcut (Jake, mid-playtest 2026-07-17).
        // "on" is state language; stacks show their count. Dimmer than the
        // hotkey labels so only pressable slots carry key-bright text.
        label.setText(
          acquired.count !== undefined && acquired.count > 1 ? `×${acquired.count}` : "on",
        );
        label.setColor("#5f7ba6");
      } else {
        label.setText("—");
        label.setColor("#4b5568");
      }
    }

    // ── Buff/debuff row above the bar — capped + priority-ordered (D4's
    // own players complain when this row isn't; see file header). ──
    const shown = chips.slice(0, MAX_BUFF_TICKS);
    if (shown.length > 0) {
      const tickR = this.compact ? BUFF_TICK_R * 0.75 : BUFF_TICK_R;
      const tickGap = this.compact ? BUFF_TICK_GAP * 0.75 : BUFF_TICK_GAP;
      const tickRowW = shown.length * tickR * 2 + Math.max(0, shown.length - 1) * tickGap;
      let tx = centerX - tickRowW / 2 + tickR;
      const ty = barY - this.slotR - 22;
      for (const chip of shown) {
        this.drawBuffTick(g, tx, ty, tickR, chip);
        tx += tickR * 2 + tickGap;
      }
    }
  }

  /**
   * Presentation-side cooldown animator (Jake, 2026-07-17: cooldowns "don't
   * smoothly count down… very jitter"). The raw frac reaches the bar on
   * whatever cadence the state pipeline produces — 30Hz snapshot staircases,
   * wire quantization, and brief reconcile regressions all render as jitter
   * if drawn raw. The DISPLAY value is what gets drawn:
   *
   *   - smoothed toward the target (~90ms exponential), so staircases ramp;
   *   - MONOTONE while recovering — small regressions are absorbed entirely
   *     (a reconcile that walks the frac back 5% must not wiggle the ring);
   *   - a real use (target slams low) snaps down instantly and stamps the
   *     USE-POP (the "hit" moment must punch, never ease);
   *   - reaching full stamps the READY-PING (one clear "it's back" beat).
   *
   * Returns the display frac plus 1→0 decay envelopes for both events.
   */
  private animateFrac(
    key: string,
    target: number,
    nowMs: number,
    dtMs: number,
  ): { frac: number; usePop: number; readyPing: number } {
    let a = this.slotAnim.get(key);
    if (!a) {
      a = { display: Phaser.Math.Clamp(target, 0, 1), usedAtMs: -1e9, readyAtMs: -1e9 };
      this.slotAnim.set(key, a);
    }
    const t = Phaser.Math.Clamp(target, 0, 1);
    if (t < 0.35 && t < a.display - 0.25) {
      // Ability fired (a genuine slam to empty, not sensor noise): snap.
      a.display = t;
      a.usedAtMs = nowMs;
    } else {
      const wasReady = a.display >= 0.999;
      const k = 1 - Math.exp(-dtMs / 90);
      // Monotone-up: chase only upward; regressions hold the line.
      a.display = Math.min(1, a.display + Math.max(0, t - a.display) * k);
      if (t >= 0.999 && a.display > 0.99) a.display = 1;
      if (!wasReady && a.display >= 0.999) a.readyAtMs = nowMs;
    }
    return {
      frac: a.display,
      usePop: Math.max(0, 1 - (nowMs - a.usedAtMs) / 240),
      readyPing: Math.max(0, 1 - (nowMs - a.readyAtMs) / 340),
    };
  }

  /** The use-pop / ready-ping strokes shared by every cooldown slot —
   *  drawn AFTER the slot body so the flash sits on top. */
  private drawSlotBeats(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    usePop: number,
    readyPing: number,
  ): void {
    if (usePop > 0) {
      // The hit: a hot flash collapsing with the pop envelope.
      g.lineStyle(2.5, 0xe8ecf4, 0.85 * usePop);
      g.strokePoints(this.diamondPoints(cx, cy, r * (1 + 0.22 * usePop)), true);
      g.fillStyle(0xe8ecf4, 0.18 * usePop);
      g.fillPoints(this.diamondPoints(cx, cy, r), true);
    }
    if (readyPing > 0) {
      // The return: one ring expanding out of the diamond and fading.
      const t = 1 - readyPing;
      g.lineStyle(2, PALETTE.sapphirePulse, 0.9 * readyPing);
      g.strokeCircle(cx, cy, r * (0.72 + 0.55 * t));
    }
  }

  // ─── Drawing helpers ──────────────────────────────────────────────────────

  private drawOrb(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    ratio: number,
    color: number,
    isDead: boolean,
  ): void {
    g.fillStyle(0x0a0e1a, 0.9);
    g.fillCircle(cx, cy, r * 0.86);
    if (isDead) {
      g.lineStyle(Math.max(2, r * 0.14), C_FRAME_DIM, 0.6);
      g.strokeCircle(cx, cy, r * 0.86);
      return;
    }
    drawFacetedRing(g, cx, cy, r, Math.max(2.5, r * 0.16), ratio, color, 0.95, 0x1f2937, 0.4);
    g.lineStyle(1, C_FRAME, 0.7);
    g.strokeCircle(cx, cy, r * 0.7);
  }

  private drawEmptyOrbFrame(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number): void {
    g.fillStyle(0x0a0e1a, 0.5);
    g.fillCircle(cx, cy, r * 0.86);
    g.lineStyle(1.5, C_FRAME_DIM, 0.5);
    g.strokeCircle(cx, cy, r * 0.86);
  }

  /** Chamfered diamond outline — 12 points (4 tips + 2 chamfer points each). */
  private diamondPoints(cx: number, cy: number, r: number): Phaser.Math.Vector2[] {
    const tips = [-90, 0, 90, 180];
    const pts: Phaser.Math.Vector2[] = [];
    for (const tip of tips) {
      for (const offset of [-14, 0, 14]) {
        const a = Phaser.Math.DegToRad(tip + offset);
        const rr = offset === 0 ? r : r * 0.82;
        pts.push(new Phaser.Math.Vector2(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr));
      }
    }
    return pts;
  }

  private drawLiveSlot(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    ready: number,
    glyph: "shuriken" | "dash",
  ): void {
    const pts = this.diamondPoints(cx, cy, r);
    g.fillStyle(0x0a0e1a, 0.92);
    g.fillPoints(pts, true);

    // Cooldown ring inside the diamond frame — same faceted-ring language
    // as the resource orbs and nameplate rings, sized to sit clear of the
    // diamond's own tips.
    //
    // Color/alpha track `ready` continuously (textDim -> sapphireSteady,
    // 0.6/0.75 -> 0.85/1 alpha) instead of a binary ready>=1 switch — the
    // old switch meant the icon sat at its single "not ready" tint for the
    // ENTIRE cooldown and only snapped bright the instant it hit exactly
    // 1.0. Invisible at the old 520ms dash cooldown; unmissably "stuck" at
    // the current 3000ms one (Jake, 2026-07-15). The faceted ring's own
    // fill amount was always driven by `ready` correctly — only the
    // color/alpha around it were static.
    const readyColor = lerpHexColor(PALETTE.textDim, PALETTE.sapphireSteady, ready);
    const ringAlpha = 0.75 + 0.25 * Phaser.Math.Clamp(ready, 0, 1);
    drawFacetedRing(g, cx, cy, r * 0.62, Math.max(2, r * 0.12), ready, readyColor, ringAlpha, 0x1f2937, 0.35);

    const frameColor = lerpHexColor(C_FRAME, PALETTE.sapphireSteady, ready);
    const frameAlpha = 0.6 + 0.25 * Phaser.Math.Clamp(ready, 0, 1);
    g.lineStyle(1.5, frameColor, frameAlpha);
    g.strokePoints(pts, true);

    // Small vector glyph — shuriken for the throw, chevron-burst for dash —
    // no icon asset pipeline needed, and it's literally the mechanic.
    g.lineStyle(Math.max(1.2, r * 0.09), readyColor, 0.9);
    if (glyph === "shuriken") {
      const spokeR = r * 0.3;
      for (let i = 0; i < 4; i++) {
        const a = Phaser.Math.DegToRad(i * 90 + 45);
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * spokeR, cy + Math.sin(a) * spokeR);
        g.strokePath();
      }
      g.fillStyle(readyColor, 0.9);
      g.fillCircle(cx, cy, r * 0.08);
    } else {
      const dashR = r * 0.28;
      g.beginPath();
      g.moveTo(cx - dashR, cy - dashR * 0.7);
      g.lineTo(cx + dashR, cy);
      g.lineTo(cx - dashR, cy + dashR * 0.7);
      g.strokePath();
    }
  }

  /** A drafted-active slot (six-axes Layer 2). Same diamond + faceted-ring
   *  language as every other slot: the ring IS the cooldown sweep
   *  (readyFrac 0→1, continuous color/alpha lerp — the drawLiveSlot
   *  lesson), and a live effect window (Tithe's 3s) draws a crimson outer
   *  pulse so "my active is ON" reads without looking at the chips row.
   *  Glyphs are per-kind stroke drawings (house convention). */
  private drawActiveSlot(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    slot: ActiveSlotVital,
    isDead: boolean,
  ): void {
    const pts = this.diamondPoints(cx, cy, r);
    g.fillStyle(0x0a0e1a, isDead ? 0.55 : 0.92);
    g.fillPoints(pts, true);

    const ready = Phaser.Math.Clamp(slot.readyFrac, 0, 1);
    const readyColor = lerpHexColor(PALETTE.textDim, PALETTE.sapphireSteady, ready);
    const ringAlpha = isDead ? 0.5 : 0.75 + 0.25 * ready;
    drawFacetedRing(g, cx, cy, r * 0.62, Math.max(2, r * 0.12), ready, readyColor, ringAlpha, 0x1f2937, 0.35);

    g.lineStyle(1.5, lerpHexColor(C_FRAME, PALETTE.sapphireSteady, ready), isDead ? 0.5 : 0.6 + 0.25 * ready);
    g.strokePoints(pts, true);

    // Effect window live: crimson pulse ring outside the diamond.
    if (slot.windowFrac > 0 && !isDead) {
      const pulse = 0.55 + 0.35 * Math.sin(this.scene.time.now / 90);
      g.lineStyle(2, 0xdc2626, pulse);
      g.strokeCircle(cx, cy, r * (0.92 + 0.1 * slot.windowFrac));
    }

    // Per-kind glyph — the mechanic drawn in strokes (house convention).
    // Dispatch lives in actionBarGlyphs.ts (extracted for unit-testability —
    // a real Phaser Graphics can't be constructed under `bun test`, see that
    // file's header) and covers both the five class-blind six-axes kinds and
    // the ten Geometrician catalog kinds (docs/class-ability-catalogs-v1.md,
    // chunk 4.3 — these previously fell through to the generic dot below).
    const glyphColor = slot.windowFrac > 0 ? 0xdc2626 : readyColor;
    drawActiveGlyph(g, cx, cy, r, slot.kind, glyphColor);
  }

  private drawReservedSlot(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number): void {
    const pts = this.diamondPoints(cx, cy, r);
    g.fillStyle(0x0a0e1a, 0.55);
    g.fillPoints(pts, true);
    g.lineStyle(1, C_FRAME_DIM, 0.4);
    g.strokePoints(pts, true);
  }

  /** A card-granted capability slot (acquiredAbilities.ts). Same diamond +
   *  faceted-ring language as every live slot; the glyph is the mechanic
   *  drawn in strokes (house convention — no icon asset pipeline). Most
   *  acquired capabilities are passive → ring sits full; Stolen Fangs is
   *  the exception: its ring is the banked lock charges (0–2). The pop-in
   *  (popT 0→1 over ~260ms) scales the slot in with a fading flash ring —
   *  the acquisition moment should read from the corner of an eye. */
  private drawAcquiredSlot(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    baseR: number,
    ability: AcquiredAbility,
    vitals: ActionBarVitals,
    popT: number,
  ): void {
    // Ease-out-back-ish overshoot on entry.
    const pop = popT >= 1 ? 1 : 0.7 + 0.42 * popT - 0.12 * popT * popT;
    const r = baseR * pop;
    const isDead = vitals.isDead;
    const ready =
      ability.kind === "stolen-fangs"
        ? Phaser.Math.Clamp(vitals.stolenFangsCharges / 2, 0, 1)
        : 1;

    const pts = this.diamondPoints(cx, cy, r);
    g.fillStyle(0x0a0e1a, isDead ? 0.55 : 0.92);
    g.fillPoints(pts, true);
    const readyColor = lerpHexColor(PALETTE.textDim, PALETTE.sapphireSteady, ready);
    drawFacetedRing(
      g, cx, cy, r * 0.62, Math.max(2, r * 0.12), ready,
      readyColor, isDead ? 0.5 : 0.75 + 0.25 * ready, 0x1f2937, 0.35,
    );
    g.lineStyle(1.5, lerpHexColor(C_FRAME, PALETTE.sapphireSteady, ready), isDead ? 0.5 : 0.85);
    g.strokePoints(pts, true);

    // Acquisition flash: a bright expanding ring during the pop window.
    if (popT < 1 && !isDead) {
      g.lineStyle(2, 0xcedffd, 0.8 * (1 - popT));
      g.strokeCircle(cx, cy, r * (0.5 + 0.6 * popT));
    }

    // Glyph — strokes only, the mechanic itself.
    const gw = Math.max(1.2, r * 0.09);
    g.lineStyle(gw, readyColor, isDead ? 0.55 : 0.9);
    const s = r * 0.3;
    switch (ability.kind) {
      case "satellites": {
        // Orbit ring + companion dot.
        g.strokeCircle(cx, cy, s);
        g.fillStyle(readyColor, 0.95);
        g.fillCircle(cx + s, cy, Math.max(1.5, r * 0.09));
        g.fillCircle(cx, cy, Math.max(1.2, r * 0.06));
        break;
      }
      case "stolen-fangs": {
        // Two fangs, points down.
        g.fillStyle(readyColor, 0.9);
        g.fillTriangle(cx - s * 0.7, cy - s * 0.5, cx - s * 0.2, cy - s * 0.5, cx - s * 0.45, cy + s * 0.7);
        g.fillTriangle(cx + s * 0.2, cy - s * 0.5, cx + s * 0.7, cy - s * 0.5, cx + s * 0.45, cy + s * 0.7);
        break;
      }
      case "mirror-shield": {
        // Mirrored brackets: ] [
        g.beginPath();
        g.moveTo(cx - s * 0.9, cy - s * 0.7);
        g.lineTo(cx - s * 0.4, cy);
        g.lineTo(cx - s * 0.9, cy + s * 0.7);
        g.strokePath();
        g.beginPath();
        g.moveTo(cx + s * 0.9, cy - s * 0.7);
        g.lineTo(cx + s * 0.4, cy);
        g.lineTo(cx + s * 0.9, cy + s * 0.7);
        g.strokePath();
        break;
      }
      case "aim-shield": {
        // Aim cone opening toward the right.
        g.beginPath();
        g.moveTo(cx - s * 0.5, cy);
        g.lineTo(cx + s * 0.9, cy - s * 0.75);
        g.strokePath();
        g.beginPath();
        g.moveTo(cx - s * 0.5, cy);
        g.lineTo(cx + s * 0.9, cy + s * 0.75);
        g.strokePath();
        g.fillStyle(readyColor, 0.95);
        g.fillCircle(cx - s * 0.5, cy, Math.max(1.2, r * 0.07));
        break;
      }
      case "air-jumps": {
        // Double chevron up.
        for (const dy of [s * 0.45, -s * 0.25]) {
          g.beginPath();
          g.moveTo(cx - s * 0.7, cy + dy + s * 0.35);
          g.lineTo(cx, cy + dy - s * 0.35);
          g.lineTo(cx + s * 0.7, cy + dy + s * 0.35);
          g.strokePath();
        }
        break;
      }
    }
  }

  /** The Emission meter (Emission Engine P0 — docs/emission-engine-goal.md).
   *  Same chamfered diamond as every other slot, with the house faceted-ring
   *  resource language inside tracking charge — no new visual vocabulary.
   *  No glyph: the payload is composed from the card hand, so the slot shows
   *  a single point of light that only exists at full charge (ui-axioms:
   *  "one point of light earning its keep"), breathing on a slow sine.
   *  While dead the frame dims like other live slots but the RING keeps its
   *  fill — charge persists through death by doctrine, and the meter
   *  claiming otherwise would lie. */
  private drawEmissionSlot(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    chargeFrac: number,
    isDead: boolean,
  ): void {
    const frac = Phaser.Math.Clamp(chargeFrac, 0, 1);
    const pts = this.diamondPoints(cx, cy, r);
    g.fillStyle(0x0a0e1a, isDead ? 0.55 : 0.92);
    g.fillPoints(pts, true);
    const full = frac >= 1;
    // Frame brightens with charge; sapphire at full (combat register).
    const frameColor = full ? 0x3c79f0 : lerpHexColor(C_FRAME_DIM, C_FRAME, frac);
    g.lineStyle(full ? 1.5 : 1, frameColor, isDead ? 0.45 : 0.4 + 0.5 * frac);
    g.strokePoints(pts, true);
    if (frac <= 0) return;
    // Charge ring — same faceted language as the orbs/nameplates.
    drawFacetedRing(
      g,
      cx,
      cy,
      r * 0.62,
      Math.max(2, r * 0.14),
      frac,
      full ? 0x6b98f4 : 0x3c79f0,
      isDead ? 0.55 : 0.9,
      0x1f2937,
      0.35,
    );
    if (full && !isDead) {
      // The point of light: exists only at full charge, breathing slowly.
      // Render-only wall-clock (scene.time.now) — never sim state.
      const breathe = 0.65 + 0.35 * Math.sin(this.scene.time.now / 420);
      g.fillStyle(0xcedffd, breathe);
      g.fillCircle(cx, cy, Math.max(2, r * 0.16));
    }
  }

  /** A live ability while dead — distinct from `drawReservedSlot`: this one
   *  is YOURS, just inert right now, so the glyph stays faintly visible
   *  (grey, no ready-ring) instead of reading as "not unlocked yet." */
  private drawDisabledSlot(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    glyph: "shuriken" | "dash",
  ): void {
    const pts = this.diamondPoints(cx, cy, r);
    g.fillStyle(0x0a0e1a, 0.55);
    g.fillPoints(pts, true);
    g.lineStyle(1, C_FRAME_DIM, 0.5);
    g.strokePoints(pts, true);

    g.lineStyle(Math.max(1, r * 0.08), C_FRAME, 0.55);
    if (glyph === "shuriken") {
      const spokeR = r * 0.3;
      for (let i = 0; i < 4; i++) {
        const a = Phaser.Math.DegToRad(i * 90 + 45);
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * spokeR, cy + Math.sin(a) * spokeR);
        g.strokePath();
      }
    } else {
      const dashR = r * 0.28;
      g.beginPath();
      g.moveTo(cx - dashR, cy - dashR * 0.7);
      g.lineTo(cx + dashR, cy);
      g.lineTo(cx - dashR, cy + dashR * 0.7);
      g.strokePath();
    }
  }

  private drawBuffTick(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, chip: HudChip): void {
    g.fillStyle(0x0a0e1a, 0.85);
    g.fillCircle(cx, cy, r);
    g.lineStyle(1.5, chip.color, chip.isDebuff ? 0.7 : 0.95);
    g.strokeCircle(cx, cy, r);
    if (chip.isDebuff) {
      g.fillStyle(chip.color, 0.85);
      g.fillTriangle(cx - r * 0.4, cy - r * 0.3, cx + r * 0.4, cy - r * 0.3, cx, cy + r * 0.45);
    } else {
      g.fillStyle(chip.color, 0.85);
      g.fillTriangle(cx - r * 0.4, cy + r * 0.3, cx + r * 0.4, cy + r * 0.3, cx, cy - r * 0.45);
    }
  }
}
