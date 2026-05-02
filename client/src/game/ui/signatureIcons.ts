// Parametric "signature" icons — character/object glyphs for named top-tier cards.
//
// Each icon is drawn via Phaser Graphics positioned at (0, 0) local space.
// Callers must set the Graphics object's (x, y) before using.
//
// Convention: every drawIcon_* function draws ONE crisp glyph onto `g`.
// The caller handles glow separately (duplicate at 1.4× scale, additive blend).
//
// Size convention: `r` = half of the target bounding box (i.e. for an 80px icon, r = 40).

// `import type` keeps Phaser bundle out of Bun headless test runtime.
import type Phaser from "phaser";

/** Point literal — keeps polygon point arrays terse. Phaser Graphics accepts {x,y} at runtime;
 *  typed as Vector2 so fillPoints/strokePoints signatures are satisfied. */
function v(x: number, y: number): Phaser.Math.Vector2 {
  // Plain object satisfies Graphics at runtime; type cast for the type checker.
  return { x, y } as unknown as Phaser.Math.Vector2;
}

const LINE = 2.5;

// ─────────────────────────────────────────────────────────────────────────────
// FROST PRISM — snowflake creature (8 radial rays + 2 dot eyes + angry brow)
// element: ice (0x93c5fd)
// ─────────────────────────────────────────────────────────────────────────────
export function drawIcon_frostPrism(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.clear();
  const rayW = r * 0.09;
  const rayLen = r * 0.88;

  // 8 radial rays (snowflake spokes)
  g.fillStyle(fill, 1);
  g.lineStyle(LINE * 0.6, stroke, 1);
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 * i) / 8;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const perp = angle + Math.PI / 2;
    const pc = Math.cos(perp) * rayW;
    const ps = Math.sin(perp) * rayW;
    const pts: Phaser.Math.Vector2[] = [
      v(cos * r * 0.12 - pc, sin * r * 0.12 - ps),
      v(cos * rayLen - pc,   sin * rayLen - ps),
      v(cos * rayLen + pc,   sin * rayLen + ps),
      v(cos * r * 0.12 + pc, sin * r * 0.12 + ps),
    ];
    g.fillPoints(pts, true);
  }

  // Small cross-bar on each ray at mid-length
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 * i) / 8;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const perp = angle + Math.PI / 2;
    const mid = r * 0.52;
    const barW = r * 0.16;
    const barH = r * 0.055;
    const pc = Math.cos(perp) * barW;
    const ps = Math.sin(perp) * barW;
    const nc = cos * barH;
    const ns = sin * barH;
    const pts: Phaser.Math.Vector2[] = [
      v(cos * mid - pc - nc, sin * mid - ps - ns),
      v(cos * mid + pc - nc, sin * mid + ps - ns),
      v(cos * mid + pc + nc, sin * mid + ps + ns),
      v(cos * mid - pc + nc, sin * mid - ps + ns),
    ];
    g.fillPoints(pts, true);
  }

  // Center core
  g.fillCircle(0, 0, r * 0.18);

  // Eyes — slightly right/left of center, 1/4 up
  const eyeR = r * 0.075;
  const eyeX = r * 0.2;
  const eyeY = -r * 0.15;
  g.fillStyle(stroke, 1);
  g.fillCircle(-eyeX, eyeY, eyeR);
  g.fillCircle( eyeX, eyeY, eyeR);

  // Angry brow — angled line above eyes
  g.lineStyle(LINE * 1.1, stroke, 1);
  g.strokePoints([v(-eyeX - r * 0.14, eyeY - r * 0.14), v(-eyeX + r * 0.12, eyeY - r * 0.06)]);
  g.strokePoints([v( eyeX + r * 0.14, eyeY - r * 0.14), v( eyeX - r * 0.12, eyeY - r * 0.06)]);
}

// ─────────────────────────────────────────────────────────────────────────────
// MOLTEN CORE — flame-petal creature (4 arc petals + inner core + eyes + drips)
// element: fire (0xff7a18)
// ─────────────────────────────────────────────────────────────────────────────
export function drawIcon_moltenCore(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.clear();

  // 4 outer flame petals (elongated ellipse-like polygons at ±45°)
  const petalAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  g.fillStyle(fill, 0.85);
  for (const angle of petalAngles) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const perp = angle + Math.PI / 2;
    const pc = Math.cos(perp);
    const ps = Math.sin(perp);
    const tip = r * 0.9;
    const base = r * 0.26;
    const petalW = r * 0.28;
    const pts: Phaser.Math.Vector2[] = [
      v(cos * base - pc * petalW, sin * base - ps * petalW),
      v(cos * (tip * 0.45) - pc * petalW * 1.15, sin * (tip * 0.45) - ps * petalW * 1.15),
      v(cos * tip,                 sin * tip),
      v(cos * (tip * 0.45) + pc * petalW * 1.15, sin * (tip * 0.45) + ps * petalW * 1.15),
      v(cos * base + pc * petalW, sin * base + ps * petalW),
    ];
    g.fillPoints(pts, true);
    g.lineStyle(LINE * 0.6, stroke, 0.9);
    g.strokePoints(pts, true);
  }

  // 4 diagonal accent petals, smaller and offset
  const accentAngles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  g.fillStyle(stroke, 0.7);
  for (const angle of accentAngles) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const perp = angle + Math.PI / 2;
    const pc = Math.cos(perp);
    const ps = Math.sin(perp);
    const tip = r * 0.62;
    const base = r * 0.22;
    const petalW = r * 0.16;
    const pts: Phaser.Math.Vector2[] = [
      v(cos * base - pc * petalW, sin * base - ps * petalW),
      v(cos * tip, sin * tip),
      v(cos * base + pc * petalW, sin * base + ps * petalW),
    ];
    g.fillPoints(pts, true);
  }

  // Inner core circle
  g.fillStyle(0xffd580, 1);
  g.fillCircle(0, 0, r * 0.3);
  g.fillStyle(fill, 1);
  g.fillCircle(0, 0, r * 0.22);

  // Eyes
  const eyeR = r * 0.07;
  const eyeX = r * 0.13;
  const eyeY = -r * 0.06;
  g.fillStyle(stroke, 1);
  g.fillCircle(-eyeX, eyeY, eyeR);
  g.fillCircle( eyeX, eyeY, eyeR);

  // Drip droplets below
  g.fillStyle(fill, 0.9);
  g.fillCircle(-r * 0.18, r * 0.48, r * 0.065);
  g.fillCircle( r * 0.1,  r * 0.58, r * 0.05);
  // Short stem above each drip
  g.lineStyle(LINE * 0.7, fill, 0.7);
  g.strokePoints([v(-r * 0.18, r * 0.38), v(-r * 0.18, r * 0.42)]);
  g.strokePoints([v( r * 0.1,  r * 0.47), v( r * 0.1,  r * 0.51)]);
}

// ─────────────────────────────────────────────────────────────────────────────
// VOLTAIC SPARK — lightning-ghost (zig-zag bolt + 2 dot eyes at bend + spark dots)
// element: lightning (0xfef08a)
// ─────────────────────────────────────────────────────────────────────────────
export function drawIcon_voltaicSpark(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.clear();

  // Lightning bolt zig-zag polygon (5-point)
  const boltW = r * 0.22;
  const boltThin = r * 0.1;
  const pts: Phaser.Math.Vector2[] = [
    v( r * 0.12, -r * 0.88),
    v(-r * 0.28, -r * 0.06),
    v( r * 0.18, -r * 0.06),
    v(-r * 0.14,  r * 0.88),
    v( r * 0.4,  -r * 0.02),
    v(-r * 0.04, -r * 0.02),
  ];
  // Compute thick polygon from center-line
  const topPts: Phaser.Math.Vector2[] = [
    v( r * 0.12 + boltW * 0.5,  -r * 0.88),
    v( r * 0.12 - boltW * 0.5,  -r * 0.88),
    v(-r * 0.28 - boltThin,     -r * 0.06),
    v( r * 0.18 - boltThin,     -r * 0.06),
    v(-r * 0.14 - boltW * 0.4,   r * 0.88),
    v(-r * 0.14 + boltW * 0.4,   r * 0.88),
    v( r * 0.4  + boltThin,     -r * 0.02),
    v(-r * 0.04 + boltThin,     -r * 0.02),
  ];
  void pts; // drawn via topPts polygon

  g.fillStyle(fill, 1);
  g.lineStyle(LINE * 0.8, stroke, 1);
  g.fillPoints(topPts, true);
  g.strokePoints(topPts, true);

  // Eyes at the bend (around y = -0.06 on the inner notch)
  const eyeR = r * 0.075;
  g.fillStyle(stroke, 1);
  g.fillCircle(-r * 0.02, -r * 0.22, eyeR);
  g.fillCircle( r * 0.22, -r * 0.22, eyeR);

  // 4 spark dots at endpoints/tips
  g.fillStyle(fill, 0.85);
  const sparkR = r * 0.055;
  g.fillCircle( r * 0.12,  -r * 0.94, sparkR);
  g.fillCircle(-r * 0.14,   r * 0.94, sparkR);
  g.fillCircle(-r * 0.36,  -r * 0.12, sparkR);
  g.fillCircle( r * 0.48,  -r * 0.06, sparkR);
}

// ─────────────────────────────────────────────────────────────────────────────
// VOID FRACTURE — crack-eye (jagged polygon + angled diamond pupil)
// element: void (0xa78bfa)
// ─────────────────────────────────────────────────────────────────────────────
export function drawIcon_voidFracture(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.clear();

  // Outer jagged crack shape (7 irregular points)
  const crackPts: Phaser.Math.Vector2[] = [
    v( r * 0.0,  -r * 0.92),
    v( r * 0.44, -r * 0.32),
    v( r * 0.88,  r * 0.14),
    v( r * 0.22,  r * 0.58),
    v( r * 0.06,  r * 0.92),
    v(-r * 0.48,  r * 0.32),
    v(-r * 0.88, -r * 0.18),
    v(-r * 0.36, -r * 0.5),
  ];
  g.fillStyle(fill, 1);
  g.lineStyle(LINE, stroke, 1);
  g.fillPoints(crackPts, true);
  g.strokePoints(crackPts, true);

  // Inner crack lines — sense of fracture
  g.lineStyle(LINE * 0.8, 0x1a0a3a, 0.9);
  g.strokePoints([v(r * 0.0, -r * 0.6), v(r * 0.22, -r * 0.1), v(-r * 0.1, r * 0.3)]);
  g.strokePoints([v(-r * 0.3, -r * 0.1), v(r * 0.35, r * 0.18)]);

  // Angled diamond pupil in the center
  const pr = r * 0.25;
  const pupilPts: Phaser.Math.Vector2[] = [
    v( 0,        -pr * 0.7),
    v( pr * 0.55, 0),
    v( 0,         pr * 0.7),
    v(-pr * 0.55, 0),
  ];
  g.fillStyle(0x120820, 1);
  g.fillPoints(pupilPts, true);
  // Iris ring
  g.lineStyle(LINE * 0.9, stroke, 0.9);
  g.strokePoints(pupilPts, true);
  // Slit highlight
  g.lineStyle(LINE * 0.5, 0xffffff, 0.35);
  g.strokePoints([v(0, -pr * 0.4), v(0, pr * 0.4)]);
}

// ─────────────────────────────────────────────────────────────────────────────
// RADIANT OVERLOAD — smug sun (8 rays + center circle + closed-arc eyes + smile)
// element: radiant (0xfff7d6)
// ─────────────────────────────────────────────────────────────────────────────
export function drawIcon_radiantOverload(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.clear();

  // 8 thin rays
  const rayW = r * 0.07;
  const rayLen = r * 0.9;
  g.fillStyle(fill, 1);
  g.lineStyle(LINE * 0.5, stroke, 1);
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 * i) / 8;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const perp = angle + Math.PI / 2;
    const pc = Math.cos(perp) * rayW;
    const ps = Math.sin(perp) * rayW;
    const pts: Phaser.Math.Vector2[] = [
      v(cos * r * 0.35 - pc, sin * r * 0.35 - ps),
      v(cos * rayLen - pc,   sin * rayLen - ps),
      v(cos * rayLen + pc,   sin * rayLen + ps),
      v(cos * r * 0.35 + pc, sin * r * 0.35 + ps),
    ];
    g.fillPoints(pts, true);
  }

  // Center body circle
  g.fillStyle(fill, 1);
  g.lineStyle(LINE, stroke, 1);
  g.fillCircle(0, 0, r * 0.36);
  g.strokeCircle(0, 0, r * 0.36);

  // Smug closed-arc eyes (half-circle arcs — simulated with small filled ellipses)
  g.fillStyle(stroke, 1);
  // Left eye — slightly tilted upward (small rotated rect for closed-eye effect)
  const eyeW = r * 0.1;
  const eyeH = r * 0.035;
  const eyeX = r * 0.12;
  const eyeY = -r * 0.06;
  // Simulate arc with a flat rectangle (smug closed eyes)
  g.fillRect(-eyeX - eyeW, eyeY - eyeH, eyeW * 2, eyeH * 2);
  g.fillRect( eyeX - eyeW, eyeY - eyeH, eyeW * 2, eyeH * 2);

  // Smug smile arc — approximated as a curved polygon
  const smileY = r * 0.1;
  const smileW = r * 0.16;
  const smileH = r * 0.06;
  const smilePts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const sx = -smileW + smileW * 2 * t;
    const sy = smileY + smileH * Math.sin(t * Math.PI) * (-1) + smileH;
    smilePts.push(v(sx, sy));
  }
  g.lineStyle(LINE * 1.1, stroke, 1);
  g.strokePoints(smilePts, false);
}

// ─────────────────────────────────────────────────────────────────────────────
// CATACLYSMIC PRISM — nova burst (large starburst + inner ring + shocked-face)
// element: radiant (0xffffff)
// ─────────────────────────────────────────────────────────────────────────────
export function drawIcon_cataclysmicPrism(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.clear();

  // 12 alternating long/short spikes
  g.fillStyle(fill, 1);
  for (let i = 0; i < 12; i++) {
    const angle = (Math.PI * 2 * i) / 12;
    const isLong = i % 2 === 0;
    const tipR = isLong ? r * 0.92 : r * 0.58;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const perp = angle + Math.PI / 2;
    const w = isLong ? r * 0.07 : r * 0.055;
    const pc = Math.cos(perp) * w;
    const ps = Math.sin(perp) * w;
    const pts: Phaser.Math.Vector2[] = [
      v(cos * r * 0.2 - pc, sin * r * 0.2 - ps),
      v(cos * tipR,          sin * tipR),
      v(cos * r * 0.2 + pc, sin * r * 0.2 + ps),
    ];
    g.fillPoints(pts, true);
  }

  // Outer ring
  g.lineStyle(LINE, stroke, 1);
  g.strokeCircle(0, 0, r * 0.34);
  g.fillStyle(fill, 1);
  g.fillCircle(0, 0, r * 0.32);

  // Shocked-face: wide round eyes + small open mouth circle
  const eyeR = r * 0.07;
  g.fillStyle(0x1a1a2e, 1);
  g.fillCircle(-r * 0.13, -r * 0.07, eyeR);
  g.fillCircle( r * 0.13, -r * 0.07, eyeR);
  g.fillCircle(0, r * 0.1, r * 0.055); // open mouth
}

// ─────────────────────────────────────────────────────────────────────────────
// HOMING CLUSTER — three curved shards with homing tails
// element: neutral-purple (0xf0abfc)
// ─────────────────────────────────────────────────────────────────────────────
export function drawIcon_homingCluster(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.clear();

  const shardData: Array<{ ox: number; oy: number; angle: number }> = [
    { ox: 0,        oy: -r * 0.4,  angle: 0 },
    { ox: -r * 0.36, oy:  r * 0.2,  angle: -Math.PI / 5 },
    { ox:  r * 0.36, oy:  r * 0.2,  angle:  Math.PI / 5 },
  ];

  for (const { ox, oy, angle } of shardData) {
    const cos = Math.cos(angle - Math.PI / 2);
    const sin = Math.sin(angle - Math.PI / 2);
    const perp = angle + Math.PI;
    const pc = Math.cos(perp) * r * 0.1;
    const ps = Math.sin(perp) * r * 0.1;
    const len = r * 0.36;

    const pts: Phaser.Math.Vector2[] = [
      v(ox + cos * len,       oy + sin * len),
      v(ox + pc - cos * len * 0.5, oy + ps - sin * len * 0.5),
      v(ox - pc - cos * len * 0.5, oy - ps - sin * len * 0.5),
    ];
    g.fillStyle(fill, 1);
    g.lineStyle(LINE * 0.7, stroke, 1);
    g.fillPoints(pts, true);
    g.strokePoints(pts, true);

    // Homing tail arc (3 dots fading behind each shard)
    for (let d = 1; d <= 3; d++) {
      const tailX = ox - cos * len * 0.35 * d;
      const tailY = oy - sin * len * 0.35 * d;
      g.fillStyle(fill, (4 - d) / 6);
      g.fillCircle(tailX, tailY, r * 0.04 * (4 - d));
    }
  }

  // Central eye
  g.fillStyle(stroke, 0.9);
  g.fillCircle(0, 0, r * 0.085);
  g.fillStyle(0x1a0a2e, 1);
  g.fillCircle(0, 0, r * 0.05);
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERCHARGE — swollen orb with corona lines and glowing slit eye
// element: neutral (0xf0abfc)
// ─────────────────────────────────────────────────────────────────────────────
export function drawIcon_overcharge(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.clear();

  // Outer energy halo
  g.fillStyle(fill, 0.18);
  g.fillCircle(0, 0, r * 0.95);

  // 6 short energy discharge lines
  g.lineStyle(LINE * 1.2, fill, 0.8);
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 * i) / 6;
    const inner = r * 0.62;
    const outer = r * 0.88 + (i % 2 === 0 ? r * 0.08 : 0);
    g.strokePoints([
      v(Math.cos(angle) * inner, Math.sin(angle) * inner),
      v(Math.cos(angle) * outer, Math.sin(angle) * outer),
    ]);
  }

  // Main body
  g.fillStyle(fill, 1);
  g.lineStyle(LINE, stroke, 1);
  g.fillCircle(0, 0, r * 0.58);
  g.strokeCircle(0, 0, r * 0.58);

  // Charging glow inner circle
  g.fillStyle(0xffffff, 0.35);
  g.fillCircle(0, 0, r * 0.32);

  // Slit eye (danger charge indicator)
  const pupilPts: Phaser.Math.Vector2[] = [
    v(-r * 0.18,  0),
    v( 0,        -r * 0.1),
    v( r * 0.18,  0),
    v( 0,         r * 0.1),
  ];
  g.fillStyle(0x1a0a2e, 1);
  g.fillPoints(pupilPts, true);
  g.lineStyle(LINE * 0.6, stroke, 0.7);
  g.strokePoints(pupilPts, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// MIRROR SHIELD — hexagon shield with reflected bolt + face
// element: crystal (0x50e3c2 / bae6fd)
// ─────────────────────────────────────────────────────────────────────────────
export function drawIcon_mirrorShield(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.clear();

  // Shield hexagon body
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 * i) / 6 - Math.PI / 6;
    pts.push(v(Math.cos(angle) * r * 0.88, Math.sin(angle) * r * 0.88));
  }
  g.fillStyle(fill, 1);
  g.lineStyle(LINE * 1.1, stroke, 1);
  g.fillPoints(pts, true);
  g.strokePoints(pts, true);

  // Inner specular line (mirror sheen)
  g.lineStyle(LINE * 0.7, 0xffffff, 0.45);
  g.strokePoints([v(-r * 0.3, -r * 0.55), v( r * 0.1, -r * 0.18)]);

  // Reflected bolt — small arrow bouncing
  g.fillStyle(0xfef08a, 1);
  g.lineStyle(LINE * 0.5, 0xf0a500, 1);
  const boltPts: Phaser.Math.Vector2[] = [
    v(-r * 0.28,  r * 0.12),
    v( r * 0.06, -r * 0.22),
    v( r * 0.18, -r * 0.02),
    v( r * 0.28,  r * 0.22),
    v(-r * 0.02, -r * 0.02),
    v(-r * 0.18,  r * 0.28),
  ];
  g.fillPoints(boltPts, true);
  g.strokePoints(boltPts, true);

  // Two dot eyes on shield face
  g.fillStyle(stroke, 1);
  g.fillCircle(-r * 0.16, r * 0.1, r * 0.065);
  g.fillCircle( r * 0.16, r * 0.1, r * 0.065);
}

// ─────────────────────────────────────────────────────────────────────────────
// PIERCE CHAIN — arrow head with chain links trailing behind
// element: void/pink (0xe879f9)
// ─────────────────────────────────────────────────────────────────────────────
export function drawIcon_pierceChain(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.clear();

  // Arrow head (pointing right)
  const arrowPts: Phaser.Math.Vector2[] = [
    v( r * 0.88, 0),
    v( r * 0.32, -r * 0.42),
    v( r * 0.32, -r * 0.18),
    v(-r * 0.7,  -r * 0.18),
    v(-r * 0.7,   r * 0.18),
    v( r * 0.32,  r * 0.18),
    v( r * 0.32,  r * 0.42),
  ];
  g.fillStyle(fill, 1);
  g.lineStyle(LINE, stroke, 1);
  g.fillPoints(arrowPts, true);
  g.strokePoints(arrowPts, true);

  // Chain link dots trailing the arrow tail
  for (let i = 0; i < 3; i++) {
    const lx = -r * 0.82 - i * r * 0.14;
    g.fillStyle(stroke, 0.8 - i * 0.2);
    g.fillCircle(lx, 0, r * 0.09 - i * r * 0.015);
    // Link connector
    if (i < 2) {
      g.lineStyle(LINE * 0.6, stroke, 0.6 - i * 0.15);
      g.strokePoints([v(lx - r * 0.09, 0), v(lx - r * 0.16, 0)]);
    }
  }

  // Impact eye near arrowhead
  g.fillStyle(0x1a0a2e, 1);
  g.fillCircle(r * 0.52, 0, r * 0.065);
  g.lineStyle(LINE * 0.6, stroke, 0.8);
  g.strokeCircle(r * 0.52, 0, r * 0.065);
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARD BLOOM — central orb exploding outward (radial blast + eyes)
// element: void-purple (0xc084fc)
// ─────────────────────────────────────────────────────────────────────────────
export function drawIcon_shardBloom(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.clear();

  // 6 outward shards at varied angles
  const shardAngles = [0, Math.PI / 3, (2 * Math.PI) / 3, Math.PI, (4 * Math.PI) / 3, (5 * Math.PI) / 3];
  g.fillStyle(fill, 0.9);
  g.lineStyle(LINE * 0.6, stroke, 0.8);
  for (let i = 0; i < shardAngles.length; i++) {
    const angle = shardAngles[i]!;
    const length = r * (0.65 + (i % 3) * 0.12);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const perp = angle + Math.PI / 2;
    const pc = Math.cos(perp) * r * 0.08;
    const ps = Math.sin(perp) * r * 0.08;
    const pts: Phaser.Math.Vector2[] = [
      v(cos * r * 0.2 - pc, sin * r * 0.2 - ps),
      v(cos * length,        sin * length),
      v(cos * r * 0.2 + pc, sin * r * 0.2 + ps),
    ];
    g.fillPoints(pts, true);
    g.strokePoints(pts, true);
  }

  // Central orb
  g.fillStyle(fill, 1);
  g.lineStyle(LINE, stroke, 1);
  g.fillCircle(0, 0, r * 0.28);
  g.strokeCircle(0, 0, r * 0.28);

  // Eyes
  const eyeR = r * 0.06;
  g.fillStyle(stroke, 1);
  g.fillCircle(-r * 0.1, -r * 0.05, eyeR);
  g.fillCircle( r * 0.1, -r * 0.05, eyeR);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLUSTER BOMB — 3 staggered bomb circles with fuses + sparks
// element: explosive-red (0xfb7185 / or orange)
// ─────────────────────────────────────────────────────────────────────────────
export function drawIcon_clusterBomb(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.clear();

  const bombs: Array<{ x: number; y: number; br: number }> = [
    { x: -r * 0.32, y:  r * 0.2,  br: r * 0.26 },
    { x:  r * 0.32, y:  r * 0.2,  br: r * 0.24 },
    { x:  r * 0.02, y: -r * 0.22, br: r * 0.28 },
  ];

  for (const { x, y, br } of bombs) {
    // Bomb body
    g.fillStyle(0x2d2d2d, 1);
    g.lineStyle(LINE, stroke, 1);
    g.fillCircle(x, y, br);
    g.strokeCircle(x, y, br);

    // Shine
    g.fillStyle(0x888888, 0.35);
    g.fillCircle(x - br * 0.3, y - br * 0.35, br * 0.3);

    // Fuse line from top
    g.lineStyle(LINE * 0.8, 0x8b6914, 1);
    g.strokePoints([v(x, y - br), v(x + br * 0.4, y - br * 1.5)]);

    // Spark at top of fuse
    g.fillStyle(fill, 1);
    g.fillCircle(x + br * 0.4, y - br * 1.52, r * 0.048);
    g.fillStyle(0xfef08a, 0.8);
    g.fillCircle(x + br * 0.4, y - br * 1.52, r * 0.026);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SEEKER FACETS — a faceted eye with curving trails (homing, stylised)
// element: void-pink (0xf0abfc)
// ─────────────────────────────────────────────────────────────────────────────
export function drawIcon_seekerFacets(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.clear();

  // Diamond-facet outer shape
  const outerPts: Phaser.Math.Vector2[] = [
    v( 0,        -r * 0.9),
    v( r * 0.52, -r * 0.28),
    v( r * 0.9,   r * 0.1),
    v( r * 0.36,  r * 0.78),
    v( 0,         r * 0.9),
    v(-r * 0.36,  r * 0.78),
    v(-r * 0.9,   r * 0.1),
    v(-r * 0.52, -r * 0.28),
  ];
  g.fillStyle(fill, 1);
  g.lineStyle(LINE, stroke, 1);
  g.fillPoints(outerPts, true);
  g.strokePoints(outerPts, true);

  // Facet lines
  g.lineStyle(LINE * 0.5, 0xffffff, 0.3);
  g.strokePoints([v(0, -r * 0.9), v(0, r * 0.9)]);
  g.strokePoints([v(-r * 0.9, r * 0.1), v(r * 0.9, r * 0.1)]);

  // Central eye
  const eyePts: Phaser.Math.Vector2[] = [
    v(-r * 0.28, 0),
    v(0,         -r * 0.18),
    v( r * 0.28, 0),
    v(0,          r * 0.18),
  ];
  g.fillStyle(0x1a0a2e, 1);
  g.fillPoints(eyePts, true);
  g.lineStyle(LINE * 0.8, stroke, 0.9);
  g.strokePoints(eyePts, true);
  // Pupil glint
  g.fillStyle(fill, 0.7);
  g.fillCircle(r * 0.08, -r * 0.06, r * 0.055);

  // Curved homing trail arcs (3 sweeping lines on one side)
  g.lineStyle(LINE * 0.7, fill, 0.55);
  for (let i = 0; i < 3; i++) {
    const trailPts: Phaser.Math.Vector2[] = [];
    for (let t = 0; t <= 6; t++) {
      const progress = t / 6;
      const tx = r * 1.05 + i * r * 0.18 + progress * r * 0.3;
      const ty = -r * 0.28 + progress * r * 0.56;
      trailPts.push(v(tx, ty));
    }
    g.strokePoints(trailPts, false);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STICKY RAY — ray beam with sticky blobs along it + one-eyed face
// element: crystal (0x99f6e4)
// ─────────────────────────────────────────────────────────────────────────────
export function drawIcon_stickyRay(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.clear();

  // Horizontal beam rectangle
  g.fillStyle(fill, 0.9);
  g.lineStyle(LINE * 0.7, stroke, 1);
  g.fillRect(-r * 0.88, -r * 0.12, r * 1.76, r * 0.24);
  g.strokeRect(-r * 0.88, -r * 0.12, r * 1.76, r * 0.24);

  // Beam inner glow
  g.fillStyle(0xffffff, 0.35);
  g.fillRect(-r * 0.88, -r * 0.04, r * 1.76, r * 0.08);

  // 3 sticky blobs on the beam
  const blobPositions = [-r * 0.48, r * 0.04, r * 0.56];
  for (const bx of blobPositions) {
    g.fillStyle(stroke, 0.9);
    g.fillCircle(bx, r * 0.28, r * 0.14);
    g.lineStyle(LINE * 0.5, fill, 0.7);
    g.strokeCircle(bx, r * 0.28, r * 0.14);
    // Drip connecting blob to beam
    g.lineStyle(LINE * 0.8, stroke, 0.7);
    g.strokePoints([v(bx, r * 0.12), v(bx, r * 0.14)]);
  }

  // One large eye on the beam origin side
  g.fillStyle(0x1a2e2e, 1);
  g.fillCircle(-r * 0.78, 0, r * 0.12);
  g.lineStyle(LINE * 0.7, fill, 0.9);
  g.strokeCircle(-r * 0.78, 0, r * 0.12);
  g.fillStyle(fill, 0.7);
  g.fillCircle(-r * 0.74, -r * 0.04, r * 0.055);
}

// ─────────────────────────────────────────────────────────────────────────────
// ORBY BLAP BLAP — two large orbs side by side with surprised eyes
// element: purple (0xf0abfc)
// ─────────────────────────────────────────────────────────────────────────────
export function drawIcon_orbyBlapBlap(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.clear();

  const orbs: Array<{ x: number; y: number; br: number }> = [
    { x: -r * 0.36, y: 0, br: r * 0.42 },
    { x:  r * 0.36, y: 0, br: r * 0.38 },
  ];

  for (const { x, y, br } of orbs) {
    g.fillStyle(fill, 1);
    g.lineStyle(LINE, stroke, 1);
    g.fillCircle(x, y, br);
    g.strokeCircle(x, y, br);

    // Shine
    g.fillStyle(0xffffff, 0.28);
    g.fillCircle(x - br * 0.32, y - br * 0.32, br * 0.32);

    // Surprised dot eye
    g.fillStyle(stroke, 1);
    g.fillCircle(x + br * 0.12, y - br * 0.12, br * 0.16);
    g.fillStyle(0x1a0a2e, 1);
    g.fillCircle(x + br * 0.14, y - br * 0.1, br * 0.08);

    // Small O-mouth
    g.lineStyle(LINE * 0.7, stroke, 1);
    g.strokeCircle(x + br * 0.04, y + br * 0.26, br * 0.1);
  }
}
