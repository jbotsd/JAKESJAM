# Class ability catalogs v1

**Status:** first full pass (Jake lock 2026-07-17). Numbers are design
targets, not sim constants — tune in playtest.  
**Canon parents:** `docs/classes-goal.md` (slots, roles, catalog vs cards,
identity non-obsolescence), character sheets (feel contracts).

## Locks this file obeys

| Lock | Value |
|------|--------|
| Display names | Geometrician · Interstice · Kindred · Syzygist |
| Syzygist color | cool-white |
| Rack | **3** slots, keys 1–3 |
| Catalog size | **10** per chassis at first pass (within 8–12); Kindred grew to **12** in its 2026-07-18 coverage-floor fast-follow, still within range |
| Catalog availability | **Full day one** at loadout |
| Specialization | Loadout equip; recommend + pure freedom |
| Roles (exactly six) | defense · offense · buff · aoe · single · movement |
| Coverage | ≥2 primary tags per role per catalog (some multi-role) |
| Cards | Specs/emission on buttons — **not** a second ability bar |
| Chassis sacred | Catalog never replaces Ward / slash+wave / parry+projectile / status verb |

Each row: **primary role**, short effect, feel note. CDs are ballpark
(3–9s short arena). Resource costs use class pool (mana / energy /
Kindling / Devotion).

---

## Geometrician (`wizard`) — 10

Always-on sacred: projectile kit + parry. Catalog extends angle control;
never “stop shooting.”

| # | Name | Role | Effect (sketch) | Feel / notes |
|---|------|------|-----------------|--------------|
| 1 | **Sunlance** | offense | Charged line shot; hold to grow damage/range, release commits | Charge-and-release; crystal geometry, not fireball spam |
| 2 | **Facet Break** | single | Next 1–2 shots mark a target; marked takes +amp; mark breaks on death | Duel focus; technical |
| 3 | **Prism Fan** | aoe | Short cone of shard projectiles | Multi-angle spray; still crystal munitions |
| 4 | **Lattice** | aoe | Place a brief damaging lattice plane (floor or wall-aligned) | Space denial; angle-first |
| 5 | **Return Glass** | defense | Brief window: successful parry also refunds a small mana tick + tiny self-shield | Extends parry, does not replace it |
| 6 | **Hard Aperture** | defense | 0.6s damage gate while aiming (move slow); breaks if you fire | Planted defense; geometrician “hold the proof” |
| 7 | **Overclock** | buff | 3s: fire rate up, spread tighter; ends early if you stop shooting | Cast-weave fuel |
| 8 | **Measure** | buff | Self: next fully charged shot refunds mana and shows a brief aim-assist “true line” VFX (cosmetic-heavy, small mechanical help) | Information + confidence |
| 9 | **Slip Node** | movement | Short blink along aim (cap ~280px); leaves a fading node that enemies can read | Reposition, not Interstice freeflow |
| 10 | **Recoil Step** | movement | On cast, hop opposite to aim (small); next shot gets knock-self reduction | Micro-kiting tool |

**Example racks (recommend, not force):**  
- Duel: Facet Break + Sunlance + Recoil Step  
- Planted: Lattice + Hard Aperture + Overclock  
- Hybrid: Prism Fan + Return Glass + Slip Node  

---

## Interstice (`ninja`) — 10

Always-on sacred: dual-blade slash + short wave (tactile) + baseline dash.
Catalog may add movement tools; **slash remains the engine**.

| # | Name | Role | Effect (sketch) | Feel / notes |
|---|------|------|-----------------|--------------|
| 1 | **Undercut** | offense | Window (4s): arc/wave finish enemies below 15% | Eviscerate weight; hit-stop cut |
| 2 | **Edge Storm** | offense | Next 3 swings fire waves at reduced cost / +wave damage | Aggression battery; still contact-first |
| 3 | **Needle** | single | Lunge strike to nearest/read target (short range); high single damage | Gap-finish, tactile |
| 4 | **Read Mark** | single | Dash-through or cast tags *Read* longer; next melee on Read hard-amps | Live modeler fantasy |
| 5 | **Shard Ring** | aoe | Full-circle slash; wave ring short radius | Group clear; commit frames |
| 6 | **Wall Bloom** | aoe | Next wall-kick emits a shard burst at the wall | Map geometry as weapon |
| 7 | **Ghost Guard** | defense | One incoming hit becomes a near-miss (i-frame flash) if moving; 1 charge | Extends evasion; not a hold-block |
| 8 | **Second Wind** | buff | On cast: small heal + energy dump if you hit within 1.5s | Aggression-gated sustain |
| 9 | **Paper Double** | movement | Spawn input-echo runner; cast into resonance to swap | Legs, killable, not Zephyr army |
| 10 | **Razor Route** | movement | Empower next dash: longer, through-platforms soft, marks Read on cross | Chase / escape; body-cross |

**Example racks:**  
- Assassin: Undercut + Needle + Read Mark  
- Runner: Paper Double + Razor Route + Edge Storm  
- Crowd: Shard Ring + Wall Bloom + Ghost Guard  

---

## Kindred (`paladin`) — 12

Always-on sacred: Kindled Ward (hold) + Kindled Edge weight. Heaven-tank
feel. Catalog **extends** peel/field; never “skip the board.”

**2026-07-18 coverage-floor fast-follow** (docs/axiom-deviations-audit.md
"Kindred — two structural gaps"): the original 10 shipped buff×1 (Rally
Light) and movement×1 (Plant Charge), both below this file's own ≥2-per-
role floor (the Locks table above), and Aegis Share/Rally Light were
team-only with no solo fallback. #11-12 close the coverage gap; Aegis
Share/Rally Light both now carry a solo clause too (see their rows below
and constants.ts's KIN_AEGIS_SHARE_SOLO_KINDLING_FEED /
KIN_KINDLED_RESOLVE_*/KIN_BULWARK_STEP_* header comments for the full
numbers). 12 is still inside the locked 8-12 catalog-size range.

| # | Name | Role | Effect (sketch) | Feel / notes |
|---|------|------|-----------------|--------------|
| 1 | **Unbroken Seal** | offense | Committed overhead; big hit-stop + stagger | Primary B feel; punish window |
| 2 | **Retribution Edge** | offense | After a blocked hit, next edge swing amp + Kindling refund tick | Block-punish loop |
| 3 | **Sunspike** | single | Aimed thrust; high single, short windup | Focus the one who ignored the line |
| 4 | **Judgment Line** | single | Mark one enemy; they take extra from your ward bashes / edge for 3s | Duel tank |
| 5 | **Consecrated Field** | aoe | Settled self-light field at feet (moves slowly or sticks); damages / slows lightly | Consecration *feel*, self-sourced |
| 6 | **Shock Ring** | aoe | Slam shock on ground after short hop (keep hop modest — not sky-god) | Space claim; heaven-tank weight |
| 7 | **Bastion Pulse** | defense | Instant small self-absorb; stronger if Ward is held | Ward synergy, not a second shield identity |
| 8 | **Aegis Share** | defense | Brief: projectiles that would hit allies in ward shadow also feed your Kindling. **Solo fallback:** no ally in range → feeds the caster a reduced Kindling tick instead | Peel readable; no dead solo press |
| 9 | **Rally Light** | buff | Allies in aura (including yourself, solo-safe): small damage amp + move tick (Conjuration *feel* lite) | Team peak; already self-covers solo |
| 10 | **Plant Charge** | movement | Short directional charge (board-first, aim-directed); ends in ward-ready stance, tips shield charge up | Plant-to-plant, not freeflow ninja; the committed reposition |
| 11 | **Kindled Resolve** | buff | Spend Kindling for a self stagger-resist + small self-damage-amp window | Solo, resource-gated stance — cash in the block-meter |
| 12 | **Bulwark Step** | movement | Short lateral shuffle in whatever direction you're currently walking (input-facing, NOT aim-directed); Ward never drops | Cheap, reflexive reposition — the low-commitment counterpart to Plant Charge |

**Example racks:**  
- Peel: Aegis Share + Rally Light + Retribution Edge  
- Punish: Unbroken Seal + Bastion Pulse + Sunspike  
- Field: Consecrated Field + Shock Ring + Plant Charge  
- Solo heaven-tank: Kindled Resolve + Bulwark Step + Bastion Pulse — every pick has a real, non-team-gated payoff  

---

## Syzygist (`priest`) — 10

Always-on sacred: status/entanglement verb + modest projectile. Cool-white.
Solo = enemy entanglement; teams = gift polarity. Catalog must support
**solo 3-slot** paths.

| # | Name | Role | Effect (sketch) | Feel / notes |
|---|------|------|-----------------|--------------|
| 1 | **Bleed Tithe** | offense | Curse: DoT that generates Devotion on tick; lifesteal fraction to you | Solo engine |
| 2 | **Severance** | offense | Burst curse detonate on a target already cursed | Execute-adjacent; take polarity |
| 3 | **Borrowed Time** | single | Heal ally (or self weaker); drains back unless target keeps dealing/taking meaningful combat action | Transactional gift |
| 4 | **Focus Hex** | single | Single-target amp curse: they take more from you; you gain Devotion on their damage dealt | Solo duel + team mark |
| 5 | **Contagion** | aoe | Debuffs jump to nearest enemy on death or timer | FFA signature; readable jump |
| 6 | **Flock Pulse** | aoe | Nova of weak cool-white damage/slow scaling with # of entities currently entangled with you | Solo: cursed count; team: allies+cursed |
| 7 | **Self-Lattice** | defense | Weak self-ward (deliberately weaker than ally ward) | Belief: invest outward; solo still has a button |
| 8 | **Glass Ward** | defense | Stronger absorb on **ally** (or on self if no ally in range, at reduced strength) | Teams peak; solo fallback |
| 9 | **Haste Gift** | buff | Ally haste (self half if solo) | Uptime / peel support |
| 10 | **Drift Step** | movement | Short reposition; if an entangled entity is nearby, snap slightly toward/away (player aim) | Keep curse uptime; not Interstice speed |

**Example racks:**  
- Solo take: Bleed Tithe + Severance + Focus Hex  
- Solo skirmish: Contagion + Drift Step + Self-Lattice  
- Duo lend: Borrowed Time + Glass Ward + Haste Gift  

**Solo problematic encounter intent:** multi-curse management under pressure,
Contagion chain reads, self-ward as a known soft spot — unique space, not
sanded into generic DPS.

---

## Loadout UI notes

- Full catalog visible day one; filter chips: defense / offense / buff /
  aoe / single / movement.
- **Recommended** racks (above) as one-tap apply; **Clear** and free pick
  always available.
- Soft warn if rack is all one role (“no defense tools”) — never block.
- Chassis always-on strip shown above catalog so Ward / slash / parry /
  status stay visually “yours” even when browsing buttons.

## Draft cards (reminder)

Do **not** add catalog rows as draft “ability cards” that fill new slots.
Draft **specs** these buttons and the chassis M1/defense/E. Exclusives like
Undercut / Paper Double may exist as **catalog entries** (above) and
optionally as draft **specs that empower** them — not duplicate bars.

## Next

- Sim constants pass (damage, CD, resource) per class resource curves  
- Resonance pair matrix (which 3-combos feel best)  
- Bot loadout tables (solo Syzygist vs peel Kindred)  
- Wire loadout station UI to this list  
