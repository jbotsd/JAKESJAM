// On-screen touch controls for the live match (mobile).
//
// Research-backed layout for a twin-thumb platform-brawler (landscape):
//   - LEFT thumb  → floating MOVE stick. Horizontal = walk L/R. Up-tilt or
//     flick = Jump; a quick TAP = spacebar (jump/wall-jump — how a wall
//     climb starts). Down-tilt = crouch/down.
//   - RIGHT thumb → floating AIM+FIRE stick. Drag sets aim direction and
//     fires while held (twin-stick auto-fire — the smoothest mobile aim).
//   - Two thumb buttons bottom-centre → SHIELD (hold) and DASH. The DASH
//     button is a tiny joystick: drag it and the aegis dash fires in the
//     drag direction the moment it crosses the trigger (fully analog, the
//     same any-angle freedom as desktop mouse dash); a plain tap dashes in
//     the move-stick direction.
//
// Floating joysticks (base spawns where the thumb lands) beat fixed pads —
// more forgiving and no need to look down. Multi-touch is tracked by
// pointerId so both sticks + a button work simultaneously. The overlay is
// DOM (crisp, notch-safe via safe-area insets) layered over the pixel-art
// canvas; it only captures touches on its own control elements.

import { InputBit } from "../../net/protocol";

export type TouchInputState = {
  /** InputBit bitfield to merge into the sim input. */
  keys: number;
  /** Normalized aim direction from the right stick, or null when not aiming
   *  (caller keeps the last aim so shots keep their heading). */
  aimDir: { x: number; y: number } | null;
  /** Normalized dash direction from the DASH mini-stick drag, or null when
   *  the dash was a plain tap (caller falls back to the move direction). */
  dashDir: { x: number; y: number } | null;
  /** Normalized move-stick vector (null inside the deadzone) — the tap-dash
   *  direction fallback. */
  moveDir: { x: number; y: number } | null;
};

const MOVE_DEADZONE = 0.22;
// Jump lives on the stick, but a plain tilt threshold is unreachable
// mid-run: walking pins the thumb at the rim horizontally, and arcing it
// upward barely moves the normalized angle. Two mechanics fix it:
//   - FLICK: a fast upward knob movement latches Jump (held while the
//     thumb stays up, so variable jump height still works).
//   - FOLLOWING BASE: past the rim, the base drifts with the thumb, so
//     "up" is always one small motion from wherever the thumb is now.
const JUMP_HOLD_TILT = 0.42; // deliberate up-hold still jumps
const JUMP_RELEASE_TILT = 0.12; // latch releases when thumb returns here
const FLICK_WINDOW_MS = 120; // upward delta must happen this fast
const FLICK_DELTA = 0.26; // normalized dy drop that counts as a flick
const CROUCH_TILT = 0.6; // down-tilt = crouch/down
const STICK_RADIUS = 56; // px the knob travels from the base
const AIM_DEADZONE = 0.3;
// TAP-JUMP: a quick tap on the move zone = spacebar. The sim resolves it —
// ground jump on the floor, WALL-JUMP when airborne against a wall — so
// tapping is also how a wall climb starts (grounded-against-wall zeroes
// touchingWallDir in the sim, so the auto-hop assist alone can never fire
// the FIRST hop; a tap can).
const TAP_MAX_MS = 180;
const TAP_MAX_DRIFT_PX = 12;
/** Held long enough to cross at least one 60Hz input tick edge. */
const PULSE_MS = 90;
// DASH mini-stick: dragging the DASH button is a tiny joystick — the dash
// fires the instant the drag crosses the threshold, in that direction
// (fully analog, matching desktop mouse dash). A plain tap dashes in the
// move-stick direction instead.
const DASH_STICK_RADIUS = 40;
const DASH_TRIGGER_PX = 14;

type Stick = {
  pointerId: number;
  baseX: number;
  baseY: number;
  dx: number; // normalized -1..1
  dy: number;
  base: HTMLDivElement;
  knob: HTMLDivElement;
};

export class TouchControls {
  private readonly root: HTMLDivElement;
  private readonly leftZone: HTMLDivElement;
  private readonly rightZone: HTMLDivElement;
  private readonly shieldBtn: HTMLDivElement;
  private readonly dashBtn: HTMLDivElement;

  private moveStick: Stick | null = null;
  private aimStick: Stick | null = null;
  private shieldPointer: number | null = null;
  private dashPointer: number | null = null;
  /** Flick-to-jump state: recent (t, dy) samples + the jump latch. */
  private moveDySamples: Array<{ t: number; dy: number }> = [];
  private jumpLatched = false;
  /** Tap-jump: move-zone press bookkeeping + the short Jump pulse. */
  private movePressedAtMs = 0;
  private movePressX = 0;
  private movePressY = 0;
  private moveMaxDriftPx = 0;
  private jumpPulseUntilMs = 0;
  /** Dash mini-stick: press origin, live drag direction, tap pulse. */
  private dashPressX = 0;
  private dashPressY = 0;
  private dashDir: { x: number; y: number } | null = null;
  private dashEngaged = false; // drag crossed the trigger threshold
  private dashPulseUntilMs = 0; // tap-dash: hold the bit long enough to tick
  private dashKnob: Stick | null = null;

  private attached = false;
  private readonly mount: HTMLElement;
  /** Off in Practice — no combat there, so the buttons would show a
   *  mechanic with nothing to react to (docs/practice-zone-goal.md item 3:
   *  combat UI genuinely absent, not just inert). On for the online path. */
  private readonly combatButtons: boolean;

  constructor(mount: HTMLElement = document.body, options: { combatButtons?: boolean } = {}) {
    this.mount = mount;
    this.combatButtons = options.combatButtons ?? true;
    this.root = el("div", "tc-root");
    this.leftZone = el("div", "tc-zone tc-zone--left");
    this.rightZone = el("div", "tc-zone tc-zone--right");
    this.shieldBtn = el("div", "tc-btn tc-btn--shield");
    this.shieldBtn.textContent = "SHIELD";
    this.dashBtn = el("div", "tc-btn tc-btn--dash");
    this.dashBtn.textContent = "DASH";
    this.root.append(this.leftZone, this.rightZone);
    if (this.combatButtons) {
      this.root.append(this.shieldBtn, this.dashBtn);
    }
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.mount.appendChild(this.root);
    // pointerdown per zone/button; move/up on window so a drag that leaves
    // the zone still tracks (thumbs wander).
    this.leftZone.addEventListener("pointerdown", this.onLeftDown, { passive: false });
    this.rightZone.addEventListener("pointerdown", this.onRightDown, { passive: false });
    if (this.combatButtons) {
      this.shieldBtn.addEventListener("pointerdown", this.onShieldDown, { passive: false });
      this.dashBtn.addEventListener("pointerdown", this.onDashDown, { passive: false });
    }
    window.addEventListener("pointermove", this.onMove, { passive: false });
    window.addEventListener("pointerup", this.onUp, { passive: false });
    window.addEventListener("pointercancel", this.onUp, { passive: false });
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? "block" : "none";
    if (!v) this.reset();
  }

  /** Current control state → sim input. Called once per frame by the scene. */
  getState(): TouchInputState {
    const now = performance.now();
    let keys = 0;
    let moveDir: { x: number; y: number } | null = null;
    if (this.moveStick) {
      const { dx, dy } = this.moveStick;
      if (dx < -MOVE_DEADZONE) keys |= InputBit.Left;
      if (dx > MOVE_DEADZONE) keys |= InputBit.Right;
      const mlen = Math.hypot(dx, dy);
      if (mlen > MOVE_DEADZONE) moveDir = { x: dx / mlen, y: dy / mlen };
      // Jump: latched by an upward flick (onMove), sustained while the
      // thumb stays up, or entered directly by a deliberate up-hold.
      if (this.jumpLatched) {
        if (dy > -JUMP_RELEASE_TILT) this.jumpLatched = false;
        else keys |= InputBit.Jump;
      } else if (dy < -JUMP_HOLD_TILT) {
        keys |= InputBit.Jump;
      }
      if (dy > CROUCH_TILT) {
        keys |= InputBit.Down;
        keys |= InputBit.Crouch;
      }
    }
    // Tap-jump pulse (spacebar): short press on the move zone released.
    if (now < this.jumpPulseUntilMs) keys |= InputBit.Jump;
    let aimDir: { x: number; y: number } | null = null;
    if (this.aimStick) {
      const { dx, dy } = this.aimStick;
      if (Math.hypot(dx, dy) > AIM_DEADZONE) {
        const len = Math.hypot(dx, dy) || 1;
        aimDir = { x: dx / len, y: dy / len };
        keys |= InputBit.Fire; // auto-fire while aiming
      }
    }
    if (this.shieldPointer !== null) keys |= InputBit.Shield;
    // Aegis dash (same bit as desktop right-click/C). The bit rises only
    // once a direction is known: either the mini-stick drag crossed the
    // trigger (dashDir carries it) or the tap pulse is live (dashDir null →
    // scene falls back to the move direction). Never on bare pointerdown —
    // that would fire the dash with a stale aim.
    if ((this.dashPointer !== null && this.dashEngaged) || now < this.dashPulseUntilMs) {
      keys |= InputBit.Dash;
    }
    return { keys, aimDir, dashDir: this.dashDir, moveDir };
  }

  destroy(): void {
    this.leftZone.removeEventListener("pointerdown", this.onLeftDown);
    this.rightZone.removeEventListener("pointerdown", this.onRightDown);
    this.shieldBtn.removeEventListener("pointerdown", this.onShieldDown);
    this.dashBtn.removeEventListener("pointerdown", this.onDashDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    this.root.remove();
    this.attached = false;
  }

  // ── Handlers ──────────────────────────────────────────────────────────

  private onLeftDown = (e: PointerEvent): void => {
    if (this.moveStick) return; // already owned by another thumb
    e.preventDefault();
    this.moveStick = this.spawnStick(e, "tc-stick--move");
    this.movePressedAtMs = e.timeStamp;
    this.movePressX = e.clientX;
    this.movePressY = e.clientY;
    this.moveMaxDriftPx = 0;
  };

  private onRightDown = (e: PointerEvent): void => {
    if (this.aimStick) return;
    e.preventDefault();
    this.aimStick = this.spawnStick(e, "tc-stick--aim");
  };

  private onShieldDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.shieldPointer = e.pointerId;
    this.shieldBtn.classList.add("tc-btn--active");
  };

  private onDashDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.dashPointer = e.pointerId;
    this.dashPressX = e.clientX;
    this.dashPressY = e.clientY;
    this.dashEngaged = false;
    this.dashDir = null;
    this.dashKnob = this.spawnStick(e, "tc-stick--dash");
    this.dashBtn.classList.add("tc-btn--active");
  };

  private onMove = (e: PointerEvent): void => {
    // DASH mini-stick drag: a tiny joystick on the button. Crossing the
    // trigger threshold fires the dash in the drag direction (fully analog).
    if (this.dashPointer === e.pointerId) {
      e.preventDefault();
      const rx = e.clientX - this.dashPressX;
      const ry = e.clientY - this.dashPressY;
      const d = Math.hypot(rx, ry);
      if (this.dashKnob) {
        const c = Math.min(d, DASH_STICK_RADIUS);
        const ux = d > 0 ? rx / d : 0;
        const uy = d > 0 ? ry / d : 0;
        this.dashKnob.knob.style.transform = `translate(${ux * c}px, ${uy * c}px)`;
      }
      if (d >= DASH_TRIGGER_PX) {
        this.dashDir = { x: rx / d, y: ry / d };
        this.dashEngaged = true;
      }
      return;
    }
    const stick =
      this.moveStick?.pointerId === e.pointerId
        ? this.moveStick
        : this.aimStick?.pointerId === e.pointerId
          ? this.aimStick
          : null;
    if (!stick) return;
    e.preventDefault();
    let rawX = e.clientX - stick.baseX;
    let rawY = e.clientY - stick.baseY;
    let dist = Math.hypot(rawX, rawY);
    // FOLLOWING BASE: past the rim, the base drifts with the thumb. The
    // stick direction is then always re-steerable with one small motion —
    // without this, walking pins the thumb at the rim and changing to
    // "up" (jump) means arcing the whole thumb around the base.
    if (dist > STICK_RADIUS) {
      const excess = dist - STICK_RADIUS;
      const fx = (rawX / dist) * excess;
      const fy = (rawY / dist) * excess;
      stick.baseX += fx;
      stick.baseY += fy;
      stick.base.style.left = `${stick.baseX}px`;
      stick.base.style.top = `${stick.baseY}px`;
      rawX -= fx;
      rawY -= fy;
      dist = STICK_RADIUS;
    }
    const clamped = Math.min(dist, STICK_RADIUS);
    const ux = dist > 0 ? rawX / dist : 0;
    const uy = dist > 0 ? rawY / dist : 0;
    stick.dx = (ux * clamped) / STICK_RADIUS;
    stick.dy = (uy * clamped) / STICK_RADIUS;
    stick.knob.style.transform = `translate(${ux * clamped}px, ${uy * clamped}px)`;

    // Flick-to-jump detection (move stick only): a fast upward dy delta
    // inside the window latches Jump (released in getState when the thumb
    // comes back toward centre).
    if (stick === this.moveStick) {
      this.moveMaxDriftPx = Math.max(
        this.moveMaxDriftPx,
        Math.hypot(e.clientX - this.movePressX, e.clientY - this.movePressY),
      );
      const now = e.timeStamp;
      this.moveDySamples.push({ t: now, dy: stick.dy });
      while (this.moveDySamples.length > 0 && now - this.moveDySamples[0]!.t > FLICK_WINDOW_MS) {
        this.moveDySamples.shift();
      }
      const oldest = this.moveDySamples[0];
      if (oldest && oldest.dy - stick.dy >= FLICK_DELTA && stick.dy < -JUMP_RELEASE_TILT) {
        this.jumpLatched = true;
      }
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (this.moveStick?.pointerId === e.pointerId) {
      // TAP-JUMP: a quick, drift-free press on the move zone is spacebar —
      // the sim picks ground jump vs wall-jump. Pulsed (not edge-frame) so
      // at least one input tick sees the press.
      if (
        e.timeStamp - this.movePressedAtMs <= TAP_MAX_MS &&
        this.moveMaxDriftPx <= TAP_MAX_DRIFT_PX
      ) {
        this.jumpPulseUntilMs = performance.now() + PULSE_MS;
      }
      this.moveStick.base.remove();
      this.moveStick = null;
      this.moveDySamples.length = 0;
      this.jumpLatched = false;
    }
    if (this.aimStick?.pointerId === e.pointerId) {
      this.aimStick.base.remove();
      this.aimStick = null;
    }
    if (this.shieldPointer === e.pointerId) {
      this.shieldPointer = null;
      this.shieldBtn.classList.remove("tc-btn--active");
    }
    if (this.dashPointer === e.pointerId) {
      // Plain tap (never crossed the drag trigger): dash in the move-stick
      // direction — dashDir stays null and the scene supplies the fallback.
      if (!this.dashEngaged) {
        this.dashDir = null;
        this.dashPulseUntilMs = performance.now() + PULSE_MS;
      } else {
        this.dashDir = null;
      }
      this.dashEngaged = false;
      this.dashKnob?.base.remove();
      this.dashKnob = null;
      this.dashPointer = null;
      this.dashBtn.classList.remove("tc-btn--active");
    }
  };

  private spawnStick(e: PointerEvent, knobClass: string): Stick {
    const base = el("div", "tc-stick");
    const knob = el("div", `tc-stick-knob ${knobClass}`);
    base.appendChild(knob);
    base.style.left = `${e.clientX}px`;
    base.style.top = `${e.clientY}px`;
    this.root.appendChild(base);
    return { pointerId: e.pointerId, baseX: e.clientX, baseY: e.clientY, dx: 0, dy: 0, base, knob };
  }

  private reset(): void {
    this.moveStick?.base.remove();
    this.aimStick?.base.remove();
    this.dashKnob?.base.remove();
    this.moveStick = null;
    this.aimStick = null;
    this.dashKnob = null;
    this.moveDySamples.length = 0;
    this.jumpLatched = false;
    this.jumpPulseUntilMs = 0;
    this.shieldPointer = null;
    this.dashPointer = null;
    this.dashDir = null;
    this.dashEngaged = false;
    this.dashPulseUntilMs = 0;
    this.shieldBtn.classList.remove("tc-btn--active");
    this.dashBtn.classList.remove("tc-btn--active");
  }
}

function el(tag: string, className: string): HTMLDivElement {
  const d = document.createElement(tag) as HTMLDivElement;
  d.className = className;
  return d;
}
