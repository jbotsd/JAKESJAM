// On-screen touch controls for the live match (mobile).
//
// Research-backed layout for a twin-thumb platform-brawler (landscape):
//   - LEFT thumb  → floating MOVE stick. Horizontal = walk L/R. Up-tilt =
//     Jump (hold to sustain the jetpack). Down-tilt = crouch/down.
//   - RIGHT thumb → floating AIM+FIRE stick. Drag sets aim direction and
//     fires while held (twin-stick auto-fire — the smoothest mobile aim).
//   - Two thumb buttons bottom-centre → SHIELD (hold) and PARRY (tap).
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
};

const MOVE_DEADZONE = 0.22;
const JUMP_TILT = 0.5; // up-tilt past this on the move stick = jump
const CROUCH_TILT = 0.6; // down-tilt = crouch/down
const STICK_RADIUS = 56; // px the knob travels from the base
const AIM_DEADZONE = 0.3;

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
  private readonly parryBtn: HTMLDivElement;

  private moveStick: Stick | null = null;
  private aimStick: Stick | null = null;
  private shieldPointer: number | null = null;
  private parryPointer: number | null = null;

  private attached = false;
  private readonly mount: HTMLElement;

  constructor(mount: HTMLElement = document.body) {
    this.mount = mount;
    this.root = el("div", "tc-root");
    this.leftZone = el("div", "tc-zone tc-zone--left");
    this.rightZone = el("div", "tc-zone tc-zone--right");
    this.shieldBtn = el("div", "tc-btn tc-btn--shield");
    this.shieldBtn.textContent = "SHIELD";
    this.parryBtn = el("div", "tc-btn tc-btn--parry");
    this.parryBtn.textContent = "PARRY";
    this.root.append(this.leftZone, this.rightZone, this.shieldBtn, this.parryBtn);
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.mount.appendChild(this.root);
    // pointerdown per zone/button; move/up on window so a drag that leaves
    // the zone still tracks (thumbs wander).
    this.leftZone.addEventListener("pointerdown", this.onLeftDown, { passive: false });
    this.rightZone.addEventListener("pointerdown", this.onRightDown, { passive: false });
    this.shieldBtn.addEventListener("pointerdown", this.onShieldDown, { passive: false });
    this.parryBtn.addEventListener("pointerdown", this.onParryDown, { passive: false });
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
    let keys = 0;
    if (this.moveStick) {
      const { dx, dy } = this.moveStick;
      if (dx < -MOVE_DEADZONE) keys |= InputBit.Left;
      if (dx > MOVE_DEADZONE) keys |= InputBit.Right;
      if (dy < -JUMP_TILT) keys |= InputBit.Jump;
      if (dy > CROUCH_TILT) {
        keys |= InputBit.Down;
        keys |= InputBit.Crouch;
      }
    }
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
    if (this.parryPointer !== null) keys |= InputBit.Ability;
    return { keys, aimDir };
  }

  destroy(): void {
    this.leftZone.removeEventListener("pointerdown", this.onLeftDown);
    this.rightZone.removeEventListener("pointerdown", this.onRightDown);
    this.shieldBtn.removeEventListener("pointerdown", this.onShieldDown);
    this.parryBtn.removeEventListener("pointerdown", this.onParryDown);
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

  private onParryDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.parryPointer = e.pointerId;
    this.parryBtn.classList.add("tc-btn--active");
  };

  private onMove = (e: PointerEvent): void => {
    const stick =
      this.moveStick?.pointerId === e.pointerId
        ? this.moveStick
        : this.aimStick?.pointerId === e.pointerId
          ? this.aimStick
          : null;
    if (!stick) return;
    e.preventDefault();
    const rawX = e.clientX - stick.baseX;
    const rawY = e.clientY - stick.baseY;
    const dist = Math.hypot(rawX, rawY);
    const clamped = Math.min(dist, STICK_RADIUS);
    const ux = dist > 0 ? rawX / dist : 0;
    const uy = dist > 0 ? rawY / dist : 0;
    stick.dx = (ux * clamped) / STICK_RADIUS;
    stick.dy = (uy * clamped) / STICK_RADIUS;
    stick.knob.style.transform = `translate(${ux * clamped}px, ${uy * clamped}px)`;
  };

  private onUp = (e: PointerEvent): void => {
    if (this.moveStick?.pointerId === e.pointerId) {
      this.moveStick.base.remove();
      this.moveStick = null;
    }
    if (this.aimStick?.pointerId === e.pointerId) {
      this.aimStick.base.remove();
      this.aimStick = null;
    }
    if (this.shieldPointer === e.pointerId) {
      this.shieldPointer = null;
      this.shieldBtn.classList.remove("tc-btn--active");
    }
    if (this.parryPointer === e.pointerId) {
      this.parryPointer = null;
      this.parryBtn.classList.remove("tc-btn--active");
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
    this.moveStick = null;
    this.aimStick = null;
    this.shieldPointer = null;
    this.parryPointer = null;
    this.shieldBtn.classList.remove("tc-btn--active");
    this.parryBtn.classList.remove("tc-btn--active");
  }
}

function el(tag: string, className: string): HTMLDivElement {
  const d = document.createElement(tag) as HTMLDivElement;
  d.className = className;
  return d;
}
