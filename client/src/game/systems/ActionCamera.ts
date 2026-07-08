import Phaser from "phaser";

/** Per-frame inputs the camera frames around. `extra` are other action
 *  points (opponents, etc.) the frame should lean toward without letting go
 *  of the player. `yBias` shifts the framed centre down (portrait mobile). */
export interface CameraFocus {
  x: number;
  y: number;
  vx: number;
  vy: number;
  aimX: number;
  aimY: number;
  extra?: ReadonlyArray<{ x: number; y: number }>;
  yBias?: number;
}

/**
 * ActionCamera — a hand-driven follow camera replacing Phaser's naive
 * `startFollow` lerp (frame-rate dependent) and the online path's hard
 * per-frame `centerOn` (reports every physics micro-jitter 1:1, feels
 * rigid/bad). Composes, in one update:
 *
 *  1. Weighted-centroid target — the player weighted heavily (stays anchored
 *     near centre) blended with nearby action points, so the frame leans
 *     toward the fight without losing the player. ("envelope the action")
 *  2. Look-ahead — an eased offset toward movement + aim, so you see where
 *     you're going, not where you've been.
 *  3. Soft deadzone + frame-rate-independent exponential smoothing — tight
 *     but soft; low-passes landing/physics jitter the hard follow exposed.
 *  4. Trauma-based shake as an ADDITIVE offset on top of the smoothed centre
 *     — punchy impacts that never destabilise the base follow.
 *
 * Grounded in Keren "Scroll Back" (GDC15), Eiserloh "Juicing Your Cameras"
 * (GDC16), Driscoll/Holmer frame-rate-independent damping. Deliberately does
 * NOT do a sustained speed-zoom: zoom>1 shifts the scroll-fixed HUD, and a
 * zoom-punch on a frequent action (wall-jump) pulses the whole frame and
 * reads as instability — impacts use trauma shake instead. Zoom-punch is
 * reserved for RARE events (a kill) via punchZoom().
 */
export class ActionCamera {
  private readonly cam: Phaser.Cameras.Scene2D.Camera;

  // Smoothed camera centre in world space — tracked here (not read back from
  // the camera) so the additive shake never feeds into the follow.
  private cx = 0;
  private cy = 0;
  // Eased look-ahead offset (glides across centre on a direction flip
  // instead of snapping).
  private leadX = 0;
  private leadY = 0;
  private trauma = 0;
  private shakeTime = 0;
  private ready = false;
  // Resting zoom the frame sits at (the "cropped closer" base). punchZoom
  // returns to THIS, captured once, so overlapping punches can't ratchet the
  // zoom away from its true resting value.
  private baseZoom = 1;

  // --- tuning (fractions of viewport where noted; see research defaults) ---
  private static readonly FOLLOW_K = 8; // follow stiffness (1/s)
  private static readonly LEAD_K = 3; // look-ahead ease (1/s), slower = glidier
  private static readonly LEAD_FRAC = 0.2; // max horizontal lead as frac of half-width
  private static readonly VLEAD_SCALE = 0.4; // vertical lead is gentler (jumps extrapolate badly)
  private static readonly AIM_LEAD_FRAC = 0.1; // aim lead as frac of half-width
  private static readonly LEAD_SATURATE_SPEED = 520; // px/s at which movement lead maxes
  private static readonly DEADZONE_FRAC = 0.04; // soft slack radius as frac of width
  private static readonly SELF_WEIGHT = 4; // player dominates the centroid
  private static readonly OTHER_WEIGHT = 1;
  private static readonly OTHER_FADE = 640; // px: other-point weight falls off over this
  private static readonly OTHER_MAX_DIST = 1400; // px: ignore action beyond this
  private static readonly TRAUMA_DECAY = 1.6; // per second
  private static readonly MAX_SHAKE_PX = 26;
  private static readonly SNAP_DIST = 900; // px jump that counts as a teleport

  constructor(cam: Phaser.Cameras.Scene2D.Camera) {
    this.cam = cam;
    this.baseZoom = cam.zoom;
  }

  /** Set the resting zoom (the "cropped closer, character is the main event"
   *  base). punchZoom returns here. */
  setBaseZoom(zoom: number): void {
    this.baseZoom = zoom;
    this.cam.setZoom(zoom);
  }

  /** Snap the camera onto a point instantly (scene start / respawn / teleport). */
  snap(x: number, y: number): void {
    this.cx = x;
    this.cy = y;
    this.leadX = 0;
    this.leadY = 0;
    this.ready = true;
    this.cam.centerOn(x, y);
  }

  /** Additive impact trauma (0-1 clamped). shake = trauma², so small bumps
   *  stay subtle and big ones read. */
  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** RARE zoom-punch (a kill) — out then back to the resting base zoom.
   *  Never call this for a frequent movement action; use addTrauma there.
   *  Returns to the cached `baseZoom` (not a fresh `cam.zoom` read) and
   *  defers the return tween one tick, so overlapping punches can't ratchet
   *  the zoom away permanently (the old "screen keeps shrinking" bug). */
  punchZoom(scaleDelta: number, outMs = 70, backMs = 200): void {
    const base = this.baseZoom;
    this.cam.zoomTo(base + scaleDelta, outMs, "Quad.easeOut", true, (_, progress) => {
      if (progress === 1) {
        this.cam.scene.time.delayedCall(0, () => {
          this.cam.zoomTo(base, backMs, "Quad.easeIn", true);
        });
      }
    });
  }

  update(deltaMs: number, focus: CameraFocus): void {
    const dt = Math.min(deltaMs, 50) / 1000; // clamp spikes (tab-out etc.)
    if (!this.ready) {
      this.snap(focus.x, focus.y + (focus.yBias ?? 0));
      return;
    }
    // Teleport guard: on a respawn/warp the target jumps across the level;
    // snap instead of smearing the camera the whole way.
    if (Math.hypot(focus.x - this.cx, focus.y - this.cy) > ActionCamera.SNAP_DIST) {
      this.snap(focus.x, focus.y + (focus.yBias ?? 0));
      return;
    }

    // 1. Weighted centroid — player heavy, nearby action fades in by distance.
    let tx = focus.x * ActionCamera.SELF_WEIGHT;
    let ty = focus.y * ActionCamera.SELF_WEIGHT;
    let wSum = ActionCamera.SELF_WEIGHT;
    for (const p of focus.extra ?? []) {
      const d = Math.hypot(p.x - focus.x, p.y - focus.y);
      if (d > ActionCamera.OTHER_MAX_DIST) continue;
      const w = ActionCamera.OTHER_WEIGHT / (1 + d / ActionCamera.OTHER_FADE);
      tx += p.x * w;
      ty += p.y * w;
      wSum += w;
    }
    tx /= wSum;
    ty /= wSum;
    ty += focus.yBias ?? 0;

    // 2. Look-ahead toward movement + aim, eased so a flip glides.
    const halfW = this.cam.width / 2 / this.cam.zoom;
    const speed = Math.hypot(focus.vx, focus.vy) || 1;
    const speedFrac = Math.min(1, speed / ActionCamera.LEAD_SATURATE_SPEED);
    const moveLeadX = (focus.vx / speed) * speedFrac * halfW * ActionCamera.LEAD_FRAC;
    const moveLeadY =
      (focus.vy / speed) * speedFrac * halfW * ActionCamera.LEAD_FRAC * ActionCamera.VLEAD_SCALE;
    const aimDx = focus.aimX - focus.x;
    const aimDy = focus.aimY - focus.y;
    const aimLen = Math.hypot(aimDx, aimDy) || 1;
    const aimLeadX = (aimDx / aimLen) * halfW * ActionCamera.AIM_LEAD_FRAC;
    const aimLeadY = (aimDy / aimLen) * halfW * ActionCamera.AIM_LEAD_FRAC * ActionCamera.VLEAD_SCALE;
    const goalLeadX = moveLeadX + aimLeadX;
    const goalLeadY = moveLeadY + aimLeadY;
    const leadK = 1 - Math.exp(-ActionCamera.LEAD_K * dt);
    this.leadX += (goalLeadX - this.leadX) * leadK;
    this.leadY += (goalLeadY - this.leadY) * leadK;
    tx += this.leadX;
    ty += this.leadY;

    // 3. Soft deadzone (slack) + exp-decay follow (frame-rate independent).
    const dz = this.cam.width * ActionCamera.DEADZONE_FRAC;
    const effTx = this.cx + ActionCamera.deadzoned(tx - this.cx, dz);
    const effTy = this.cy + ActionCamera.deadzoned(ty - this.cy, dz);
    const followK = 1 - Math.exp(-ActionCamera.FOLLOW_K * dt);
    this.cx += (effTx - this.cx) * followK;
    this.cy += (effTy - this.cy) * followK;

    // 4. Trauma shake as an additive offset on the smoothed centre.
    this.trauma = Math.max(0, this.trauma - ActionCamera.TRAUMA_DECAY * dt);
    this.shakeTime += dt;
    const shake = this.trauma * this.trauma;
    const amp = ActionCamera.MAX_SHAKE_PX * shake;
    const ox = amp * ActionCamera.smoothNoise(this.shakeTime, 0);
    const oy = amp * ActionCamera.smoothNoise(this.shakeTime, 100);

    this.cam.centerOn(this.cx + ox, this.cy + oy);
  }

  /** Zero within `dz`, linear beyond — a small slack box so tiny jitters
   *  don't tug the camera. The exp-follow softens the boundary crossing. */
  private static deadzoned(delta: number, dz: number): number {
    const a = Math.abs(delta);
    return a <= dz ? 0 : Math.sign(delta) * (a - dz);
  }

  /** Smooth, deterministic, pause/slow-mo-safe noise in ~[-1,1] — summed
   *  incommensurate sines (cheap stand-in for Perlin, per Eiserloh's
   *  "don't use random()"). */
  private static smoothNoise(t: number, seed: number): number {
    return (
      Math.sin(t * 13.7 + seed) * 0.6 +
      Math.sin(t * 29.3 + seed * 2.1) * 0.4
    );
  }
}
