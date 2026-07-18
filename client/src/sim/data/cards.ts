// Card definitions. Pure data. Lives in sim/ so the authoritative server and
// the prediction client resolve identical builds from the same card hand.
//
// IMPORTANT: do not import from Phaser, the DOM, Convex, or client/src/game/.
// This module must compile inside the Bun runtime.

import type { CardDefinition } from "./cardTypes.js";
import type { ProjectileShape } from "../types.js";

function visual(iconShape: ProjectileShape, glowColor: string): CardDefinition["visual"] {
  return {
    iconShape,
    glowColor,
    particleColor: glowColor,
  };
}

const degrees = (value: number) => (value * Math.PI) / 180;

export const crystalRoundsCards: CardDefinition[] = [
  {
    id: "raycast-prism",
    name: "Raycast Prism",
    category: "weapon",
    rarity: "rare",
    buckets: ["delivery"],
    essenceCost: 4,
    description: "Hitscan beam: no travel time. Slightly less damage, softer kick — pure aim reward.",
    flavorText: "Light does not wait for permission.",
    modifier: {
      delivery: "raycast",
      damageMultiplier: 0.9,
      recoilMultiplier: 0.8,
      projectile: { rangePx: 880, impactRadiusPx: 12 },
    },
    visual: visual("triangle", "#8ff8ff"),
    unique: true,
  },
  {
    // Was a pure-identity pick (zero stat change) — a wasted slot in every
    // offer it appeared in. Given a small, real edge (still the cheapest
    // card in the game) so "keep it simple" is an honest choice, not a trap.
    id: "crystal-volley",
    name: "Crystal Volley",
    category: "weapon",
    rarity: "common",
    buckets: ["delivery"],
    essenceCost: 1,
    description: "Tighter, faster baseline shot. The clean default when you want honest gunplay.",
    flavorText: "One shard. No excuses.",
    modifier: {
      delivery: "projectile",
      projectile: { shape: "hexagon", count: 1, speedMultiplier: 1.06 },
      damageMultiplier: 1.06,
    },
    visual: visual("hexagon", "#50e3c2"),
    unique: true,
  },
  {
    id: "circle-rounds",
    name: "Circle Rounds",
    category: "projectile",
    rarity: "common",
    buckets: ["shape"],
    essenceCost: 1,
    description: "Round shots fly faster and sit a touch smaller — easy to read, hard to miss.",
    flavorText: "The simplest shape still kills.",
    modifier: {
      projectileSpeedMultiplier: 1.08,
      projectile: { shape: "circle", sizeMultiplier: 0.92 },
    },
    visual: visual("circle", "#5eead4"),
    unique: true,
  },
  {
    id: "triangle-rounds",
    name: "Triangle Rounds",
    category: "projectile",
    rarity: "common",
    buckets: ["shape"],
    essenceCost: 1,
    description: "Pointy crystals hit harder. More damage, more recoil — lean into the kick.",
    flavorText: "Three edges. One purpose.",
    modifier: {
      damageMultiplier: 1.12,
      recoilMultiplier: 1.14,
      projectile: { shape: "triangle", sizeMultiplier: 1.02 },
    },
    visual: visual("triangle", "#fef08a"),
    unique: true,
  },
  {
    id: "square-rounds",
    name: "Square Rounds",
    category: "projectile",
    rarity: "uncommon",
    buckets: ["shape"],
    essenceCost: 2,
    description: "Big slow squares. Knockback thumps enemies off platforms.",
    flavorText: "Mass over manners.",
    modifier: {
      projectileSpeedMultiplier: 0.88,
      knockbackMultiplier: 1.18,
      projectile: { shape: "square", sizeMultiplier: 1.22 },
    },
    visual: visual("square", "#c49a6c"),
    unique: true,
  },
  {
    // Was strictly boring next to its uncommon-tier peers (I-Rounds: +16%
    // dmg / -6% speed at the same cost). Bumped damage and added recoil
    // control so it earns a real niche: a punchier, steadier shot.
    id: "x-rounds",
    name: "X Rounds",
    category: "projectile",
    rarity: "uncommon",
    buckets: ["shape"],
    essenceCost: 2,
    description: "X-cut shards: more damage and calmer recoil. Wide edges for messy angles.",
    flavorText: "Crossed out.",
    modifier: {
      damageMultiplier: 1.1,
      recoilMultiplier: 0.92,
      projectile: { shape: "x", sizeMultiplier: 1.08 },
    },
    visual: visual("x", "#fca5a5"),
    unique: true,
  },
  {
    id: "i-rounds",
    name: "I Rounds",
    category: "projectile",
    rarity: "uncommon",
    buckets: ["shape"],
    essenceCost: 2,
    description: "Tall bar crystals pack serious damage. Slightly slower — reward clean lines.",
    flavorText: "A straight answer, violently.",
    modifier: {
      damageMultiplier: 1.16,
      projectileSpeedMultiplier: 0.94,
      projectile: { shape: "bar", sizeMultiplier: 1.12 },
    },
    visual: visual("bar", "#ddd6fe"),
    unique: true,
  },
  {
    id: "orby-blap-blap",
    name: "Orby Blap Blap",
    category: "weapon",
    rarity: "rare",
    buckets: ["shape", "quantity"],
    essenceCost: 4,
    description: "Fat orbs fire in a two-shot blap. Slower flight, huge presence, close-range bully.",
    flavorText: "Blap once. Blap again.",
    modifier: {
      damageMultiplier: 0.78,
      projectileSpeedMultiplier: 0.72,
      spreadRadians: degrees(18),
      projectile: { shape: "orb", count: 2, sizeMultiplier: 1.38, impactRadiusPx: 36 },
    },
    visual: visual("orb", "#f0abfc"),
    unique: true,
  },
  {
    id: "continuous-refractor",
    name: "Continuous Refractor",
    category: "weapon",
    rarity: "rare",
    buckets: ["delivery"],
    essenceCost: 5,
    description: "Hold to pour a continuous beam. Lower per-tick damage, relentless pressure and glow.",
    flavorText: "A wall made of now.",
    modifier: {
      delivery: "continuous-beam",
      damageMultiplier: 0.42,
      fireRateMultiplier: 2.4,
      projectile: { rangePx: 760, impact: "slow-field", slowMultiplier: 0.72 },
    },
    visual: visual("square", "#dff7ff"),
    unique: true,
  },
  {
    id: "shard-bloom",
    name: "Shard Bloom",
    category: "weapon",
    rarity: "rare",
    buckets: ["quantity"],
    essenceCost: 5,
    description: "Close-range shard burst instead of a pulse wave. Devastating in faces, weak at range.",
    flavorText: "The core empties its pockets.",
    modifier: {
      delivery: "projectile",
      damageMultiplier: 0.62,
      fireRateMultiplier: 0.82,
      recoilMultiplier: 1.24,
      spreadRadiansAdd: degrees(38),
      projectileCountAdd: 5,
      projectile: { sizeMultiplier: 0.78, rangePx: 390 },
    },
    visual: visual("orb", "#c084fc"),
    maxStacks: 2,
  },
  {
    id: "arc-shards",
    name: "Arc Shards",
    category: "projectile",
    rarity: "common",
    buckets: ["trajectory"],
    essenceCost: 2,
    description: "Lobbing diamonds arc over cover. Drop fire onto ledges and platforms.",
    flavorText: "Gravity works for you.",
    modifier: {
      projectileSpeedMultiplier: 0.86,
      projectile: { pathing: "gravity", gravityScale: 560 },
    },
    visual: visual("hexagon", "#ffd166"),
  },
  {
    id: "seeker-facets",
    name: "Seeker Facets",
    category: "projectile",
    rarity: "rare",
    buckets: ["trajectory"],
    essenceCost: 4,
    description: "Main shot homes toward the nearest foe with a capped turn rate. Still aim — it assists, not auto-wins.",
    flavorText: "It remembers the slight.",
    modifier: {
      projectileSpeedMultiplier: 0.82,
      projectile: { pathing: "homing", homingStrength: 4.4 },
      projectileHomingStrengthAdd: 1.2,
    },
    // Wizard expression = docs/card-pool-v2.md "Grudge" (universal spec,
    // reborn from this exact card — same 4.4 rad/s figure). Grudge's spec
    // is the capped-turn homing seeker-facets already ships PLUS the −10%
    // damage the redesign prices it at ("assists, never auto-wins" costs
    // something). Ninja/Paladin/Priest have no entry yet (their Grudge
    // readings — bent slash waves, arc forgiveness, dual ally/enemy homing
    // — need melee/heal verbs that don't exist; classes-goal.md P2-P4) so
    // they fall back to the class-blind modifier above, i.e. today's
    // Seeker Facets, unchanged.
    classModifiers: {
      wizard: {
        projectileSpeedMultiplier: 0.82,
        damageMultiplier: 0.9,
        projectile: { pathing: "homing", homingStrength: 4.4 },
        projectileHomingStrengthAdd: 1.2,
      },
    },
    visual: visual("triangle", "#f0abfc"),
    maxStacks: 4,
  },
  {
    id: "micro-seekers",
    name: "Micro Seekers",
    category: "projectile",
    rarity: "uncommon",
    buckets: ["trajectory", "quantity"],
    essenceCost: 3,
    description: "Extra tiny homers peel into the fight. Chaos fuel for multi-target messes.",
    flavorText: "Small. Personal. Persistent.",
    modifier: {
      damageMultiplier: 0.78,
      projectileSpeedMultiplier: 0.9,
      spreadRadiansAdd: degrees(16),
      projectileCountAdd: 2,
      projectileHomingStrengthAdd: 0.9,
      projectile: { pathing: "homing", homingStrength: 3.2, sizeMultiplier: 0.74 },
    },
    visual: visual("triangle", "#f5d0fe"),
    maxStacks: 5,
  },
  {
    id: "magnet-spray",
    name: "Magnet Spray",
    category: "weapon",
    rarity: "rare",
    buckets: ["trajectory", "quantity"],
    essenceCost: 5,
    description: "Wide scatter of weak seekers. Spray the room; spite steers the shards.",
    flavorText: "Point roughly. Commit fully.",
    modifier: {
      damageMultiplier: 0.58,
      fireRateMultiplier: 0.9,
      projectileSpeedMultiplier: 0.84,
      spreadRadiansAdd: degrees(34),
      projectileCountAdd: 4,
      projectileHomingStrengthAdd: 1.1,
      projectile: { pathing: "homing", homingStrength: 2.8, sizeMultiplier: 0.68 },
    },
    visual: visual("circle", "#e879f9"),
    maxStacks: 4,
  },
  {
    id: "bouncy-prism",
    name: "Bouncy Prism",
    category: "projectile",
    rarity: "uncommon",
    buckets: ["trajectory"],
    essenceCost: 3,
    description: "Ricochets up to four times — brighter after each bounce. Own the corridors.",
    flavorText: "Walls are just more aim.",
    modifier: {
      projectile: { pathing: "bounce" },
      projectileBounceAdd: 4,
    },
    visual: visual("square", "#7dd3fc"),
    maxStacks: 4,
  },
  {
    id: "extra-bounce",
    name: "+1 Bounce",
    category: "projectile",
    rarity: "common",
    buckets: ["trajectory"],
    essenceCost: 1,
    description: "+1 ricochet on everything you fire. Stacks the geometry game.",
    flavorText: "One more vote for the wall.",
    modifier: {
      projectile: { pathing: "bounce" },
      projectileBounceAdd: 1,
    },
    visual: visual("square", "#bae6fd"),
    maxStacks: 8,
  },
  {
    id: "boomerang-return",
    name: "Boomerang Prism",
    category: "projectile",
    rarity: "uncommon",
    buckets: ["trajectory"],
    essenceCost: 3,
    description: "After half range, shots curl home. Catch retreats and punish chase-you play.",
    flavorText: "Regret, sharpened.",
    modifier: {
      projectileSpeedMultiplier: 0.92,
      projectile: { pathing: "boomerang", lifetimeMultiplier: 1.18 },
    },
    visual: visual("orb", "#c4b5fd"),
    unique: true,
  },
  {
    id: "x-velocity",
    name: "+X Velocity",
    category: "projectile",
    rarity: "common",
    buckets: ["trajectory"],
    essenceCost: 1,
    description: "Much faster projectiles, thinner trail. Lead less; punish peeks harder.",
    flavorText: "Be there first.",
    modifier: {
      projectileSpeedMultiplier: 1.18,
      projectile: { lifetimeMultiplier: 0.96 },
    },
    visual: visual("bar", "#5eead4"),
    maxStacks: 7,
  },
  {
    id: "zero-g-floaters",
    name: "Zero-G Floaters",
    category: "projectile",
    rarity: "uncommon",
    buckets: ["trajectory"],
    essenceCost: 3,
    description: "Slow floaters with longer life and a bit more size. Own airspace and chokepoints.",
    flavorText: "Hang time is a weapon.",
    modifier: {
      projectileSpeedMultiplier: 0.58,
      projectile: { pathing: "float", lifetimeMultiplier: 1.5, sizeMultiplier: 1.18 },
    },
    visual: visual("orb", "#a7f3d0"),
    unique: true,
  },
  {
    // Was strictly dominated by +1 Projectile (cheaper, less damage loss,
    // tighter spread) — the only differentiator (SET vs ADD spread) never
    // mattered in practice. Given its own niche: a controlled twin-shot
    // burst (fire-rate up, damage retained better) instead of a worse
    // swarm-starter.
    id: "dual-splitter",
    name: "Dual Splitter",
    category: "weapon",
    rarity: "common",
    buckets: ["quantity"],
    essenceCost: 2,
    description: "Two shards at a tight angle, faster cadence. Cover more width without full spray.",
    flavorText: "One thought, two edges.",
    modifier: {
      damageMultiplier: 0.92,
      fireRateMultiplier: 1.06,
      spreadRadians: degrees(26),
      projectileCountAdd: 1,
    },
    visual: visual("triangle", "#67e8f9"),
    maxStacks: 6,
  },
  {
    id: "triple-fan",
    name: "Triple Fan",
    category: "weapon",
    rarity: "uncommon",
    buckets: ["quantity"],
    essenceCost: 3,
    description: "Three-way fan. Control space and punish groups — less laser, more weather.",
    flavorText: "The core spreads its hands.",
    modifier: {
      damageMultiplier: 0.68,
      spreadRadiansAdd: degrees(18),
      projectileCountAdd: 2,
    },
    visual: visual("hexagon", "#38bdf8"),
    maxStacks: 4,
  },
  {
    id: "five-shard-spray",
    name: "Five Shard Spray",
    category: "weapon",
    rarity: "rare",
    buckets: ["quantity"],
    essenceCost: 5,
    description: "Five-projectile spray. Pressure over precision. Melt doors and double-downs.",
    flavorText: "Accuracy left. Pressure stayed.",
    modifier: {
      damageMultiplier: 0.58,
      fireRateMultiplier: 0.88,
      recoilMultiplier: 1.22,
      spreadRadiansAdd: degrees(26),
      projectileCountAdd: 4,
      projectile: { sizeMultiplier: 0.86 },
    },
    visual: visual("circle", "#67e8f9"),
    maxStacks: 2,
  },
  {
    id: "one-more-shard",
    name: "+1 Projectile",
    category: "weapon",
    rarity: "common",
    buckets: ["quantity"],
    essenceCost: 1,
    description: "+1 projectile to your pattern. Stacks with fans and splitters for denser fire.",
    flavorText: "Just one more. Famous last words.",
    modifier: {
      damageMultiplier: 0.94,
      spreadRadiansAdd: degrees(7),
      projectileCountAdd: 1,
    },
    visual: visual("circle", "#99f6e4"),
    maxStacks: 8,
  },
  {
    id: "wide-barrage",
    name: "Wide Barrage",
    category: "weapon",
    rarity: "uncommon",
    buckets: ["quantity"],
    essenceCost: 3,
    description: "Side-to-side barrage. Flood a lane. Great with bounce and seekers.",
    flavorText: "Not aim — weather.",
    modifier: {
      damageMultiplier: 0.7,
      fireRateMultiplier: 0.94,
      recoilMultiplier: 1.12,
      spreadRadiansAdd: degrees(44),
      projectileCountAdd: 3,
      projectile: { sizeMultiplier: 0.82 },
    },
    visual: visual("bar", "#67e8f9"),
    maxStacks: 5,
  },
  {
    id: "needle-hose",
    name: "Needle Hose",
    category: "weapon",
    rarity: "common",
    buckets: ["quantity"],
    essenceCost: 2,
    description: "Fast micro needles on the sides. Chip damage and fill while your core shot lands.",
    flavorText: "A polite sentence, shouted.",
    modifier: {
      damageMultiplier: 0.82,
      fireRateMultiplier: 1.1,
      projectileSpeedMultiplier: 1.08,
      spreadRadiansAdd: degrees(11),
      projectileCountAdd: 2,
      projectile: { shape: "bar", sizeMultiplier: 0.62 },
    },
    visual: visual("bar", "#a7f3d0"),
    maxStacks: 6,
  },
  {
    id: "orbiting-satellites",
    name: "Orbiting Satellites",
    category: "utility",
    rarity: "rare",
    buckets: ["quantity"],
    essenceCost: 5,
    description: "Two orbiting crystals auto-harass nearby foes. Passive your hands for the big shot.",
    flavorText: "The little ones are listening.",
    modifier: {
      orbitingSatellites: 2,
      fireRateMultiplier: 1.12,
    },
    visual: visual("orb", "#93c5fd"),
    unique: true,
  },
  {
    id: "cluster-bomb",
    name: "Cluster Bomb",
    category: "projectile",
    rarity: "rare",
    buckets: ["quantity"],
    essenceCost: 5,
    description: "On first hit, the shot splits into six child shards. Openers become area denial.",
    flavorText: "Impact has children. They bite.",
    modifier: {
      fireRateMultiplier: 0.72,
      projectileSplitAdd: 6,
      projectile: { sizeMultiplier: 1.12 },
    },
    // Wizard expression = docs/card-pool-v2.md "Splinterhead" (universal
    // spec, reborn from this exact card). Splinterhead re-authors the split
    // count down to 3 (from 6) as part of the redesign; per-child damage/
    // range/fan-angle (5 dmg, 240px, 40°) are governed by the shared split
    // substrate's global constants (projectile.ts spawnSplit), not a
    // per-card lever — first-draft numbers in the doc note this explicitly
    // ("playtest will move them"). Ninja/Paladin/Priest readings (wave
    // shatter, stone-chip ranged echo, heal motes) need melee/heal verbs
    // that don't exist yet — no entry, falls back to today's Cluster Bomb.
    classModifiers: {
      wizard: {
        fireRateMultiplier: 0.72,
        projectileSplitAdd: 3,
        projectile: { sizeMultiplier: 1.12 },
      },
    },
    visual: visual("hexagon", "#fde68a"),
    maxStacks: 3,
  },
  {
    id: "explosive-facet",
    name: "Explosive Facet",
    category: "projectile",
    rarity: "uncommon",
    buckets: ["impact"],
    essenceCost: 3,
    description: "Hits detonate a prism burst. Splash for groups and soft cover peels.",
    flavorText: "Impact, then argument.",
    modifier: {
      damageMultiplier: 0.92,
      projectile: { impact: "explosive", impactRadiusPx: 64 },
    },
    visual: visual("orb", "#fb7185"),
    unique: true,
  },
  {
    id: "sticky-shards",
    name: "Sticky Shards",
    category: "projectile",
    rarity: "uncommon",
    buckets: ["impact"],
    essenceCost: 3,
    description: "Shards stick, glow, then burst. Plant threats on bodies and walls.",
    flavorText: "This is home now.",
    modifier: {
      projectileSpeedMultiplier: 0.8,
      projectile: { impact: "sticky", impactRadiusPx: 48 },
    },
    visual: visual("square", "#f97316"),
    unique: true,
  },
  {
    id: "pierce-chain",
    name: "Pierce Chain",
    category: "projectile",
    rarity: "rare",
    buckets: ["impact"],
    essenceCost: 4,
    description: "Pierce three targets and shed copies. Line up multi-kills through clumped packs.",
    flavorText: "One shot, several endings.",
    modifier: {
      projectile: { impact: "pierce-chain", pierceCount: 3, splitCount: 2 },
    },
    visual: visual("triangle", "#e879f9"),
    unique: true,
  },
  {
    id: "slow-field",
    name: "Slow Field",
    category: "projectile",
    rarity: "uncommon",
    buckets: ["impact"],
    essenceCost: 3,
    description: "Impacts leave a slowing crystal aura. Set up combos and deny escapes.",
    flavorText: "Time snags on the facets.",
    modifier: {
      damageMultiplier: 0.86,
      projectile: { impact: "slow-field", impactRadiusPx: 70, slowMultiplier: 0.58 },
    },
    // Priest's "curse" reading (docs/class-overhaul-workboard.md chunk 0.3;
    // docs/classes-goal.md "Priest / Syzygist": "extends the existing
    // status-effect substrate ... add regen, haste, weaken, curse"). A true
    // standalone curse status type would mean a new PlayerEntity field +
    // World.ts status-application changes — both forbidden for this chunk
    // (do not add new debuff types, do not touch World.ts). Honest
    // approximation: reuse the EXISTING slow-field debuff — the one debuff
    // whose strength/radius live on the card modifier itself rather than a
    // World.ts global constant (unlike burn/freeze's DPS-and-duration; see
    // molten-core/frost-prism's own Priest-blocked comments below) — and
    // let Priest lean harder into it: bigger radius, stronger slow, paid
    // for with a bigger damage cut. This is the same shape as Wizard's
    // Grudge/Splinterhead re-tunes (classExpression.test.ts), just on the
    // debuff axis instead of homing/split.
    classModifiers: {
      priest: {
        damageMultiplier: 0.76,
        projectile: { impact: "slow-field", impactRadiusPx: 92, slowMultiplier: 0.46 },
      },
    },
    visual: visual("hexagon", "#bfdbfe"),
    unique: true,
  },
  {
    id: "molten-core",
    name: "Molten Core",
    category: "projectile",
    rarity: "uncommon",
    buckets: ["element"],
    essenceCost: 3,
    description: "Fire: molten trails and burn-ready hits. Zone control with heat.",
    flavorText: "Refraction comes out angry.",
    modifier: {
      projectile: { element: "fire", impactRadiusPx: 42 },
    },
    // Wizard expression = docs/card-pool-v2.md "Cinder" (universal spec,
    // reborn from this exact card): "fire shots, molten trails — zone
    // control with heat", i.e. the textbook fire-element cast this card
    // already is. Burn's DPS/duration (World.ts: damage×0.4 for 3s,
    // Emission-scaled) are global per-element constants, not a per-card
    // lever, so this override is intentionally identical to the class-
    // blind modifier — real authored content, zero numeric change (the
    // doc's "3/s for 2s" first-draft figure isn't independently tunable
    // without touching the shared burn formula, out of this session's
    // scope). Ninja's burning-edge-leaves-a-flame-line and Priest's fever-
    // inversion (burn lowers healing received) need substrate this session
    // doesn't build — no entry, falls back to today's Molten Core.
    classModifiers: {
      wizard: {
        projectile: { element: "fire", impactRadiusPx: 42 },
      },
    },
    visual: visual("triangle", "#ff7a18"),
    unique: true,
  },
  {
    id: "frost-prism",
    name: "Frost Prism",
    category: "projectile",
    rarity: "uncommon",
    buckets: ["element"],
    essenceCost: 3,
    description: "Ice: freezing facets and slow-leaning hits. Lock movement, then finish.",
    flavorText: "Cold light cuts clean.",
    modifier: {
      projectile: { element: "ice", impact: "slow-field", slowMultiplier: 0.68 },
    },
    // Wizard expression = docs/card-pool-v2.md "Hoarfrost" (universal spec,
    // reborn from this exact card): "freezing facets — lock movement, then
    // finish", the textbook ice-element cast this card already is. Chill
    // strength/duration and the 3-stack brittle-freeze escalation are
    // World.ts global ice-element constants (freezeUntilTick/freezeMultiplier),
    // not a per-card lever — implementing the doc's exact "0.8×/1.2s +
    // brittle-freeze" figures would mean changing the shared freeze formula
    // for every ice card in the game, out of this session's scope (not a
    // per-class reskin). Override is intentionally identical to the class-
    // blind modifier — real authored content, zero numeric change. Ninja's
    // regen-pause and Priest's ally frost-ward-from-your-gun need substrate
    // this session doesn't build — no entry, falls back to today's Frost Prism.
    classModifiers: {
      wizard: {
        projectile: { element: "ice", impact: "slow-field", slowMultiplier: 0.68 },
      },
    },
    visual: visual("hexagon", "#93c5fd"),
    unique: true,
  },
  {
    id: "voltaic-spark",
    name: "Voltaic Spark",
    category: "projectile",
    rarity: "rare",
    buckets: ["element"],
    essenceCost: 4,
    description: "Lightning: pierces and arcs to a nearby target. Multi-mark punishment.",
    flavorText: "The crystal kept the storm.",
    modifier: {
      projectileSpeedMultiplier: 1.08,
      projectile: { element: "lightning", impact: "pierce-chain", pierceCount: 1 },
    },
    visual: visual("triangle", "#fef08a"),
    unique: true,
  },
  {
    // Void's damage now punches a HELD shield untouched (combat.ts
    // voidPiercing) — the counter-pick to the turtle meta. Still a fair
    // fight against SKILLED defense: the timed parry and the dash-bash slide's
    // active block still stop it same as anything else.
    id: "void-fracture",
    name: "Void Fracture",
    category: "projectile",
    rarity: "rare",
    buckets: ["element"],
    essenceCost: 4,
    description: "Void: ignores held shields and pierces two. Punish turtles and stacks.",
    flavorText: "Through absence, into them.",
    modifier: {
      damageMultiplier: 1.08,
      projectile: { element: "void", pierceCount: 2 },
    },
    visual: visual("orb", "#a78bfa"),
    unique: true,
  },
  {
    id: "radiant-overload",
    name: "Radiant Overload",
    category: "projectile",
    rarity: "rare",
    buckets: ["element"],
    essenceCost: 5,
    description: "Radiant: high damage, blinding white hit flash. The honest power pick.",
    flavorText: "A small sun. Bad manners.",
    modifier: {
      damageMultiplier: 1.14,
      fireRateMultiplier: 0.82,
      projectile: { element: "radiant", impactRadiusPx: 58, sizeMultiplier: 1.14 },
    },
    visual: visual("hexagon", "#fefce8"),
    unique: true,
  },
  {
    id: "rapid-refraction",
    name: "Rapid Refraction",
    category: "utility",
    rarity: "common",
    buckets: ["utility"],
    essenceCost: 2,
    description: "Faster fire, softer recoil, thinner faster needles. Win trades with tempo you can SEE.",
    flavorText: "Blink — already rude twice.",
    modifier: {
      // Reduced from 1.32 → 1.22 to prevent 1.5s TTK breach when stacked
      // with needle-compressor + damage shape cards. Per combat-balance-ttk/SKILL.md.
      fireRateMultiplier: 1.22,
      recoilMultiplier: 0.9,
      // Visible: needles read as skinny + snappy (not a silent RoF buff).
      projectileSpeedMultiplier: 1.06,
      projectile: { sizeMultiplier: 0.88 },
    },
    visual: visual("circle", "#5eead4"),
    maxStacks: 5,
  },
  {
    id: "needle-compressor",
    name: "Needle Compressor",
    category: "utility",
    rarity: "common",
    buckets: ["utility"],
    essenceCost: 2,
    description: "Higher rate of fire, smaller shots. Hose them down; aim still matters.",
    flavorText: "Tiny shots. Horrible tempo.",
    modifier: {
      // Reduced from 1.22 → 1.14 to prevent 1.5s TTK breach when stacked
      // with rapid-refraction + damage shape cards. Per combat-balance-ttk/SKILL.md.
      fireRateMultiplier: 1.14,
      projectile: { sizeMultiplier: 0.86 },
    },
    visual: visual("bar", "#a7f3d0"),
    maxStacks: 5,
  },
  {
    id: "heavy-coolant",
    name: "Heavy Coolant",
    category: "utility",
    rarity: "common",
    buckets: ["utility"],
    essenceCost: 2,
    description: "Bigger projectiles, slower fire. Each shot is a statement.",
    flavorText: "Big crystal. Slow manners.",
    modifier: {
      fireRateMultiplier: 0.88,
      projectile: { sizeMultiplier: 1.22 },
    },
    visual: visual("orb", "#bfdbfe"),
    maxStacks: 6,
  },
  {
    id: "essence-battery",
    name: "Essence Battery",
    category: "utility",
    rarity: "common",
    buckets: ["utility"],
    essenceCost: 2,
    description: "Bigger mag, faster reload, fatter crystal cores. Stay in the fight — shots look charged.",
    flavorText: "Reload before regret.",
    modifier: {
      magazineSizeAdd: 2,
      // Visible: charged cores — slightly larger crystal-tinted rounds.
      projectile: { sizeMultiplier: 1.1, element: "crystal" },
      reloadMultiplier: 0.86,
      ammoRegenPerSecond: 2,
    },
    visual: visual("square", "#86efac"),
    maxStacks: 4,
  },
  {
    id: "crystal-plating",
    name: "Crystal Plating",
    category: "defense",
    rarity: "common",
    buckets: ["utility"],
    essenceCost: 2,
    description: "More max health + thicker hex crystal shots. You look armored; you are armored.",
    flavorText: "More of you to fight for.",
    modifier: {
      maxHealthAdd: 20,
      moveSpeedMultiplier: 0.98,
      // Visible: plated hex cores + longer health bar on the rig.
      projectile: { shape: "hexagon", sizeMultiplier: 1.14, element: "crystal" },
    },
    // Wizard expression = docs/card-pool-v2.md "Plating" (universal
    // passive, reborn from this exact card): "+20 max health, −3% move
    // speed" — the redesign tightens the speed cost from this card's
    // current −2% to the doc's −3%. Small, genuine, tested difference.
    // Ninja/Paladin/Priest per-class lines (105/145/120 max health) are
    // the SAME +20 add read against each chassis's different base HP —
    // no distinct mechanic to author, but left unset deliberately so the
    // fallback (today's Crystal Plating) stays the single source of truth
    // until those chassis' base HP is confirmed live in the sim (currently
    // only Wizard/balanced ships combat-ready per classes-goal.md staging).
    classModifiers: {
      wizard: {
        maxHealthAdd: 20,
        moveSpeedMultiplier: 0.97,
        projectile: { shape: "hexagon", sizeMultiplier: 1.14, element: "crystal" },
      },
    },
    visual: visual("hexagon", "#86efac"),
    maxStacks: 5,
  },
  // phase-soles REMOVED — pure moveSpeed with no visible gun/body language.
  // Sprint Coils already owns "go faster" and the trail reads it.
  {
    // Widens the 120° dash-bash block arc (sim + rig). maxStacks 2 → ~197° at cap.
    id: "wide-parry",
    name: "Wide Parry",
    category: "defense",
    rarity: "uncommon",
    buckets: ["utility"],
    essenceCost: 3,
    description: "Wider dash-bash arc you can SEE on the shield shell. Catch more angles when you slide-block.",
    flavorText: "Your no covers more sky.",
    modifier: {
      parryCoverMultiplier: 1.28,
      // Visible secondary: crystal rim on your shots while plated for defense.
      projectile: { element: "crystal", sizeMultiplier: 1.04 },
    },
    visual: visual("hexagon", "#bae6fd"),
    maxStacks: 2,
  },
  {
    // Shorter dash-bash cooldown (floored in player.ts). maxStacks 2.
    id: "quick-parry",
    name: "Quick Parry",
    category: "defense",
    rarity: "uncommon",
    buckets: ["utility"],
    essenceCost: 3,
    description: "Shorter dash-bash cooldown — slide-guard more often. Snappier square cores mark the tempo.",
    flavorText: "Still rude. Sooner.",
    modifier: {
      dashCooldownMultiplier: 0.86,
      // Visible: square cores + slight speed so "quick" reads on the gun too.
      projectile: { shape: "square", sizeMultiplier: 0.94, speedMultiplier: 1.06 },
    },
    visual: visual("square", "#93c5fd"),
    maxStacks: 2,
  },
  {
    id: "overcharge",
    name: "Overcharge",
    category: "utility",
    rarity: "rare",
    buckets: ["utility"],
    essenceCost: 4,
    description: "Slower fire, huge shots, wider impact. Patient, brutal, platform-popping.",
    flavorText: "Wait. Then nonsense.",
    modifier: {
      fireRateMultiplier: 0.72,
      overchargeMultiplier: 3,
      projectile: { sizeMultiplier: 1.42, impactRadiusPx: 76 },
    },
    visual: visual("orb", "#f0abfc"),
    unique: true,
  },
  {
    id: "mirror-shield",
    name: "Mirror Shield",
    category: "defense",
    rarity: "rare",
    buckets: ["utility"],
    essenceCost: 4,
    description: "Blocked shots reflect straight back at the shooter. Their aim becomes yours.",
    flavorText: "No — you.",
    modifier: {
      mirrorShield: true,
      projectile: { element: "crystal" },
    },
    visual: visual("hexagon", "#bae6fd"),
    unique: true,
  },
  {
    id: "cataclysmic-prism",
    name: "Cataclysmic Prism",
    category: "projectile",
    rarity: "legendary",
    buckets: ["impact", "element"],
    essenceCost: 7,
    description: "Explosive + Radiant: massive nova and pure white flash. Round-ender energy.",
    flavorText: "Look directly at the math.",
    modifier: {
      damageMultiplier: 1.18,
      fireRateMultiplier: 0.72,
      projectile: {
        element: "radiant",
        impact: "explosive",
        impactRadiusPx: 118,
        sizeMultiplier: 1.22,
      },
    },
    visual: visual("orb", "#ffffff"),
    unique: true,
  },
  {
    id: "homing-cluster",
    name: "Homing Cluster",
    category: "projectile",
    rarity: "legendary",
    buckets: ["trajectory", "quantity"],
    essenceCost: 7,
    description: "Homing + triple fan: three seekers curve into the kill. Beautiful and unfair.",
    flavorText: "Three bad ideas with a destination.",
    modifier: {
      damageMultiplier: 0.78,
      projectileSpeedMultiplier: 0.82,
      spreadRadians: degrees(28),
      projectile: { count: 3, pathing: "homing", homingStrength: 5.2 },
    },
    visual: visual("triangle", "#f0abfc"),
    unique: true,
  },
  {
    id: "sticky-ray",
    name: "Sticky Ray",
    category: "weapon",
    rarity: "legendary",
    buckets: ["delivery", "impact"],
    essenceCost: 7,
    description: "Hitscan ray that paints sticky crystal bursts. Beam leaves delayed pain.",
    flavorText: "The beam leaves receipts.",
    modifier: {
      delivery: "raycast",
      fireRateMultiplier: 0.78,
      projectile: { impact: "sticky", impactRadiusPx: 74, element: "crystal" },
    },
    visual: visual("square", "#99f6e4"),
    unique: true,
  },

  // ── Movement augments (ride the wall kit) ────────────────────────────────
  {
    id: "sprint-coils",
    name: "Sprint Coils",
    category: "movement",
    rarity: "uncommon",
    buckets: ["utility"],
    essenceCost: 3,
    description: "Much faster ground and air move. Outrun peeks, claim high ground first.",
    flavorText: "The floor is a suggestion.",
    modifier: { moveSpeedMultiplier: 1.18 },
    visual: visual("circle", "#67e8f9"),
    maxStacks: 3,
  },
  {
    id: "glide-membrane",
    name: "Glide Membrane",
    category: "movement",
    rarity: "uncommon",
    buckets: ["utility"],
    essenceCost: 3,
    description: "Lower gravity: floatier jumps, longer hang for wall routes and aim windows.",
    flavorText: "Falling as a choice.",
    modifier: { gravityMultiplier: 0.74 },
    visual: visual("triangle", "#a5f3fc"),
    maxStacks: 2,
  },
  {
    id: "lead-boots",
    name: "Lead Boots",
    category: "movement",
    rarity: "uncommon",
    buckets: ["utility"],
    essenceCost: 2,
    description: "Heavier fall, slightly faster run. Drop onto fights like a hammer; wall-jumps land sooner.",
    flavorText: "Down arrives on time.",
    modifier: { gravityMultiplier: 1.35, moveSpeedMultiplier: 1.06 },
    visual: visual("square", "#94a3b8"),
    maxStacks: 2,
  },
  {
    id: "spring-heel",
    name: "Spring Heel",
    category: "movement",
    rarity: "uncommon",
    buckets: ["utility"],
    essenceCost: 3,
    description: "Higher jump and wall-jump. Reach routes others cannot; dive from above.",
    flavorText: "The ground pushes back.",
    modifier: { jumpMultiplier: 1.18, wallJumpMultiplier: 1.16 },
    // Wizard expression = docs/card-pool-v2.md "Spring Heel" (universal
    // passive — "the name survives; nothing else does"): re-authored to
    // +10%/+10% (jump apex 134→~162px, wall-kick rise 173→~190px) rather
    // than this card's current +18%/+16%. A genuine, tested numeric
    // difference — the redesign's stat, not a placeholder. Ninja/Paladin/
    // Priest per-class flavor (wall-kick-chain compounding, higher slam
    // arrival, overwatch positioning) is pure re-description of the SAME
    // jump/wall-kick numbers for those chassis, not a different mechanic —
    // still deferred (no entry) because the honest per-class VALUE for
    // those bodies hasn't been separately authored/tuned this session;
    // they fall back to today's Spring Heel unchanged.
    classModifiers: {
      wizard: { jumpMultiplier: 1.1, wallJumpMultiplier: 1.1 },
    },
    visual: visual("triangle", "#5eead4"),
    maxStacks: 2,
  },
  {
    id: "gecko-grip",
    name: "Gecko Grip",
    category: "movement",
    rarity: "uncommon",
    buckets: ["utility"],
    essenceCost: 3,
    description: "Sticky wall-slide — cling and reset. Vertical maps become your house.",
    flavorText: "Down is optional.",
    modifier: { wallSlideMultiplier: 0.45 },
    visual: visual("hexagon", "#4ade80"),
    maxStacks: 2,
  },
  {
    id: "double-jump",
    name: "Second Wind",
    category: "movement",
    rarity: "rare",
    buckets: ["utility"],
    essenceCost: 4,
    description: "Mid-air jump. Stacks for triple+ jumps. Recover from bad falls and fake commits.",
    flavorText: "Who said one?",
    modifier: { airJumpsAdd: 1 },
    // Wizard expression = docs/card-pool-v2.md "Second Wind" (universal
    // passive — same name AND same +1 air jump this card already ships;
    // "a glyph flickers underfoot" is pure visual-read flavor, zero
    // mechanical change). Override intentionally identical to the class-
    // blind modifier — real authored content, zero numeric change. Ninja's
    // wall-kick-chain combo, Paladin's stomp-jump damage ring, and Priest's
    // self-cleanse-on-jump ARE mechanically distinct (damage-on-land,
    // status removal) and need substrate this session doesn't build — no
    // entry, falls back to today's Second Wind.
    classModifiers: {
      wizard: { airJumpsAdd: 1 },
    },
    visual: visual("circle", "#7dd3fc"),
    maxStacks: 3,
  },
  {
    id: "blink-dash",
    name: "Blink Dash",
    category: "movement",
    rarity: "rare",
    buckets: ["utility"],
    essenceCost: 4,
    description: "Unlock DASH (C / dash button): fast horizontal burst + one air-dash per land.",
    flavorText: "Be elsewhere. Now.",
    modifier: { dashChargesAdd: 1 },
    visual: visual("x", "#c4b5fd"),
    maxStacks: 2,
  },

  // ── Shield augments ──────────────────────────────────────────────────────
  {
    id: "bulwark-core",
    name: "Bulwark Core",
    category: "defense",
    rarity: "uncommon",
    buckets: ["utility"],
    essenceCost: 3,
    description: "Much larger shield reserve. Hold block through longer volleys before it pops.",
    flavorText: "A bigger no.",
    modifier: { shieldChargeMultiplier: 1.6 },
    visual: visual("hexagon", "#86efac"),
    maxStacks: 3,
  },
  {
    id: "rapid-capacitor",
    name: "Rapid Capacitor",
    category: "defense",
    rarity: "uncommon",
    buckets: ["utility"],
    essenceCost: 3,
    description: "Shield recharges much faster between blocks. Spam safe peeks and re-engage.",
    flavorText: "Back up before they do.",
    modifier: { shieldRechargeMultiplier: 1.8 },
    visual: visual("circle", "#bae6fd"),
    maxStacks: 3,
  },

  // ── Directional (aim) shield augments ────────────────────────────────────
  {
    id: "aim-barrier",
    name: "Aim Barrier",
    category: "defense",
    rarity: "rare",
    buckets: ["utility"],
    essenceCost: 4,
    description: "Shield only covers where you aim — but that frontal wall is huge. Point the no.",
    flavorText: "Mean the angle.",
    modifier: { directionalShield: true, shieldChargeMultiplier: 2.2 },
    visual: visual("triangle", "#93c5fd"),
    unique: true,
  },
  {
    id: "riot-mirror",
    name: "Riot Mirror",
    category: "defense",
    rarity: "legendary",
    buckets: ["utility"],
    essenceCost: 6,
    description: "Aimed reflect wall with big charge: face threats and bounce their shots home.",
    flavorText: "Return to sender. Fast.",
    modifier: {
      directionalShield: true,
      mirrorShield: true,
      shieldChargeMultiplier: 1.7,
      projectile: { element: "crystal" },
    },
    visual: visual("hexagon", "#c4b5fd"),
    unique: true,
  },
  {
    id: "stolen-fangs",
    name: "Stolen Fangs",
    category: "defense",
    rarity: "legendary",
    buckets: ["utility"],
    essenceCost: 7,
    description: "Blocked hits bank locks (max 2). Next shot burns a lock into a weaker homing bolt.",
    flavorText: "It bit. Now it owes you.",
    modifier: {
      stolenFangs: true,
      projectile: { element: "crystal" },
    },
    // Priest's solo-floor lifesteal (docs/class-overhaul-workboard.md chunk
    // 0.3; docs/card-pool-v2.md "Tithe": "Drain reborn — the lineage of
    // Crimson Tithe AND STOLEN FANGS, folded into one always-on law").
    // card-pool-v2.md's new "Tithe" (an always-on 8%-of-damage-dealt heal,
    // universal) can't be added as a brand-new CardDefinition in this
    // chunk: the Zig-side card table (sim/src/data/cards_gen.zig — inside
    // the forbidden sim/src/ tree, and owned by the concurrently-running
    // Ninja-melee pass right now) is a generated snapshot of this file, and
    // any new id desyncs the wasm-parity suites (confirmed by trial: a
    // trial "tithe" CardDefinition broke weaponBuildParity.test.ts's
    // card-count assertion and emissionParity.test.ts's per-card sweep,
    // both comparing against the stale compiled table) — regenerating that
    // table means touching sim/src/, explicitly forbidden for this chunk.
    // Grafting the SAME mechanic onto Stolen Fangs' EXISTING id — the card
    // the doc itself names as Tithe's own lineage ancestor — delivers real,
    // live, tested Priest lifesteal with zero new ids: Priest trades the
    // block-charge/homing verb (REPLACED wholesale, never merged, same
    // classModifiers doctrine every other authored card in this pool
    // follows) for an always-on drain read directly off `leechFraction`
    // (types.ts's existing ProjectileEntity field — the SAME field the
    // six-axes Crimson Tithe ability already stamps; World.ts's hit
    // resolution already knows how to pay it out, self-heal only, capped,
    // self-damage excluded — no World.ts edit needed). The doc's OTHER
    // half of Tithe's Priest reading ("50% flows onward to the nearest
    // injured ally") needs sim team identity (chunk 1.1, unbuilt) and a
    // second-player payout in World.ts — both out of this chunk's
    // forbidden-file boundary, so this ships the honest solo-only slice
    // ("Solo Syzygist takes" — character-sheets-v1.md), not the teams half.
    classModifiers: {
      priest: {
        leechFraction: 0.08,
      },
    },
    visual: visual("triangle", "#a78bfa"),
    unique: true,
  },
  // ── Ability cards (six-axes-goal.md Layer 2): drafted actives on keys
  //    1-4. WORKING names — the war-crimes copy pass owns the final
  //    register (never rename ids; they're wire-load-bearing). ──────────────
  {
    id: "crimson-tithe",
    name: "Crimson Tithe",
    category: "ability",
    rarity: "rare",
    buckets: ["ability"],
    essenceCost: 6,
    description: "Active (3s, 14s cooldown): your shots tithe half the damage they deal back to you as health.",
    flavorText: "The congregation pays in what it bleeds.",
    active: {
      kind: "crimson-tithe",
      cooldownMs: 14000,
      durationMs: 3000,
    },
    visual: visual("x", "#dc2626"),
    unique: true,
  },
  {
    id: "shadow-step", // id is wire-load-bearing — display name signed off 2026-07-17
    name: "Interstice Writ",
    category: "ability",
    rarity: "rare",
    buckets: ["ability"],
    essenceCost: 6,
    description: "Active (9s cooldown): blink toward your aim. Walls are a suggestion; landing inside one is not.",
    flavorText: "Filed in the space between spaces. Approved before it was asked.",
    active: {
      kind: "shadow-step",
      cooldownMs: 9000,
    },
    visual: visual("triangle", "#7dd3fc"),
    unique: true,
  },
  {
    id: "veil-of-nought",
    name: "Veil of Nought",
    category: "ability",
    rarity: "legendary",
    buckets: ["ability"],
    essenceCost: 7,
    description: "Active (1.5s, 16s cooldown): unmade — homing and satellites lose you; firing ends it early.",
    flavorText: "The archons cannot audit what is not.",
    active: {
      kind: "veil-of-nought",
      cooldownMs: 16000,
      durationMs: 1500,
    },
    visual: visual("orb", "#8b5cf6"),
    unique: true,
  },
  {
    id: "severing-answer",
    name: "Severing Answer",
    category: "ability",
    rarity: "legendary",
    buckets: ["ability"],
    essenceCost: 7,
    description: "Active (0.5s, 12s cooldown): a counter-stance — the next hit taken is negated and returned (capped).",
    flavorText: "Ask again.",
    active: {
      kind: "severing-answer",
      cooldownMs: 12000,
      durationMs: 500,
    },
    visual: visual("bar", "#f59e0b"),
    unique: true,
  },
  {
    id: "shelter-seal", // id is wire-load-bearing — display name signed off 2026-07-17
    name: "Shelter Writ",
    category: "ability",
    rarity: "legendary",
    buckets: ["ability"],
    essenceCost: 7,
    description: "Active (2.5s, 12s cooldown): a ward shell — damage you take is halved while it holds.",
    flavorText: "Here, the writ of violence does not run.",
    active: {
      kind: "shelter-seal",
      cooldownMs: 12000,
      durationMs: 2500,
    },
    visual: visual("hexagon", "#38bdf8"),
    unique: true,
  },
  // ── Geometrician catalog v1 (docs/class-ability-catalogs-v1.md) ─────────
  // classId: "wizard" — offer-roll gated (round.ts enterDrafting); every
  // other chassis sees zero of these until its own catalog is authored
  // (classes-goal.md P2-P4). Fill into the SAME rack keys 1-3 as the five
  // universal ability cards above via the existing draft/offer mechanism —
  // no new UI, no new slot system. v1 sim effects (World.ts / weapon.ts)
  // reuse six-axes substrate as hard as possible; doc-fidelity gaps
  // (true charge-hold, a persisting lattice plane, parry-hooked refunds)
  // are recorded deferrals in-line, same discipline as Shelter Seal's own
  // "self-bulwark fallback" precedent above — never silent stubs.
  {
    id: "sunlance",
    name: "Sunlance",
    category: "ability",
    rarity: "rare",
    buckets: ["ability"],
    essenceCost: 6,
    classId: "wizard",
    role: "offense",
    description:
      "Active (0.7s window, 7s cooldown): shots deal 1.6x damage while it holds. (v1: a burst window, not a true charge-hold — see doc.)",
    flavorText: "I finished a sentence the crystal started.",
    active: {
      kind: "sunlance",
      cooldownMs: 7000,
      durationMs: 700,
    },
    visual: visual("bar", "#fbbf24"),
    unique: true,
  },
  {
    id: "facet-break",
    name: "Facet Break",
    category: "ability",
    rarity: "rare",
    buckets: ["ability"],
    essenceCost: 6,
    classId: "wizard",
    role: "single",
    description:
      "Active (4s mark, 8s cooldown): marks the nearest foe in your aim cone — your hits on them are amplified.",
    flavorText: "One facet, cut true, breaks the whole gem.",
    active: {
      kind: "facet-break",
      cooldownMs: 8000,
      durationMs: 4000,
    },
    visual: visual("triangle", "#f472b6"),
    unique: true,
  },
  {
    id: "prism-fan",
    name: "Prism Fan",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "wizard",
    role: "aoe",
    description: "Active (9s cooldown): a cone burst of shard projectiles fans out from your aim.",
    flavorText: "Still crystal munitions — just more of the angle.",
    active: {
      kind: "prism-fan",
      cooldownMs: 9000,
    },
    visual: visual("hexagon", "#67e8f9"),
    unique: true,
  },
  {
    id: "lattice",
    name: "Lattice",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "wizard",
    role: "aoe",
    description:
      "Active (9s cooldown): an instant ring of shards bursts around you. (v1: a nova, not the doc's persisting plane — see doc.)",
    flavorText: "Space denial, angle-first.",
    active: {
      kind: "lattice",
      cooldownMs: 9000,
    },
    visual: visual("square", "#a3e635"),
    unique: true,
  },
  {
    id: "return-glass",
    name: "Return Glass",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "wizard",
    role: "defense",
    description:
      "Active (10s cooldown): an instant tick of shield charge. (v1: not gated behind a live parry yet — see doc.)",
    flavorText: "What broke, mends — a little.",
    active: {
      kind: "return-glass",
      cooldownMs: 10000,
    },
    visual: visual("circle", "#93c5fd"),
    unique: true,
  },
  {
    id: "hard-aperture",
    name: "Hard Aperture",
    category: "ability",
    rarity: "rare",
    buckets: ["ability"],
    essenceCost: 6,
    classId: "wizard",
    role: "defense",
    description:
      "Active (0.6s window, 9s cooldown): a damage gate — incoming hits are halved while it holds.",
    flavorText: "Hold the proof.",
    active: {
      kind: "hard-aperture",
      cooldownMs: 9000,
      durationMs: 600,
    },
    visual: visual("square", "#38bdf8"),
    unique: true,
  },
  {
    id: "overclock",
    name: "Overclock",
    category: "ability",
    rarity: "rare",
    buckets: ["ability"],
    essenceCost: 6,
    classId: "wizard",
    role: "buff",
    description: "Active (3s window, 10s cooldown): fire rate up, spread tighter while it holds.",
    flavorText: "Cast-weave fuel.",
    active: {
      kind: "overclock",
      cooldownMs: 10000,
      durationMs: 3000,
    },
    visual: visual("x", "#fde047"),
    unique: true,
  },
  {
    id: "measure",
    name: "Measure",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "wizard",
    role: "buff",
    description:
      "Active (9s cooldown): banks one free shot — your next shot costs no ammo. (v1: no mana system exists yet to refund — see doc.)",
    flavorText: "Information and confidence.",
    active: {
      kind: "measure",
      cooldownMs: 9000,
    },
    visual: visual("orb", "#e2e8f0"),
    unique: true,
  },
  {
    id: "slip-node",
    name: "Slip Node",
    category: "ability",
    rarity: "rare",
    buckets: ["ability"],
    essenceCost: 6,
    classId: "wizard",
    role: "movement",
    description: "Active (6s cooldown): a short blink along your aim.",
    flavorText: "Reposition, not freeflow.",
    active: {
      kind: "slip-node",
      cooldownMs: 6000,
    },
    visual: visual("triangle", "#c4b5fd"),
    unique: true,
  },
  {
    id: "recoil-step",
    name: "Recoil Step",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "wizard",
    role: "movement",
    description:
      "Active (6s cooldown): hop opposite your aim on cast. (v1: no next-shot recoil discount yet — see doc.)",
    flavorText: "Micro-kiting, the geometrician's way.",
    active: {
      kind: "recoil-step",
      cooldownMs: 6000,
    },
    visual: visual("circle", "#fca5a5"),
    unique: true,
  },
];

export const prototypeCards = crystalRoundsCards;
