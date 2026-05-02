name: game-color-dynamics
description: >
  Dynamic color rendering, power/energy-to-color mapping, gradient interpolation,
  energy-level visualization. Use when editing client/src/game/ui/palette.ts or
  when implementing dynamic power/energy effects that visualize as color/brightness changes.
version: 1.0.0
---

# Dynamic Color & Power Visualization

## The Hard Line

**Brightness = Power (70% → 100%).** Not just color, but intensity shows power.

## Energy-Based Color Mapping

```ts
type PowerLevel = {
  min: 0.5;  // Minimum power
  max: 1.2;  // Full power
};

function powerToAlpha(power: number, minPower: number, maxPower: number) {
  const ratio = Math.max(0, Math.min(1, (power - minPower) / (maxPower - minPower)));
  return 0.2 + ratio * 0.8;  // 0.2 → 1.0
}

function powerToColor(power: number, elementColor: number) {
  const ratio = power / 1.2;
  const bright = 0xffffff;
  const muted = elementColor;
  return Phaser.Display.Color.RGBMix(bright, muted, Math.min(0.7, ratio));
}
```

## Dynamic Brightness Ramp

```ts
class PowerAwareGlow {
  private glow: Phaser.GameObjects.Image;
  private power: number = 0.5;
  private lastPower = 0.5;
  private targetAlpha: number = 0.2;

  update(deltaMs: number, power: number, glow: Phaser.GameObjects.Image, min: number, max: number) {
    // Smooth power transition
    this.targetAlpha = 0.2 + ((power - min) / (max - min)) * 0.8;
    this.glow.alpha = Phaser.Math.lerp(this.glow.alpha, this.targetAlpha, 0.15);
    
    // Width scales with power
    glow.width = 4 + ((power - min) / (max - min)) * 4;  // 4 → 8
    glow.height = glow.width;
    
    // Pulse at power peaks
    if (power > 0.9) {
      scene.tweens.add({
        targets: glow,
        scaleX: 1, scaleY: 1,
        duration: 150,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
        onComplete: () => {
          // Auto-restart pulse
        },
      });
    } else {
      glow.setScale(1, 1);
    }
    
    this.lastPower = power;
    glow.update(deltaMs);
  }
}
```

## Multi-Element Color System

```ts
// Element colors with power-aware tinting:
const ELEMENT_PALETTE = {
  [Element.PLASMA]: { base: 0x8ff8ff, high: 0xffffff, low: 0x4dd6d6 },
  [Element.THERMAL]: { base: 0xf6a623, high: 0xffcc33, low: 0x995e00 },
  [Element.VOID]: { base: 0xa78bfa, high: 0xd0bfff, low: 0x5e4da8 },
} as const;

function tintColor(color: number, ratio: number) {
  const bright = 0xffffff;
  const muted = ELEMENT_PALETTE[color as keyof typeof ELEMENT_PALETTE].low || 0x4dd6d6;
  return Phaser.Display.Color.RGBMix(bright, muted, Math.min(0.7, ratio));
}
```

## Pre-Flight Checklist

- [x] Alpha ramps 0.2 → 1.0 (not instant)
- [x] Width 4px → 8px with power
- [x] Smooth lerp 0.15 per frame
- [x] Pulse on high power
- [x] Element-specific palettes

---

## Usage Flow

```ts
// 1. Create particle on impact
onImpact(x, y, power: number) {
  this.particles.burstAt(x, y, {
    layers: ['core', 'glow_ring', 'spark', 'smoke'],
    elementColor: victim.weapon.element,
    rotation: true,
  });
}

// 2. Power-aware glow ring
const glowRing = new PowerAwareGlow(this.scene, 'glow_ring_circle');
glowRing.update(deltaMs, x, y, 0.5, 1.2);
```
