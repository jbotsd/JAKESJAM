// Floating damage-number popup — extracted from OnlineMatchScene's own
// `spawnDamageNumber` (2026-07-19, venue-lobby ability showcase: HangoutScene
// needed the exact same visual language for dummy/ally-NPC hits, and a
// destructible-position variant besides — one implementation, two call
// sites, rather than a second hand-copied tween chain drifting from the
// original). Byte-identical tiers/color/scale/timing to the original;
// callers resolve WHERE the number spawns (player rig lookup vs a
// destructible's own x/y) and pass the resolved point in.

import type Phaser from "phaser";

export type DamageNumberOptions = {
  /** True when this hit landed in the victim's head zone — distinct color
   *  + label + a notch-bigger spawn scale. Never true for a destructible
   *  hit (no headshot concept there). */
  headshot?: boolean;
  /** True when the victim is the local player — distinct (rose) color so
   *  "I'm taking damage" reads apart from "I'm dealing damage." Never true
   *  for a destructible hit (no team-relative read for furniture). */
  isLocal?: boolean;
};

/**
 * Float a damage number at an explicit world point. Caller owns the
 * damage-floor guard (`damage < 1` skip) and the "is the victim even alive/
 * present" check — this function only ever renders what it's handed.
 */
export function spawnFloatingDamageNumber(
  scene: Phaser.Scene,
  x: number,
  y: number,
  damage: number,
  opts: DamageNumberOptions = {},
): void {
  const { headshot = false, isLocal = false } = opts;
  const spread = (Math.random() - 0.5) * 22;

  // Damage tiers: light <15, medium 15–29, heavy 30+.
  // Per game-feel-juice/SKILL.md: bigger impacts need bigger reactions.
  const isHeavy = damage >= 30;
  const isMedium = damage >= 15;
  const fontSize = isHeavy ? "22px" : isMedium ? "17px" : "13px";
  // Overshoot scale: punch in at 1.4× then settle to 1.0 (Nijman's "tweened spawning").
  // Headshot reads a notch bigger than a same-tier body shot — the slight
  // damage boon (player.ts's HEADSHOT_DAMAGE_MULTIPLIER) should also FEEL
  // distinct, not just tally differently.
  const spawnScale = (isHeavy ? 1.6 : isMedium ? 1.35 : 1.2) * (headshot ? 1.15 : 1);
  // Headshot: Instrument Ink gold (PALETTE.hullGold) — the game's own
  // established "something special" accent (kill-pulse, share-page
  // highlights), not a new colour invented for this one case.
  const color = headshot ? "#897f69" : isLocal ? "#fb7185" : isHeavy ? "#ffffff" : "#fff7d6";
  const label = headshot ? `${Math.round(damage)} HEADSHOT` : Math.round(damage).toString();

  const text = scene.add
    .text(x + spread, y - 36, label, {
      color,
      fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
      fontSize,
      fontStyle: "900",
      stroke: "#05080f",
      strokeThickness: isHeavy ? 4 : 3,
    })
    .setOrigin(0.5, 1)
    .setDepth(800)
    .setScale(spawnScale);

  // Two-phase: overshoot pop (Back.easeOut) then float-up + fade.
  scene.tweens.add({
    targets: text,
    scaleX: 1,
    scaleY: 1,
    duration: 120,
    ease: "Back.easeOut",
    onComplete: () => {
      scene.tweens.add({
        targets: text,
        y: text.y - (isHeavy ? 44 : 28),
        alpha: 0,
        duration: isHeavy ? 700 : 560,
        ease: "Sine.easeOut",
        onComplete: () => text.destroy(),
      });
    },
  });
}
