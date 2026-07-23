// Card definitions. Pure data. Lives in sim/ so the authoritative server and
// the prediction client resolve identical builds from the same card hand.
//
// IMPORTANT: do not import from Phaser, the DOM, Convex, or client/src/game/.
// This module must compile inside the Bun runtime.

import type { CardDefinition, ClassId } from "./cardTypes.js";
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
    description:
      "Hitscan beam: no travel time. Slightly less damage, softer kick — your aim is the only variable.",
    flavorText: "Light does not wait for permission.",
    modifier: {
      delivery: "raycast",
      damageMultiplier: 0.9,
      recoilMultiplier: 0.8,
      projectile: { rangePx: 880, impactRadiusPx: 12 },
    },
    visual: visual("bar", "#8ff8ff"),
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
    description: "Tighter, faster baseline shot — the clean default that asks only for your aim.",
    flavorText: "One shard. No excuses.",
    modifier: {
      delivery: "projectile",
      projectile: { shape: "hexagon", count: 1, speedMultiplier: 1.06 },
      damageMultiplier: 1.06,
    },
    visual: visual("hexagon", "#50e3c2"),
    unique: true,
  },
  // ── The five "shape" cards (design-axioms.md A7 rework, 2026-07-18) ──────
  // Jake's live playtest note, verbatim: "these suck ... shape swaps with
  // small dmg/speed/knockback tradeoffs ... think more distance too other
  // factors that are fun physics stuff." A7's mechanism names exactly why:
  // five cards ranking on the SAME axis (a shape reskin + a fractional stat
  // nudge) isn't five choices, it's one choice with four decoys — none of
  // them gave a player a REASON to pick it over the others beyond "slightly
  // bigger number." Rather than cut all five (crystalRoundsCards.length is
  // asserted >20 in cardFeel.test.ts, comfortably clear either way, and the
  // ids are read directly by cardGlyphs.ts/cardIcons.test.ts/round.test.ts —
  // safe to keep, cheap to redesign in place), each now OWNS a genuinely
  // orthogonal physics verb — the exact "fun physics stuff" list Jake named
  // (distance/range, speed profile) plus the pool's other underused axes
  // (knockback, size). Shape/name/id/visual are UNCHANGED (still cosmetic,
  // per A7 — "a shape change is cosmetic unless it's tied to a real
  // mechanical difference"); only the modifier payload changed, so nothing
  // that reads these ids by string (glyphs, the draft offer, save data)
  // breaks. Numbers are first-draft, per this session's discipline.
  {
    // RANGE axis, SHORT end. Committed close-range dart — the shot is
    // already there. Pairs with triangle-rounds (below) as the pool's first
    // explicit range-tradeoff DIAL: circle trades reach for immediacy,
    // triangle trades immediacy for reach. Was: "round shots fly faster and
    // sit a touch smaller" — a sub-5%-of-anything reskin with zero real
    // reason to exist next to crystal-volley's honest speed pick.
    id: "circle-rounds",
    name: "Circle Rounds",
    category: "projectile",
    rarity: "common",
    buckets: ["shape"],
    essenceCost: 1,
    description:
      "Short-fused rounds — much less range, but they're already there. Step in and end it before range matters.",
    flavorText: "Close is a choice.",
    modifier: {
      // Explicit (2026-07-20, true hitscan) — this card's whole identity is
      // a real distance CUT on a traveling shot; Wizard's own base weapon
      // is "raycast" now, whose applyDeliveryFeel floor (rangePx >= 880)
      // would otherwise silently OVERSHOOT this card's own 480px cut into a
      // longer range than the base weapon ever had. Pull delivery back to
      // a plain traveling shot so the cut actually lands.
      delivery: "projectile",
      projectileSpeedMultiplier: 1.1,
      projectile: { shape: "circle", rangePx: 480, sizeMultiplier: 0.92 },
    },
    visual: visual("circle", "#5eead4"),
    unique: true,
  },
  {
    // RANGE axis, LONG end. A slower, farther-reaching bolt that persists
    // (lifetimeMultiplier keeps it alive well past where a normal shot
    // would time out, so it's the range increase, not just a race against
    // the clock, doing the work) — the honest "poke" pick raycast-prism's
    // hitscan doesn't cover (this still travels, still can be dodged/
    // outran, just goes much farther before it gives up). Was: "pointy
    // crystals hit harder" — a flat damage/recoil trade indistinguishable
    // in FEEL from x-rounds' old damage/recoil trade one bucket over.
    id: "triangle-rounds",
    name: "Triangle Rounds",
    category: "projectile",
    rarity: "common",
    buckets: ["shape"],
    essenceCost: 1,
    description:
      "Long-hafted shards that cross the whole map. Slower off the hand — the far fight belongs to you.",
    flavorText: "Patience, sharpened.",
    modifier: {
      // Explicit (2026-07-20, true hitscan) — same reasoning as
      // circle-rounds above, mirrored: this card's own lifetimeMultiplier
      // (1.4, "persists longer") would otherwise be silently CAPPED DOWN to
      // 0.35 by Wizard's raycast base's applyDeliveryFeel bump, inverting
      // "reaches farther and persists longer" into the opposite. This card
      // is explicitly the still-travels, still-dodgeable poke — never
      // hitscan (see the doc comment above).
      delivery: "projectile",
      projectileSpeedMultiplier: 0.95,
      projectile: { shape: "triangle", rangePx: 1080, lifetimeMultiplier: 1.4 },
    },
    visual: visual("hexagon", "#fef08a"),
    unique: true,
  },
  {
    // KNOCKBACK-FEEL axis, sharpened into its dedicated owner. This card
    // already leaned here ("mass over manners", knockbackMultiplier 1.18)
    // more than any other card in the pool — the redesign just commits: the
    // shove goes up hard, speed goes down further to pay for it, and the
    // legacy damage-adjacent framing is dropped entirely so "knockback" is
    // unambiguously the reason to draft this over x-rounds (size) or any
    // damage-shape card. THE space-control / edgeguard pick.
    id: "square-rounds",
    name: "Square Rounds",
    category: "projectile",
    rarity: "uncommon",
    buckets: ["shape"],
    essenceCost: 2,
    description:
      "Heavy slabs, slow to arrive — massive knockback drives enemies off platforms and out of position.",
    flavorText: "Ground is taken, not given.",
    modifier: {
      projectileSpeedMultiplier: 0.8,
      knockbackMultiplier: 1.45,
      projectile: { shape: "square", sizeMultiplier: 1.3 },
    },
    visual: visual("square", "#c49a6c"),
    unique: true,
  },
  {
    // SIZE axis, dedicated owner. sizeMultiplier directly scales the live
    // collision/hit radius (weapon.ts: `radius = 7 * build.projectile.
    // sizeMultiplier`), not just the sprite — so "biggest standard round in
    // the pool" is a real hitbox claim, not a paint job. Deliberately pays
    // with fire-rate/speed instead of a knockback tax, so it reads as a
    // DIFFERENT reason than square-rounds' mass-and-shove identity even
    // though both grow the projectile: square = size+shove combo (a
    // brawler's card), x-rounds = size ALONE (a board-presence/harder-to-
    // dodge card, no shove). Was a flat damage+recoil trap this session's
    // earlier balance pass already flagged as "strictly boring" — this
    // supersedes that fix with a real orthogonal identity instead of a
    // bigger number (see weaponBuild.test.ts's updated assertion).
    id: "x-rounds",
    name: "X Rounds",
    category: "projectile",
    rarity: "uncommon",
    buckets: ["shape"],
    essenceCost: 2,
    description:
      "The biggest standard round in the pool: a wide X-cut slab, hard to miss, hard to dodge — slower to throw.",
    flavorText: "Presence is a weapon.",
    modifier: {
      fireRateMultiplier: 0.92,
      projectileSpeedMultiplier: 0.9,
      projectile: { shape: "x", sizeMultiplier: 1.55 },
    },
    visual: visual("x", "#fca5a5"),
    unique: true,
  },
  {
    // SPEED-PROFILE axis — brand new to the pool. Uses `pathing:
    // "accelerate"` (projectile.ts's own case, Zig's applyAcceleratePathing/
    // step_projectile_v2, gen_card_data.ts's proj_acceleration_mul_set):
    // fully wired end-to-end since this field was added, but never actually
    // usable by any card until this pass fixed weaponBuild.ts's
    // mergeProjectileModifier (accelerationMultiplier was being merged
    // MULTIPLICATIVELY against a base of 0 — 0 × anything is always 0, so
    // no card could ever set it; see that function's own comment). The read:
    // launches BELOW normal speed and ramps up the longer it flies — the
    // literal opposite feel of every other card in the pool (which are all
    // instant-speed, decaying-relevance-with-distance). Rewards long
    // sightlines and patience over point-blank spam; pairs naturally with
    // triangle-rounds' long range. Falling Star (new card, below) is this
    // card's mirror-image (decelerate instead of accelerate).
    id: "i-rounds",
    name: "I Rounds",
    category: "projectile",
    rarity: "uncommon",
    buckets: ["shape", "trajectory"],
    essenceCost: 2,
    description:
      "Slow off the hand, these bar-crystals build speed the longer they fly. Lead less at range, more up close.",
    flavorText: "Momentum is earned in flight.",
    modifier: {
      // Explicit (2026-07-20, true hitscan) — "accelerate" pathing needs
      // real travel time to ramp up; Wizard/Ninja's own base weapon is
      // "raycast" now, and a same-tick shot has no distance to accelerate
      // across. This card's whole identity (launches slow, builds speed) is
      // meaningless without a real flight, so pull delivery back to a
      // traveling shot.
      delivery: "projectile",
      projectileSpeedMultiplier: 0.78,
      projectile: { shape: "bar", pathing: "accelerate", accelerationMultiplier: 1.4, lifetimeMultiplier: 1.15 },
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
    description:
      "Heavy orbs loosed in a two-shot burst. Slower flight, huge presence — built to rule the close fight.",
    flavorText: "Once to open. Once to end.",
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
    description:
      "Hold to pour an unending beam. Lower per-tick damage — ceaseless pressure, ceaseless light.",
    flavorText: "Your will, unbroken.",
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
    // Split-cluster audit (design-axioms.md A7, 2026-07-18 — Jake: "the ones
    // split WAAAAAAAAAAAAAY TO MUCH ... its like the only gimmick"): of the
    // 11 quantity-bucket cards flagged, this one already had a REAL
    // orthogonal hook underneath the "more pellets" surface — the explicit
    // rangePx: 390 cut nobody else in the quantity bucket had. Kept and
    // sharpened rather than cut: its reason to exist isn't "5 pellets," it's
    // RANGE (the close-quarters shotgun that trades reach for density) —
    // the same axis circle-rounds now owns at common tier, expressed here
    // as a full weapon replacement instead of a single-dart nudge.
    id: "shard-bloom",
    name: "Shard Bloom",
    category: "weapon",
    rarity: "rare",
    buckets: ["quantity"],
    essenceCost: 5,
    description:
      "Your pulse wave becomes a close shard burst. Severe range cut — devastating up close, nothing at range.",
    flavorText: "Step in. Give everything.",
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
      // Explicit (2026-07-20, true hitscan) — "gravity" pathing arcs over
      // multiple ticks; a same-tick hitscan ray is always a straight line
      // with zero flight time, so there's no arc to lob over cover with.
      // Pull delivery back to a traveling shot so the lob actually happens.
      delivery: "projectile",
      projectileSpeedMultiplier: 0.86,
      projectile: { pathing: "gravity", gravityScale: 560 },
    },
    visual: visual("hexagon", "#ffd166"),
  },
  {
    // NEW CARD (design-axioms.md A7 / A2, 2026-07-18 physics-axis pass).
    // Gravity/arc was a single-owner axis before this pass (arc-shards, a
    // GENTLE lob for clearing ledges — 560 gravity scale, below even the
    // sim's own unset-default of 1450, GRAVITY_PATHING_ACCEL_DEFAULT in
    // projectile.ts/weapon_build.zig). This is the axis's other extreme: a
    // true mortar — much steeper drop than the default, paid for with a
    // real payload (explosive impact) rather than just being "arc-shards
    // but more." Distinct FEEL, not a bigger number on the same read:
    // arc-shards pokes over cover and keeps flying; this drops dead-center
    // and detonates. No new sim mechanic — reuses the existing "gravity"
    // pathing + "explosive" impact substrate exactly as molten-core/
    // explosive-facet already do, per this task's own steering to scope
    // down to what the projectile substrate already supports.
    id: "deadfall-mortar",
    name: "Deadfall Mortar",
    category: "projectile",
    rarity: "rare",
    buckets: ["trajectory", "impact"],
    essenceCost: 4,
    description:
      "A true lob: steep drop, heavy blast. Arc it over cover and walls — the landing does the rest.",
    flavorText: "Send it high. Trust the fall.",
    modifier: {
      // Explicit (2026-07-20, true hitscan) — same reasoning as arc-shards:
      // "gravity" pathing needs real flight time to drop, which a same-tick
      // hitscan ray never has. Falls back to a traveling shot; its
      // explosive impact then rides along for free via the existing
      // real-projectile impact path (no separate hitscan-explosive work
      // needed for this specific card).
      delivery: "projectile",
      projectileSpeedMultiplier: 0.6,
      fireRateMultiplier: 0.8,
      projectile: {
        pathing: "gravity",
        gravityScale: 2100,
        impact: "explosive",
        impactRadiusPx: 82,
        sizeMultiplier: 1.15,
      },
    },
    visual: visual("orb", "#fb923c"),
    unique: true,
  },
  {
    id: "seeker-facets",
    name: "Seeker Facets",
    category: "projectile",
    rarity: "rare",
    buckets: ["trajectory"],
    essenceCost: 4,
    description:
      "Your main shot homes toward the nearest foe, turn rate capped. Aim still rules — it assists, not replaces.",
    flavorText: "It seeks what you intend.",
    modifier: {
      // Explicit (2026-07-20, true hitscan) — homing needs real travel time
      // to curve; Wizard's own base weapon is "raycast" now, so without
      // this the card would silently do nothing (weaponBuild.ts's
      // applyCard guard lets a card's "projectile" win over the untouched
      // base default, same as Crystal Volley/Shard Bloom already rely on).
      delivery: "projectile",
      projectileSpeedMultiplier: 0.82,
      projectile: { pathing: "homing", homingStrength: 4.4 },
      projectileHomingStrengthAdd: 1.2,
    },
    // Wizard expression = docs/card-pool-v2.md "Grudge" (universal spec,
    // reborn from this exact card — same 4.4 rad/s figure). Grudge's spec
    // is the capped-turn homing seeker-facets already ships PLUS the −10%
    // damage the redesign prices it at ("assists, never auto-wins" costs
    // something). Ninja has no entry yet (its Grudge reading — bent slash
    // waves — needs the melee/wave verb; classes-goal.md P2 territory) so
    // it falls back to the class-blind modifier above, unchanged.
    //
    // Paladin expression = card-pool-v2.md's own line: "(melee can't
    // home) — arc forgiveness instead" — Kindled Edge doesn't read a
    // homing field at all (it's a swing, not a shot), so a literal port
    // is impossible; this card's only LIVE consumer for Paladin is the
    // Unveiling ultimate's composed Emission (resolveEmission reads
    // build.projectile.homingStrength directly — 0.2/2.5's verified
    // wiring, emissionClassAware.test.ts). Reading chosen: the ultimate
    // does NOT seek — "arc forgiveness" reframed as "the paladin doesn't
    // need to track, the field claims the space instead" (heaven-tank
    // flood, not a homing storm) — a real, testable, class-true
    // difference from Wizard's seeking cast, with no damage tax since
    // Paladin isn't gaining anything to pay for.
    //
    // Priest expression = card-pool-v2.md's own line: "bolts seek enemies
    // AND heals seek allies — dual homing, the full shepherd read" —
    // "heals seek allies" needs a homing HEAL projectile type that doesn't
    // exist (out of this chunk's field budget, same "no entry" gap Ninja's
    // wave-homing has above); the honest LIVE half is the enemy-seeking
    // bolt, which this session's low-aim design direction (Jake,
    // 2026-07-18: "tendrils that ooze out and self guide to its correct
    // destination... less about aiming with the priest") makes a MUCH
    // better fit for Priest than for Wizard — so Priest gets the homing
    // WITHOUT Wizard's −10% damage tax (the tax exists to price "assists,
    // never auto-wins" as a bonus on TOP of an aim-first kit; for Priest,
    // self-guiding IS the kit, not an add-on, so it isn't priced as one).
    // NOTE on homingStrength: weaponBuild.ts hard-clamps
    // `projectile.homingStrength` to a 2.5 ceiling at resolve time (its own
    // tail-clamp pass) — ANY value ≥2.5 on the card (Wizard's 4.4 included)
    // resolves identically post-clamp, so a bigger raw number here would be
    // a fictional, untestable "difference." The REAL, testable Priest
    // differentiator is projectileSpeedMultiplier: Wizard pays 0.82 (the
    // class-blind default) on top of the damage tax; Priest pays neither —
    // full 0.9 travel speed AND no damage cut, since the shot finds its own
    // way instead of needing careful tracking to justify the tax.
    classModifiers: {
      wizard: {
        // Explicit (2026-07-20, true hitscan) — classModifiers REPLACES the
        // top-level `modifier` wholesale (this file's own documented
        // convention), so the top-level modifier's own `delivery:
        // "projectile"` (added for the class-blind/Ninja reading) does NOT
        // carry over here; homing needs real travel time to curve, and
        // Wizard's own base weapon is "raycast" now, so this needs its own
        // override or the card silently does nothing for Wizard.
        delivery: "projectile",
        projectileSpeedMultiplier: 0.82,
        damageMultiplier: 0.9,
        projectile: { pathing: "homing", homingStrength: 4.4 },
        projectileHomingStrengthAdd: 1.2,
      },
      paladin: {
        projectile: { pathing: "straight", homingStrength: 0 },
        projectileHomingStrengthAdd: 0,
      },
      priest: {
        // Explicit (2026-07-20, true hitscan) — defensive, same reasoning
        // as the wizard variant above: classModifiers REPLACES the
        // top-level modifier wholesale, so this variant needs its own
        // delivery override too. Harmless today (Priest's own base weapon
        // is already "projectile", never raycast), but cheap and correct to
        // close now rather than leave a latent gap for whenever that
        // changes.
        delivery: "projectile",
        projectileSpeedMultiplier: 0.9,
        projectile: { pathing: "homing", homingStrength: 4.4 },
        projectileHomingStrengthAdd: 1.2,
      },
    },
    visual: visual("x", "#f0abfc"),
    maxStacks: 4,
  },
  {
    // Split-cluster audit: kept as the pool's ONE accessible homing-swarm
    // entry (uncommon tier). magnet-spray (cut, see below) and homing-
    // cluster (kept, legendary) were the same "more homing pellets, less
    // damage each" lever at three different price points — a rarity ladder
    // on ONE axis, not three choices (A7). This is the affordable rung;
    // homing-cluster is the legendary capstone that COMBINES this axis with
    // raw count (a legitimate legendary pattern — "reward for holding two
    // ideas at once" — rather than a fourth reskin of the same idea).
    id: "micro-seekers",
    name: "Micro Seekers",
    category: "projectile",
    rarity: "uncommon",
    buckets: ["trajectory", "quantity"],
    essenceCost: 3,
    description: "Extra tiny homing shards peel into the fight. Strongest against many foes.",
    flavorText: "Small. Tireless. Yours.",
    modifier: {
      // Explicit (2026-07-20, true hitscan) — homing needs real travel time
      // to curve toward a target; Wizard/Ninja's own base weapon is
      // "raycast" now, so without this the card silently does nothing (same
      // gap Seeker Facets had before its own fix).
      delivery: "projectile",
      damageMultiplier: 0.78,
      projectileSpeedMultiplier: 0.9,
      spreadRadiansAdd: degrees(16),
      projectileCountAdd: 2,
      projectileHomingStrengthAdd: 0.9,
      projectile: { pathing: "homing", homingStrength: 3.2, sizeMultiplier: 0.74 },
    },
    visual: visual("circle", "#f5d0fe"),
    maxStacks: 5,
  },
  // magnet-spray CUT (design-axioms.md A7, 2026-07-18 split-cluster audit):
  // sat directly between micro-seekers (uncommon) and homing-cluster
  // (legendary) doing the exact same "more homing pellets, less damage,
  // wider spread" lever with no hook of its own — the textbook A7 violation
  // ("a card that's a weaker version of another isn't a choice"). Not
  // referenced by tutorial-song.ts's scripted sequence or any test beyond
  // its own glyph case (removed from cardGlyphs.ts) — safe, clean cut per
  // A2 ("ship the missing feature, never the broken one" — permission to
  // cut aggressively).
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
      // Explicit (2026-07-20, true hitscan) — bouncing off a wall and
      // continuing needs a real multi-tick flight (reflect, keep traveling,
      // re-check contact); a same-tick hitscan ray has no second tick to
      // bounce into. Nothing salvageable at the bounce point itself for a
      // hitscan reading, so this pulls delivery back to a traveling shot.
      delivery: "projectile",
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
    description:
      "+1 ricochet on everything you fire. Stacks — every surface becomes another angle.",
    flavorText: "Another angle earned.",
    modifier: {
      // Explicit (2026-07-20, true hitscan) — same reasoning as Bouncy
      // Prism: bounce needs real multi-tick flight, which a same-tick
      // hitscan ray never has.
      delivery: "projectile",
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
    description:
      "Past half range, your shots turn and come home. Catch retreats; punish anyone who hunts your heels.",
    flavorText: "What leaves your hand comes home keener.",
    modifier: {
      // Explicit (2026-07-20, true hitscan) — curling home after half range
      // needs the shot to actually travel there first; a same-tick hitscan
      // ray never has a "half range" moment to curl at.
      delivery: "projectile",
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
    // NEW CARD (design-axioms.md A7 / A2, 2026-07-18 physics-axis pass).
    // Speed-profile axis, decelerate end — the mirror image of i-rounds'
    // ramp-up read (above): launches WAY above normal speed and burns off
    // fast (pathing: "accelerate" with a NEGATIVE accelerationMultiplier —
    // same substrate, opposite sign, genuinely different play pattern: a
    // front-loaded burst that rewards point-blank commits and punishes a
    // miss, versus i-rounds' patient long-sightline read). +X Velocity
    // (above) already owns "uniformly faster" as a flat, honest common
    // pick; this owns the TIME-VARYING version of speed — a new axis, not
    // a bigger number on X Velocity's existing one. Requires the same
    // weaponBuild.ts accelerationMultiplier merge fix as i-rounds (see that
    // card's comment and mergeProjectileModifier's own note).
    id: "falling-star",
    name: "Falling Star",
    category: "projectile",
    rarity: "rare",
    buckets: ["trajectory"],
    essenceCost: 4,
    description:
      "Blistering point-blank speed that burns off fast. Everything up close, nothing at range — close in.",
    flavorText: "Spend it all where it counts.",
    modifier: {
      // Explicit (2026-07-20, true hitscan) — same reasoning as I Rounds:
      // "accelerate" pathing (even the negative/burn-off variant here) needs
      // real travel time to change speed across, which a same-tick hitscan
      // ray never has.
      delivery: "projectile",
      projectileSpeedMultiplier: 1.5,
      projectile: { pathing: "accelerate", accelerationMultiplier: -1.8, lifetimeMultiplier: 1.1 },
    },
    visual: visual("orb", "#fca5a5"),
    unique: true,
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
      // Explicit (2026-07-20, true hitscan) — "float" pathing (a lingering,
      // slow-drifting hang-time read) needs the shot to actually be in the
      // air for a while; a same-tick hitscan ray never has any airtime.
      delivery: "projectile",
      projectileSpeedMultiplier: 0.58,
      projectile: { pathing: "float", lifetimeMultiplier: 1.5, sizeMultiplier: 1.18 },
    },
    visual: visual("orb", "#a7f3d0"),
    unique: true,
  },
  // dual-splitter CUT (design-axioms.md A7, 2026-07-18 split-cluster audit).
  // This session's earlier balance pass already tried to save it (fire-rate
  // hook vs +1 Projectile) but it stayed a thin variation of the SAME "add
  // 1 pellet" lever one-more-shard (below) already owns at a cheaper cost —
  // exactly the A7 failure mode ("a weaker version of another isn't a
  // choice"). Not referenced by tutorial-song.ts; the one guarding test
  // (weaponBuild.test.ts's "dual-splitter no longer strictly loses to +1
  // Projectile") is removed with a comment explaining why, not silently
  // deleted — the trap it guarded against no longer exists because the
  // card doesn't either.
  {
    // Split-cluster audit: kept, REDESIGNED off pure count onto a real
    // second axis — bounce. Was "three-way fan, more pellets, less damage,"
    // functionally identical to wide-barrage (below) at a smaller spread
    // angle with no reason to prefer it once wide-barrage existed. Now: the
    // fan that also ricochets, an area-control tool that owns CORNERS
    // (bank shots off walls) where wide-barrage owns straight-line WIDTH —
    // genuinely different tactical use, not a smaller number. Kept (not
    // cut) because tutorial-song.ts's scripted boss encounter grants this
    // id by name (vessel-boss-cards-1) — the id/rarity/cost stay stable,
    // only the payload changed.
    id: "triple-fan",
    name: "Triple Fan",
    category: "weapon",
    rarity: "uncommon",
    buckets: ["quantity", "trajectory"],
    essenceCost: 3,
    description:
      "Three-way fan that also ricochets twice. Bank shots around corners — own the room, not just the lane.",
    flavorText: "The walls fight beside you.",
    modifier: {
      // Explicit (2026-07-20, true hitscan) — same reasoning as Bouncy
      // Prism/+1 Bounce: bank shots off a wall need real multi-tick flight,
      // which a same-tick hitscan ray never has.
      delivery: "projectile",
      damageMultiplier: 0.74,
      spreadRadiansAdd: degrees(16),
      projectileCountAdd: 2,
      projectile: { pathing: "bounce" },
      projectileBounceAdd: 2,
    },
    visual: visual("hexagon", "#38bdf8"),
    maxStacks: 4,
  },
  {
    // Split-cluster audit: kept, REDESIGNED onto SIZE+SPEED instead of pure
    // count. Was a near-duplicate of wide-barrage (same rare-adjacent
    // "more pellets, wide spread, less damage" shape at a different number)
    // — now owns "many tiny FAST fragments," a genuinely different read
    // (micro-shrapnel pressure at range) from shard-bloom's RANGE-cut burst
    // and wide-barrage's WIDTH-flood. Kept (not cut) because tutorial-
    // song.ts's scripted boss encounters grant this id by name twice
    // (vessel-boss-cards-2/3) — id/rarity/cost stable, payload changed.
    id: "five-shard-spray",
    name: "Five Shard Spray",
    category: "weapon",
    rarity: "rare",
    buckets: ["quantity"],
    essenceCost: 5,
    description:
      "Five tiny, fast fragments — hard to see, harder to dodge. Pressure at range, not just up close.",
    flavorText: "Five shards, one will.",
    modifier: {
      damageMultiplier: 0.6,
      fireRateMultiplier: 0.9,
      projectileSpeedMultiplier: 1.22,
      spreadRadiansAdd: degrees(20),
      projectileCountAdd: 4,
      projectile: { sizeMultiplier: 0.6 },
    },
    visual: visual("circle", "#67e8f9"),
    maxStacks: 2,
  },
  {
    // Split-cluster audit: kept UNCHANGED. This is the pool's honest "raw
    // pellet count" primitive — cheap, stackable to 8, no secondary axis
    // pretending to be one. A7 doesn't require every card to be exotic; it
    // requires each SURVIVING card to have a real reason to exist relative
    // to its neighbors, and "the cheap uncomplicated +1" is a legitimate
    // reason next to triple-fan's bounce, wide-barrage's width, and five-
    // shard-spray's size+speed — the baseline the others deviate from.
    id: "one-more-shard",
    name: "+1 Projectile",
    category: "weapon",
    rarity: "common",
    buckets: ["quantity"],
    essenceCost: 1,
    description: "+1 projectile to your pattern. Stacks with fans and splitters for denser fire.",
    flavorText: "You are more than you were.",
    modifier: {
      damageMultiplier: 0.94,
      spreadRadiansAdd: degrees(7),
      projectileCountAdd: 1,
    },
    visual: visual("circle", "#99f6e4"),
    maxStacks: 8,
  },
  {
    // Split-cluster audit: kept UNCHANGED — already the pool's clearest
    // "maximum spread width, flood a lane" identity (widest fan angle of
    // any quantity card), a real reason to exist next to triple-fan's now-
    // bounce-flavored narrower fan.
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
  // needle-hose CUT (design-axioms.md A7, 2026-07-18 split-cluster audit):
  // "add pellets + shrink shape" duplicated five-shard-spray's now-sharpened
  // size+speed identity while being strictly less committed to it (smaller
  // size cut, no speed gain), and its "chip damage while your core shot
  // lands" framing already belongs to needle-compressor (utility bucket,
  // fire-rate axis) — two cards named after the same idea, one real. Not
  // referenced by tutorial-song.ts or any test beyond its own glyph case
  // (removed from cardGlyphs.ts).
  {
    id: "orbiting-satellites",
    name: "Orbiting Satellites",
    category: "utility",
    rarity: "rare",
    buckets: ["quantity"],
    essenceCost: 5,
    description:
      "Two crystals orbit you, harrying any foe that strays close. Your hands stay free for the big shot.",
    flavorText: "What orbits you, fights for you.",
    modifier: {
      orbitingSatellites: 2,
      fireRateMultiplier: 1.12,
    },
    visual: visual("orb", "#93c5fd"),
    unique: true,
  },
  {
    // Split-cluster audit (design-axioms.md A7, 2026-07-18): kept UNCHANGED
    // — the audit's own exemplar of a legitimate split-flavored card.
    // "Split ON IMPACT" (one shot, then children at the hit point) is a
    // mechanically different EVENT than "fires N pellets at the muzzle"
    // (every other quantity-bucket card above) — it rewards positioning a
    // single shot to land somewhere useful, not spray density. classModifiers
    // (wizard/paladin, both this session's earlier work) preserved exactly.
    id: "cluster-bomb",
    name: "Cluster Bomb",
    category: "projectile",
    rarity: "rare",
    buckets: ["quantity"],
    essenceCost: 5,
    description:
      "On first hit, your shot splits into six child shards. One opening blow claims the ground around it.",
    flavorText: "Struck true, one becomes many.",
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
    // ("playtest will move them"). Ninja/Priest readings (wave shatter,
    // heal motes) need melee/heal verbs that don't exist yet — no entry,
    // falls back to today's Cluster Bomb.
    //
    // Paladin expression = card-pool-v2.md's own line: "slam impacts throw
    // stone chips — his melee arc gains a ranged echo" — Kindled Edge has
    // no ranged rider to graft that onto (World.ts's own header comment:
    // "tighter arc, harder hit" is the whole verb, no ranged rider), so
    // this card's only LIVE consumer for Paladin is again the Unveiling
    // ultimate (resolveEmission reads build.projectile.sizeMultiplier for
    // the cast's blast radius). Reading chosen: FEWER, BIGGER stone chips
    // — heavier-tank flavor over Wizard's many-small-shards read — a real,
    // testable emission-radius difference (bigger radiusPx) for the same
    // fire-rate cost.
    classModifiers: {
      wizard: {
        fireRateMultiplier: 0.72,
        projectileSplitAdd: 3,
        projectile: { sizeMultiplier: 1.12 },
      },
      paladin: {
        fireRateMultiplier: 0.72,
        projectileSplitAdd: 2,
        projectile: { sizeMultiplier: 1.35 },
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
    description:
      "Every hit detonates in a prism burst. Splash scours packs and peels foes from soft cover.",
    flavorText: "Pressure in, radiance out.",
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
    description:
      "Shards stick to bodies and walls, glow, then burst. Plant your threat where the fight is going.",
    flavorText: "Your will waits where you left it.",
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
    description:
      "Your shot drives through three foes, shedding copies as it goes. Line up the pack; take them as one.",
    flavorText: "Draw one line through many.",
    modifier: {
      projectile: { impact: "pierce-chain", pierceCount: 3, splitCount: 2 },
    },
    visual: visual("bar", "#e879f9"),
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
    flavorText: "You were tempered hotter than this.",
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
    //
    // Paladin expression = card-pool-v2.md's own line: "the brand —
    // burning enemies take +10% from paladin melee" — no amp-vs-burning
    // field exists on Kindled Edge (out of this chunk's field budget), so
    // this card's only LIVE consumer for Paladin is the Unveiling
    // ultimate's composed Emission (resolveEmission reads
    // build.projectile.impactRadiusPx for the cast's impact size — verified
    // wiring, emissionClassAware.test.ts). Reading chosen: a heavier ground
    // fire pool (bigger impactRadiusPx than Wizard's textbook 42) — "the
    // brand" reads as more ground claimed, not more damage, matching
    // heaven-tank's settled-field identity — a real, testable difference.
    classModifiers: {
      wizard: {
        projectile: { element: "fire", impactRadiusPx: 42 },
      },
      paladin: {
        projectile: { element: "fire", impactRadiusPx: 58 },
      },
    },
    visual: visual("orb", "#ff7a18"),
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
    //
    // Paladin expression = card-pool-v2.md's own line: "frost brand —
    // chilled enemies deal −10% damage" — no damage-dealt-reduction field
    // exists yet (out of this chunk's field budget), so this card's only
    // LIVE consumer for Paladin is again the Unveiling ultimate
    // (resolveEmission reads build.projectile.slowMultiplier straight
    // through). Reading chosen: a STRONGER slow than Wizard's textbook
    // 0.68 — "the weight of law" (card-pool-v2.md's own Undertow-Paladin
    // phrase, borrowed here for the same frost-lineage flavor) — a real,
    // testable difference.
    classModifiers: {
      wizard: {
        projectile: { element: "ice", impact: "slow-field", slowMultiplier: 0.68 },
      },
      paladin: {
        projectile: { element: "ice", impact: "slow-field", slowMultiplier: 0.55 },
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
    description:
      "Lightning: pierces and arcs to a nearby target. The more they gather, the more you reach.",
    flavorText: "The crystal kept the storm.",
    modifier: {
      projectileSpeedMultiplier: 1.08,
      projectile: { element: "lightning", impact: "pierce-chain", pierceCount: 1 },
    },
    visual: visual("x", "#fef08a"),
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
    description:
      "Void: ignores held shields and pierces two. Their cover and their numbers both give way.",
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
    description: "Radiant: high damage, blinding white hit flash. Strength that hides nothing.",
    flavorText: "A small sun, and it is yours.",
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
    description:
      "Faster fire, softer recoil, thinner faster needles. Tempo you can see; trades you can win.",
    flavorText: "The bent path arrives first.",
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
    description: "Higher rate of fire, smaller shots. Sustain the pressure — aim still matters.",
    flavorText: "A hundred needles, one will.",
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
    flavorText: "Patience, given mass.",
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
    description:
      "Bigger mag, faster reload, fatter crystal cores. Stay in the fight — shots look charged.",
    flavorText: "The well is deep. Draw again.",
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
    flavorText: "You are more than you were.",
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
    // Ninja/Priest per-class lines (105/120 max health) are the SAME +20
    // add read against each chassis's different base HP — no distinct
    // mechanic to author, no entry, fall back to today's Crystal Plating.
    //
    // Paladin ships combat-ready this session (Kindled Edge/Ward,
    // class-overhaul-workboard.md chunks 2.1-2.3) — "125 → 145, the wall
    // gets taller" per card-pool-v2.md is the SAME +20 read (no distinct
    // HP value to author), but the move-speed COST is re-tuned lighter
    // than Wizard's (0.99 vs 0.97): a chassis that already accepts a slow
    // profile (0.88x base speed, classes-goal.md) barely notices more
    // plate, unlike a wizard whose mobility IS the build. Also bumps the
    // hex-core sizeMultiplier higher (1.2 vs 1.14) — the only other LIVE
    // consumer for Paladin is the Unveiling ultimate (resolveEmission
    // reads build.projectile.sizeMultiplier), so a heavier-plated cast
    // reads bigger too. Both are real, testable differences.
    classModifiers: {
      wizard: {
        maxHealthAdd: 20,
        moveSpeedMultiplier: 0.97,
        projectile: { shape: "hexagon", sizeMultiplier: 1.14, element: "crystal" },
      },
      paladin: {
        maxHealthAdd: 20,
        moveSpeedMultiplier: 0.99,
        projectile: { shape: "hexagon", sizeMultiplier: 1.2, element: "crystal" },
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
    description:
      "Your dash-bash arc widens — and shows on the shield shell. Slide-block and catch more angles.",
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
    description:
      "Shorter dash-bash cooldown — slide-guard more often. Snappier square cores mark your tempo.",
    flavorText: "Your no arrives sooner.",
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
    description:
      "You fire slower; each shot lands huge with wider impact — enough to pop platforms.",
    flavorText: "Patience, then thunder.",
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
    flavorText: "The whetstone answers.",
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
    description: "Explosive meets Radiant: a massive nova and a pure white flash. Rounds end here.",
    flavorText: "Every facet fires at once.",
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
    // Split-cluster audit: kept UNCHANGED as the legendary capstone of the
    // homing-swarm sub-axis (micro-seekers → cut magnet-spray → this) — a
    // legendary combining two ideas at once (homing + a fixed 3-fan) is a
    // legitimate reward pattern, not a fourth reskin of the same lever.
    id: "homing-cluster",
    name: "Homing Cluster",
    category: "projectile",
    rarity: "legendary",
    buckets: ["trajectory", "quantity"],
    essenceCost: 7,
    description:
      "Homing meets triple fan: three seekers curve onto the target. Loose them and move.",
    flavorText: "Three arcs. One answer.",
    modifier: {
      // Explicit (2026-07-20, true hitscan) — homing needs real travel time
      // to curve toward a target, same gap Seeker Facets/Micro Seekers had.
      delivery: "projectile",
      damageMultiplier: 0.78,
      projectileSpeedMultiplier: 0.82,
      spreadRadians: degrees(28),
      projectile: { count: 3, pathing: "homing", homingStrength: 5.2 },
    },
    visual: visual("hexagon", "#f0abfc"),
    unique: true,
  },
  {
    id: "sticky-ray",
    name: "Sticky Ray",
    category: "weapon",
    rarity: "legendary",
    buckets: ["delivery", "impact"],
    essenceCost: 7,
    description:
      "A hitscan ray that paints sticky crystal where it lands; each burst arrives a beat late.",
    flavorText: "The crystal keeps your word.",
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
    description:
      "Move much faster on ground and in air. Outrun their peeks; claim the high ground first.",
    flavorText: "Speed chooses the ground.",
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
    description:
      "Gravity loosens its hold on you: floatier jumps, longer hang for wall routes and aim windows.",
    flavorText: "Falling as a choice.",
    modifier: { gravityMultiplier: 0.74 },
    visual: visual("orb", "#a5f3fc"),
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
    // difference — the redesign's stat, not a placeholder. Ninja/Priest
    // per-class flavor is pure re-description of the same numbers for
    // those chassis — still deferred (no entry), fall back to today's
    // Spring Heel unchanged.
    //
    // Paladin expression = card-pool-v2.md's own line: "the slam class
    // gets to pick higher places to arrive from" — re-tuned LOWER jump,
    // HIGHER wall-jump than Wizard's flat +10%/+10% (jumpMultiplier 1.04,
    // wallJumpMultiplier 1.14): a heaven-tank prioritizes wall-plant
    // routes over airtime ("less freeflow, more wall presence" — the same
    // reasoning World.ts's EDGE_RANGE doc comment gives for Kindled Edge's
    // own "committed, not forgiving" numbers). A real, tested, DIFFERENT
    // split from Wizard's, not a re-description of the same pair.
    classModifiers: {
      wizard: { jumpMultiplier: 1.1, wallJumpMultiplier: 1.1 },
      paladin: { jumpMultiplier: 1.04, wallJumpMultiplier: 1.14 },
    },
    visual: visual("hexagon", "#5eead4"),
    maxStacks: 2,
  },
  {
    id: "gecko-grip",
    name: "Gecko Grip",
    category: "movement",
    rarity: "uncommon",
    buckets: ["utility"],
    essenceCost: 3,
    description: "Sticky wall-slide — cling and reset. The vertical belongs to you.",
    flavorText: "Where they fall, you hold.",
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
    flavorText: "Rise, and rise again.",
    modifier: { airJumpsAdd: 1 },
    // Wizard expression = docs/card-pool-v2.md "Second Wind" (universal
    // passive — same name AND same +1 air jump this card already ships;
    // "a glyph flickers underfoot" is pure visual-read flavor, zero
    // mechanical change). Override intentionally identical to the class-
    // blind modifier — real authored content, zero numeric change.
    //
    // Paladin expression (class-overhaul-workboard.md chunk 2.6 fast-follow,
    // 2026-07-18) = docs/card-pool-v2.md's "stomp-jump": "his air jump
    // deals 6 damage in a 70px ring beneath him (arriving twice)" — now
    // REAL, not a cosmetic-only override like Wizard's glyph-flicker. The
    // substrate the original pass said this needed ("a damage-on-landing
    // field") turned out unnecessary: World.ts already tracks
    // `mem.airJumpsUsed` before/after `stepPlayer` (the exact signal the
    // ninja wall-kick energy grant reads) — comparing it catches "an air
    // jump was just consumed THIS tick" precisely, no heuristic, no new
    // PlayerEntity field. The ring fires at the moment of the AIR jump
    // itself (the departure, matching "his air jump deals damage" literally
    // — not a landing event, despite the card's own name), gated on both
    // classId === "paladin" AND this card actually being equipped
    // (`entity.cards.includes("double-jump")`), so a paladin without the
    // card never sees the ring even though `airJumpsAdd` alone wouldn't be
    // true for them anyway (no card, no extra air jump, no trigger).
    //
    // Ninja's wall-kick-chain combo and Priest's self-cleanse-on-jump remain
    // deferred (still need substrate this pass doesn't build: a chained-
    // wall-kick counter, and a "cleanse one slow" status-removal hook) — no
    // entry for either, falls back to today's Second Wind for those two
    // classes, same honest-partial discipline as every other recorded
    // deferral this session.
    classModifiers: {
      wizard: { airJumpsAdd: 1 },
      paladin: { airJumpsAdd: 1 },
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
    description:
      "Much larger shield reserve. Hold your block through longer volleys before it breaks.",
    flavorText: "Their storm breaks on you.",
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
    description:
      "Shield recharges much faster between blocks. Peek safely and re-engage, again and again.",
    flavorText: "Ready again before they are.",
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
    description:
      "Your shield holds only where you aim — but that frontal wall is vast. Face what you would stop.",
    flavorText: "Mean the angle.",
    modifier: { directionalShield: true, shieldChargeMultiplier: 2.2 },
    visual: visual("square", "#7ec8e3"),
    unique: true,
  },
  {
    id: "riot-mirror",
    name: "Riot Mirror",
    category: "defense",
    rarity: "legendary",
    buckets: ["utility"],
    essenceCost: 6,
    description:
      "Aimed reflect wall with a heavy charge: face what fires and its shots fly back to their source.",
    flavorText: "Meet it. Turn it. Return it.",
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
    description:
      "Each blocked hit stores a lock (max 2). Your next shot spends one to loose a weaker homing bolt.",
    flavorText: "What bit you now hunts for you.",
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
    visual: visual("x", "#a78bfa"),
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
    description:
      "Active (3s, 14s cooldown): your shots tithe half the damage they deal back to you as health.",
    flavorText: "Strike, and be restored.",
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
    description:
      "Active (9s cooldown): blink toward your aim — pass through walls, but you cannot land inside one.",
    flavorText: "The space between spaces opens for you.",
    active: {
      kind: "shadow-step",
      cooldownMs: 9000,
    },
    visual: visual("bar", "#7dd3fc"),
    unique: true,
  },
  {
    id: "veil-of-nought",
    name: "Veil of Nought",
    category: "ability",
    rarity: "legendary",
    buckets: ["ability"],
    essenceCost: 7,
    description:
      "Active (1.5s, 16s cooldown): become untraceable — homing and satellites lose you; firing ends it early.",
    flavorText: "The archons cannot strike what is not.",
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
      "Active (0.7s window, 7s cooldown): your shots strike at 1.6x damage while it holds.",
    flavorText: "A moment of sun, honed to a point.",
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
    visual: visual("x", "#f472b6"),
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
    description:
      "Active (9s cooldown): a cone of crystal force erupts from your aim, striking everyone caught in it at once.",
    flavorText: "Split the light; every ray still cuts.",
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
      "Active (9s cooldown): a crystal lattice plane settles around you, damaging all standing in it for a few seconds.",
    flavorText: "Where you stand, structure follows.",
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
      "Active (10s cooldown): an instant tick of shield charge.",
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
      "Active (0.6s window, 9s cooldown): halves incoming gunfire. Melee, ability blasts, and burn ticks pass through.",
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
    flavorText: "Three seconds of more than you were.",
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
      "Active (0.7s window, 9s cooldown): shots fired go dead-center with a damage amp.",
    flavorText: "The true line, drawn once.",
    active: {
      kind: "measure",
      cooldownMs: 9000,
      durationMs: 700,
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
    flavorText: "Space bends for the one who studied it.",
    active: {
      kind: "slip-node",
      cooldownMs: 6000,
    },
    visual: visual("bar", "#c4b5fd"),
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
      "Active (6s cooldown): hop opposite your aim; shots you fire in the next 1.2s barely push you around.",
    flavorText: "Every step back is drawn, not driven.",
    active: {
      kind: "recoil-step",
      cooldownMs: 6000,
      durationMs: 1200,
    },
    visual: visual("circle", "#fca5a5"),
    unique: true,
  },
  // ── Kindled catalog v1 (docs/class-ability-catalogs-v1.md) ──────────────
  // classId: "paladin" — offer-roll gated (round.ts enterDrafting); every
  // other chassis sees zero of these. All 10 of the doc's 10 are wired as of
  // the class-overhaul-workboard.md chunk 2.6 fast-follow (2026-07-18) — the
  // original pass shipped 7 (below); Retribution Edge, Shock Ring, and Rally
  // Light (previously deferred) are further down this block, after
  // Plant Charge. Gold-forward visual family (classes-goal.md: "Gold-forward
  // combat kit unlocked" — the one chassis where gold reads as combat, not
  // house/cosmetic tier).
  {
    id: "bastion-pulse",
    name: "Bastion Pulse",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "paladin",
    role: "defense",
    description:
      "Active (8s cooldown): an instant shield-charge tick — doubled if Ward is actively held.",
    flavorText: "Hold the line, and the line holds you.",
    active: {
      kind: "bastion-pulse",
      cooldownMs: 8000,
    },
    visual: visual("hexagon", "#fbbf24"),
    unique: true,
  },
  {
    id: "sunspike",
    name: "Sunspike",
    category: "ability",
    rarity: "rare",
    buckets: ["ability"],
    essenceCost: 6,
    classId: "paladin",
    role: "single",
    description:
      "Active (7s cooldown): a fast aimed thrust — one narrow, short-range hit. High single-target damage.",
    flavorText: "All of dawn, driven through one point.",
    active: {
      kind: "sunspike",
      cooldownMs: 7000,
    },
    visual: visual("bar", "#f59e0b"),
    unique: true,
  },
  {
    id: "judgment-line",
    name: "Judgment Line",
    category: "ability",
    rarity: "rare",
    buckets: ["ability"],
    essenceCost: 6,
    classId: "paladin",
    role: "single",
    description:
      "Active (3s mark, 8s cooldown): mark the nearest foe in your aim cone; Kindled Edge hits on them are amplified.",
    flavorText: "Choose your whetstone, and meet it.",
    active: {
      kind: "judgment-line",
      cooldownMs: 8000,
      durationMs: 3000,
    },
    visual: visual("x", "#fcd34d"),
    unique: true,
  },
  {
    id: "unbroken-seal",
    name: "Unbroken Seal",
    category: "ability",
    rarity: "rare",
    buckets: ["ability"],
    essenceCost: 6,
    classId: "paladin",
    role: "offense",
    description:
      "Active (5s window, 7s cooldown): your next landed Kindled Edge hit is amplified and staggers the foe.",
    flavorText: "Everything you are, behind one blow.",
    active: {
      kind: "unbroken-seal",
      cooldownMs: 7000,
      durationMs: 5000,
    },
    visual: visual("square", "#eab308"),
    unique: true,
  },
  // Consecrated Field (aoe, self-light zone) was cut 2026-07-19 — see
  // docs/class-ability-catalogs-v1.md's 12→10 cut note: redundant with
  // Shock Ring below (both are "AOE damage zone near yourself"), and
  // Shock Ring reads as more central to the class's heaven-tank identity.
  {
    id: "aegis-share",
    name: "Aegis Share",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "paladin",
    role: "defense",
    description:
      "Active (3s window, 8s cooldown): Kindled Ward reaches further for allies; no ally near, gain Kindling instead.",
    flavorText: "Your shield was always wide enough for two.",
    active: {
      kind: "aegis-share",
      cooldownMs: 8000,
      durationMs: 3000,
    },
    visual: visual("circle", "#d97706"),
    unique: true,
  },
  {
    id: "plant-charge",
    name: "Plant Charge",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "paladin",
    role: "movement",
    description:
      "Active (6s cooldown): a short charge that ends in a Ward-ready stance and tips your shield charge up.",
    flavorText: "Charge, plant, become the wall.",
    active: {
      kind: "plant-charge",
      cooldownMs: 6000,
    },
    visual: visual("square", "#facc15"),
    unique: true,
  },
  // ── Kindled catalog v1 fast-follow (class-overhaul-workboard.md chunk
  // 2.6, 2026-07-18) — originally 3 abilities the earlier pass deferred,
  // now wired; Retribution Edge (offense) was one of the 3 but was cut
  // 2026-07-19 (see docs/class-ability-catalogs-v1.md's 12→10 cut note)
  // rather than fixed — it carried an unaddressed self-fueling-loop brake
  // gap flagged in docs/axiom-deviations-audit.md that removal sidesteps.
  // Same classId gate, same gold-forward visual family as the 7 above.
  {
    id: "shock-ring",
    name: "Shock Ring",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "paladin",
    role: "aoe",
    description:
      "Active (9s cooldown): a modest hop, then a slam shock on landing. Claim the ground you take.",
    flavorText: "Ground that answers when you arrive.",
    active: {
      kind: "shock-ring",
      cooldownMs: 9000,
      durationMs: 1500,
    },
    visual: visual("hexagon", "#fb923c"),
    unique: true,
  },
  {
    id: "rally-light",
    name: "Rally Light",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "paladin",
    role: "buff",
    description:
      "Active (5s window, 9s cooldown): allies near you — yourself included, even alone — fight harder, move quicker.",
    flavorText: "Stand with me. That's the whole shield.",
    active: {
      kind: "rally-light",
      cooldownMs: 9000,
      durationMs: 5000,
    },
    visual: visual("circle", "#fdba74"),
    unique: true,
  },
  // ── Kindled coverage-floor + solo-viability fast-follow (docs/axiom-
  // deviations-audit.md "Kindled (paladin) — two structural gaps",
  // 2026-07-18). The catalog's 2nd buff and 2nd movement — closes the
  // ≥2-per-role floor (docs/classes-goal.md), grows Kindled to 12/12
  // (still inside the locked 8-12 catalog-size range) rather than
  // replacing two of the existing 10. See constants.ts's KIN_KINDLED_
  // RESOLVE_*/KIN_BULWARK_STEP_* header comments for the full design.
  // NOTE 2026-07-19: Kindled was cut back to 10/10 the same week by
  // removing Retribution Edge (offense) and Consecrated Field (aoe) —
  // see docs/class-ability-catalogs-v1.md's cut note. Kindled Resolve and
  // Bulwark Step stay; buff/movement are untouched by that cut.
  {
    id: "kindled-resolve",
    name: "Kindled Resolve",
    category: "ability",
    rarity: "rare",
    buckets: ["ability"],
    essenceCost: 6,
    classId: "paladin",
    role: "buff",
    description:
      "Active (4s window, 12s cooldown): spend 40 Kindling — resist stagger, hit a little harder. None banked, no effect.",
    flavorText: "Spend the block. Keep the line.",
    active: {
      kind: "kindled-resolve",
      cooldownMs: 12000,
      durationMs: 4000,
    },
    visual: visual("hexagon", "#fcd34d"),
    unique: true,
  },
  {
    id: "bulwark-step",
    name: "Bulwark Step",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "paladin",
    role: "movement",
    description:
      "Active (4s cooldown): a quick lateral shuffle in whatever direction you're already walking — your Ward never drops.",
    flavorText: "Feet move. The wall doesn't.",
    active: {
      kind: "bulwark-step",
      cooldownMs: 4000,
    },
    visual: visual("square", "#fde68a"),
    unique: true,
  },
  // Crater/Retort/Bastion (docs/card-pool-v2.md #26-28, "the 3 Paladin
  // exclusives") were cut entirely 2026-07-19 — a genuine removal, not a
  // deferral, same discipline as Retribution Edge/Consecrated Field above.
  // They were meant to be a SEPARATE draft-pool system (picked at round
  // end, not the loadout station), but were actually classId:"paladin"-
  // gated like every rack ability, so `catalogForClass("paladin")` — the
  // loadout station's own full-catalog query — surfaced all 3 alongside
  // the real 10-ability rack, showing 13 cards in one undifferentiated
  // grid (Jake, live playtest: the station should show a true 10, matching
  // Wizard/Ninja/Priest, not a class-specific "bonus picks" mechanic).
  // Removed here plus their AbilityKind union entry (cardTypes.ts), sim
  // effects (World.ts's applyBastionAura/crater case/crater landing hook,
  // combat.ts's Retort bank), constants.ts's KIN_CRATER_*/KIN_RETORT_*/
  // KIN_BASTION_* (aura) group, and every test referencing them.
  // ── Syzygist catalog v1 (docs/class-ability-catalogs-v1.md) — the
  //    priest's 10-ability class catalog (class-overhaul-workboard.md
  //    chunk 3.4). Same substrate-reuse discipline as the Geometrician/
  //    Kindled blocks above; every low-aim auto-target ability reuses
  //    World.ts's findNearestAlly/findNearestEnemy (see constants.ts's
  //    SYZ_ALLY_SEARCH_RANGE_PX/SYZ_ENEMY_SEARCH_RANGE_PX header note).
  //    Cool-white visual family throughout (docs/character-sheets-v1.md:
  //    Syzygist LOCKED "cool-white... not violet, not Kindled gold") —
  //    distinct from every other class's color family on this pool.
  {
    id: "bleed-tithe",
    name: "Bleed Tithe",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 4,
    classId: "priest",
    role: "offense",
    description:
      "Active (6s cooldown): a fire-tendril seeks the nearest enemy on its own — burns them, tithes part of the damage to you.",
    flavorText: "What it burns, it brings home.",
    active: {
      kind: "bleed-tithe",
      cooldownMs: 6000,
    },
    visual: visual("orb", "#dff7ff"),
    unique: true,
  },
  {
    id: "severance",
    name: "Severance",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "priest",
    role: "offense",
    description:
      "Active (7s cooldown): detonates the nearest already-cursed enemy — no cursed target, no cast, no cooldown burned.",
    flavorText: "You name the hour the debt falls due.",
    active: {
      kind: "severance",
      cooldownMs: 7000,
    },
    visual: visual("x", "#b9ecff"),
    unique: true,
  },
  {
    id: "borrowed-time",
    name: "Borrowed Time",
    category: "ability",
    rarity: "rare",
    buckets: ["ability"],
    essenceCost: 6,
    classId: "priest",
    role: "single",
    description:
      "Active (8s cooldown): heals the nearest hurt ally on its own; part drains back a few seconds later. No ally nearby in need: self-cast, weaker both ways.",
    flavorText: "Take the loan. Win before it's due.",
    active: {
      kind: "borrowed-time",
      cooldownMs: 8000,
    },
    visual: visual("hexagon", "#e0f2fe"),
    unique: true,
  },
  {
    id: "focus-hex",
    name: "Focus Hex",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 4,
    classId: "priest",
    role: "single",
    description:
      "Active (6s cooldown): marks the nearest enemy — no aim needed. Your hits on the mark amplify while it lasts.",
    flavorText: "Undivided attention is a weapon.",
    active: {
      kind: "focus-hex",
      cooldownMs: 6000,
      durationMs: 4000,
    },
    visual: visual("x", "#a5f3fc"),
    unique: true,
  },
  {
    id: "contagion",
    name: "Contagion",
    category: "ability",
    rarity: "rare",
    buckets: ["ability"],
    essenceCost: 6,
    classId: "priest",
    role: "aoe",
    description:
      "Active (9s cooldown): every burning enemy nearby spreads their fire to the nearest un-burned enemy.",
    flavorText: "Kindle one. Ignite them all.",
    active: {
      kind: "contagion",
      cooldownMs: 9000,
    },
    visual: visual("circle", "#7dd3fc"),
    unique: true,
  },
  {
    id: "flock-pulse",
    name: "Flock Pulse",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "priest",
    role: "aoe",
    description:
      "Active (7s cooldown): a weak cool-white slowing nova around you — grows with every ally you're buffing and every enemy you have burning.",
    flavorText: "Everyone you lift lifts you.",
    active: {
      kind: "flock-pulse",
      cooldownMs: 7000,
    },
    visual: visual("circle", "#dff7ff"),
    unique: true,
  },
  {
    id: "self-lattice",
    name: "Self-Lattice",
    category: "ability",
    rarity: "common",
    buckets: ["ability"],
    essenceCost: 3,
    classId: "priest",
    role: "defense",
    description:
      "Active (6s cooldown): a small absorb barrier on yourself — weaker, by design, than what you'd grant an ally.",
    flavorText: "Give everything. Keep enough.",
    active: {
      kind: "self-lattice",
      cooldownMs: 6000,
    },
    visual: visual("hexagon", "#b9ecff"),
    unique: true,
  },
  {
    id: "glass-ward",
    name: "Glass Ward",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "priest",
    role: "defense",
    description:
      "Active (7s cooldown): a stronger absorb barrier seeks your nearest ally — weaker self-cast if none is near.",
    flavorText: "Armor the arm that fights beside you.",
    active: {
      kind: "glass-ward",
      cooldownMs: 7000,
    },
    visual: visual("hexagon", "#e0f2fe"),
    unique: true,
  },
  {
    id: "haste-gift",
    name: "Haste Gift",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 4,
    classId: "priest",
    role: "buff",
    description:
      "Active (7s cooldown): a haste tendril seeks your nearest ally on its own — self-cast at half strength if alone.",
    flavorText: "Swiftness shared is swiftness doubled.",
    active: {
      kind: "haste-gift",
      cooldownMs: 7000,
      durationMs: 5000,
    },
    visual: visual("bar", "#a5f3fc"),
    unique: true,
  },
  {
    id: "drift-step",
    name: "Drift Step",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 4,
    classId: "priest",
    role: "movement",
    description:
      "Active (6s cooldown): a short step toward your aim — hold curse and gift uptime without leaving the fight.",
    flavorText: "A step toward, never away.",
    active: {
      kind: "drift-step",
      cooldownMs: 6000,
    },
    visual: visual("square", "#7dd3fc"),
    unique: true,
  },
  // ── Interstice catalog v1 (docs/class-ability-catalogs-v1.md) — the
  //    ninja's 10-ability class catalog, 9 wired this pass (see
  //    cardTypes.ts's AbilityKind header comment for why "Paper Double" is
  //    not in this pool at all). Same substrate-reuse discipline as the
  //    Geometrician/Kindled/Syzygist blocks above. Crystal-cyan-adjacent
  //    but distinctly sharper/higher-frequency than the Geometrician family
  //    (character-sheets-v1.md: "energy-resource glow — sharper, higher-
  //    frequency pulse than wizard cyan") — insidious-precise tone (C4):
  //    names read as precision/opportunism, never flashy.
  {
    id: "undercut",
    name: "Undercut",
    category: "ability",
    rarity: "rare",
    buckets: ["ability"],
    essenceCost: 6,
    classId: "ninja",
    role: "offense",
    description:
      "Active (8s cooldown, 4s window): a landed arc hit on anyone below 15% health finishes them outright.",
    flavorText: "You made the opening. Take it.",
    active: {
      kind: "undercut",
      cooldownMs: 8000,
      durationMs: 4000,
    },
    visual: visual("bar", "#67e8f9"),
    unique: true,
  },
  {
    id: "edge-storm",
    name: "Edge Storm",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "ninja",
    role: "offense",
    description:
      "Active (8s cooldown, 6s window): next 3 swings each finish with a heavy wave — whiffs fire it, interrupts don't.",
    flavorText: "Every cut, a little heavier than the last.",
    active: {
      kind: "edge-storm",
      cooldownMs: 8000,
      durationMs: 6000,
    },
    visual: visual("x", "#22d3ee"),
    unique: true,
  },
  {
    id: "needle",
    name: "Needle",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 4,
    classId: "ninja",
    role: "single",
    description:
      "Active (5s cooldown): close the last few feet and put a fast, hard shard through the nearest enemy — no aim, no cast.",
    flavorText: "The gap was never really there.",
    active: {
      kind: "needle",
      // 2026-07-20 gap-closer pass: 6000 -> 5000ms (see NINJA_NEEDLE_LUNGE_PX's
      // constants.ts comment for the full rationale).
      cooldownMs: 5000,
    },
    visual: visual("x", "#5ac8fa"),
    unique: true,
  },
  {
    id: "read-mark",
    name: "Read Mark",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "ninja",
    role: "single",
    description:
      "Active (6s cooldown, 5s window): mark the nearest enemy — no aim. While marked, your arc hits on them cut harder.",
    flavorText: "The blade finishes what knowing began.",
    active: {
      kind: "read-mark",
      cooldownMs: 6000,
      durationMs: 5000,
    },
    visual: visual("hexagon", "#38bdf8"),
    unique: true,
  },
  {
    id: "shard-ring",
    name: "Shard Ring",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "ninja",
    role: "aoe",
    description:
      "Active (7s cooldown): a full-circle wave ring off a still blade — short radius, everyone close pays for it.",
    flavorText: "Stillness is not surrender.",
    active: {
      kind: "shard-ring",
      cooldownMs: 7000,
    },
    visual: visual("circle", "#67e8f9"),
    unique: true,
  },
  {
    id: "wall-bloom",
    name: "Wall Bloom",
    category: "ability",
    rarity: "common",
    buckets: ["ability"],
    essenceCost: 3,
    classId: "ninja",
    role: "aoe",
    description:
      "Active (7s cooldown, 9s window): your next wall-kick blooms a shard burst off the wall you left.",
    flavorText: "Even your leaving cuts.",
    active: {
      kind: "wall-bloom",
      cooldownMs: 7000,
      durationMs: 9000,
    },
    visual: visual("square", "#22d3ee"),
    unique: true,
  },
  {
    id: "ghost-guard",
    name: "Ghost Guard",
    category: "ability",
    rarity: "rare",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "ninja",
    role: "defense",
    description:
      "Active (9s cooldown, 6s window): while you move, the next ordinary hit doesn't land. Burn, void, chain still do.",
    flavorText: "Motion is its own armor.",
    active: {
      kind: "ghost-guard",
      cooldownMs: 9000,
      durationMs: 6000,
    },
    visual: visual("hexagon", "#5ac8fa"),
    unique: true,
  },
  {
    id: "second-wind",
    name: "Second Wind",
    category: "ability",
    rarity: "common",
    buckets: ["ability"],
    essenceCost: 3,
    classId: "ninja",
    role: "buff",
    description:
      "Active (8s cooldown, 1.5s window): land one hit for a flat burst of health and energy — not scaled to damage dealt.",
    flavorText: "Aggression, paid forward.",
    active: {
      kind: "second-wind",
      cooldownMs: 8000,
      durationMs: 1500,
    },
    visual: visual("circle", "#38bdf8"),
    unique: true,
  },
  {
    id: "razor-route",
    name: "Razor Route",
    category: "ability",
    rarity: "uncommon",
    buckets: ["ability"],
    essenceCost: 4,
    classId: "ninja",
    role: "movement",
    description:
      "Active (7s cooldown, 3s window): your next dash carries further and marks the first body it crosses.",
    flavorText: "Make the road a razor.",
    active: {
      kind: "razor-route",
      cooldownMs: 7000,
      durationMs: 3000,
    },
    visual: visual("bar", "#22d3ee"),
    unique: true,
  },
  {
    id: "paper-double",
    name: "Paper Double",
    category: "ability",
    rarity: "rare",
    buckets: ["ability"],
    essenceCost: 5,
    classId: "ninja",
    role: "movement",
    description:
      "Active (9s cooldown): decoy sprints your heading, dies at 20 damage or 2.5s, bursts 10 in 90px; struck: +25% damage, 2s. Resonance cast: swap with a live decoy.",
    flavorText: "Let them fight the echo. Arrive as the answer.",
    active: {
      kind: "paper-double",
      cooldownMs: 9000,
    },
    // Pale grey/white, not the class's usual combat-cyan — matches the
    // card's own "Visual read" text ("paper-white body pop" on burst); the
    // decoy itself is meant to read as an honest tell, not a spell effect.
    visual: visual("hexagon", "#e2e8f0"),
    unique: true,
  },
];

export const prototypeCards = crystalRoundsCards;

/**
 * All classId-gated catalog cards for one chassis (docs/classes-goal.md
 * "Loadout station owns the 3 slots" — live playtest finding 2026-07-18,
 * Jake: "this should show all cards for that class when its selected not
 * just three"). This is the FULL-CATALOG view — every ability card that
 * chassis has authored, not a random offer/reroll. Server (venueHost.ts's
 * catalog-toggle handler) and client (HangoutScene/CardDraftOverlay) both
 * call this so the equip surface and the validation gate read the exact
 * same list, never two independently-filtered copies. Empty for classes
 * with no catalog authored yet (none remain as of the Interstice catalog
 * landing — all four chassis now have an authored catalog) — callers must
 * still render an empty result as an honest empty state, not an error, in
 * case a fifth chassis is ever added ahead of its own catalog.
 * Order is definition order (stable, matches class-ability-catalogs-v1.md's
 * table order) — callers should not re-sort.
 */
export function catalogForClass(classId: ClassId): CardDefinition[] {
  return crystalRoundsCards.filter((c) => c.classId === classId);
}
