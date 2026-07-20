# Class ability catalogs v1

**Status:** first full pass (Jake lock 2026-07-17). Numbers are design
targets, not sim constants — tune in playtest.  
**Canon parents:** `docs/classes-goal.md` (slots, roles, catalog vs cards,
identity non-obsolescence), character sheets (feel contracts).

## Locks this file obeys

| Lock | Value |
|------|--------|
| Display names | Geometrician · Interstice · Kindled · Syzygist |
| Syzygist color | cool-white |
| Rack | **3** slots, keys 1–3 |
| Catalog size | **10** per chassis at first pass (within 8–12); Kindled grew to **12** in its 2026-07-18 coverage-floor fast-follow, then was cut back to **10** on 2026-07-19 (Retribution Edge + Consecrated Field removed — see Kindled's own section below) |
| Catalog availability | **Full day one** at loadout |
| Specialization | Loadout equip; recommend + pure freedom |
| Roles (exactly six) | defense · offense · buff · aoe · single · movement |
| Coverage | ≥2 primary tags per role per catalog (some multi-role) — **exception:** Kindled's offense/aoe dropped to 1 each in the 2026-07-19 cut, an accepted consequence of that specific cut, not a re-opened gap (see Kindled's section) |
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
| 8 | **Measure** | buff | Self: short window (0.7s) — shots fired go dead-center (spread zeroed) with a damage amp | The "true line," made mechanically real (reworked 2026-07-19 — see cut/rework note below) |
| 9 | **Slip Node** | movement | Short blink along aim (cap ~280px); leaves a fading node that enemies can read | Reposition, not Interstice freeflow |
| 10 | **Recoil Step** | movement | On cast, hop opposite to aim (small); shots fired in the next 1.2s get a strong knock-self reduction | Micro-kiting tool — the reduction is the ability's real reason to exist over Slip Node (reworked 2026-07-19, see below) |

**2026-07-19 rework (docs/axiom-deviations-audit.md D2):** Measure and Recoil Step were both
confirmed/suspected filler — Measure was a flat +1-ammo grant ("cosmetic-heavy, small
mechanical help" in its own v1 doc text, dominated by Overclock as a buff pick); Recoil Step
was an unadorned hop, "likely dominated by Slip Node" with no independent payoff. Both now
ship the mechanic their ORIGINAL doc text already named but deferred: Measure's "true line"
aim-assist is a real spread-zero + damage amp, not a VFX note; Recoil Step's "next shot gets
knock-self reduction" is a real rider window. See `docs/axiom-deviations-audit.md`'s
Geometrician section for the full before/after and `constants.ts`'s `GEO_MEASURE_*`/
`GEO_RECOIL_STEP_*` header comments for the numbers.

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

## Kindled (`paladin`) — 10

Always-on sacred: Kindled Ward (hold) + Kindled Edge weight. Heaven-tank
feel. Catalog **extends** peel/field; never “skip the board.”

**2026-07-18 coverage-floor fast-follow** (docs/axiom-deviations-audit.md
"Kindled — two structural gaps"): the original 10 shipped buff×1 (Rally
Light) and movement×1 (Plant Charge), both below this file's own ≥2-per-
role floor (the Locks table above), and Aegis Share/Rally Light were
team-only with no solo fallback. Kindled Resolve/Bulwark Step closed the
coverage gap (growing the catalog to 12); Aegis Share/Rally Light both now
carry a solo clause too (see their rows below and constants.ts's
KIN_AEGIS_SHARE_SOLO_KINDLING_FEED / KIN_KINDLED_RESOLVE_*/KIN_BULWARK_
STEP_* header comments for the full numbers). 12 was still inside the
locked 8-12 catalog-size range.

**2026-07-19 cut — back down to 10:** Retribution Edge (offense) and
Consecrated Field (aoe) were removed entirely (not deferred — a genuine
permanent cut). Retribution Edge carried an unaddressed self-fueling-loop
brake: docs/axiom-deviations-audit.md flagged it (D3/AX.3, "block → amp +
Kindling refund → more") as needing a brake, the same category of issue
the Syzygist class had this session (Flock Pulse's snowball, fixed with a
kill-lead-fed brake) — Retribution Edge's equivalent brake was never
built, and removal sidesteps that open design debt rather than requiring a
fix first. Consecrated Field was cut for role redundancy against Shock
Ring: both were "AOE damage zone near yourself," and Shock Ring reads as
more central to the class's heaven-tank weight identity (the "Space claim;
heaven-tank weight" feel note below is Shock Ring's own). This drops
offense and aoe from 2-per-role to 1-per-role each (Unbroken Seal and
Shock Ring are now the sole survivors of those roles) — an intentional,
accepted consequence of THIS cut, not a re-opened coverage gap needing
another fast-follow. Kindled Resolve/Bulwark Step (buff/movement, the roles
the 2026-07-18 fast-follow actually fixed) are untouched and stay at ≥2.

| # | Name | Role | Effect (sketch) | Feel / notes |
|---|------|------|-----------------|--------------|
| 1 | **Unbroken Seal** | offense | Committed overhead; big hit-stop + stagger | Primary B feel; punish window |
| 2 | **Sunspike** | single | Aimed thrust; high single, short windup | Focus the one who ignored the line |
| 3 | **Judgment Line** | single | Mark one enemy; they take extra from your ward bashes / edge for 3s | Duel tank |
| 4 | **Shock Ring** | aoe | Slam shock on ground after short hop (keep hop modest — not sky-god) | Space claim; heaven-tank weight |
| 5 | **Bastion Pulse** | defense | Instant small self-absorb; stronger if Ward is held | Ward synergy, not a second shield identity |
| 6 | **Aegis Share** | defense | Brief: projectiles that would hit allies in ward shadow also feed your Kindling. **Solo fallback:** no ally in range → feeds the caster a reduced Kindling tick instead | Peel readable; no dead solo press |
| 7 | **Rally Light** | buff | Allies in aura (including yourself, solo-safe): small damage amp + move tick (Conjuration *feel* lite) | Team peak; already self-covers solo |
| 8 | **Plant Charge** | movement | Short directional charge (board-first, aim-directed); ends in ward-ready stance, tips shield charge up | Plant-to-plant, not freeflow ninja; the committed reposition |
| 9 | **Kindled Resolve** | buff | Spend Kindling for a self stagger-resist + small self-damage-amp window | Solo, resource-gated stance — cash in the block-meter |
| 10 | **Bulwark Step** | movement | Short lateral shuffle in whatever direction you're currently walking (input-facing, NOT aim-directed); Ward never drops | Cheap, reflexive reposition — the low-commitment counterpart to Plant Charge |

*(Cut 2026-07-19 — no longer in the catalog: Retribution Edge (was #2,
offense, "after a blocked hit, next edge swing amp + Kindling refund
tick") and Consecrated Field (was #5, aoe, "settled self-light field at
feet; damages / slows lightly"). See the cut note above.)*

**Example racks:**  
- Peel: Aegis Share + Rally Light + Bastion Pulse  
- Punish: Unbroken Seal + Sunspike + Judgment Line  
- Space claim: Shock Ring + Plant Charge + Bastion Pulse  
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
- Bot loadout tables (solo Syzygist vs peel Kindled)  
- Wire loadout station UI to this list  
