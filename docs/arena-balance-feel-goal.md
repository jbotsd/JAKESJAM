# GOAL — Arena Balance & Game Feel (the fight as product)

**Status:** North star for combat pacing, card power, arena readability, and juice layering.  
**Supersedes on conflict:** “balance later”; flat +damage cards as content; juice only on kills; hitscan roulette as skill; dogpile-as-difficulty; hard-clamp camera that stutters; silent chaos rule changes.  
**Does not supersede:** Escalation Engine draft doctrine (`docs/escalation-engine-goal.md`); sim authority / deploy / aegis (`CLAUDE.md`); shell Places (`docs/ui-shell-goal.md`); gnostic vessel visual language (`docs/visual-language-gnostic-vessel.md`).  
**Genre debt:** ROUNDS (draft identity), Stick Fight / Duck Game (party FFA readability), TowerFall (arc literacy), Soldat (gun-first movement), Vlambeer (juice stacks), Halo “30s of fun” (engagement loop).  
**Last written:** 2026-07-10.

---

## Mission

Make **every fight feel like a finished arena game** — short enough to laugh, long enough to outplay, loud enough that the body knows what happened before the brain counts damage.

JAKESJAM is not a spreadsheet that happens to move. It is a **crystal-tech wizard deathmatch** you join by URL: hop, shoot, die clean, draft stupider, chaos recolors the world, go again. The sim is deterministic and fair; the **feel** is the product people remember. The **TTK band** is the contract that keeps skill possible. The **card draft** is the content engine; every pick must **land** in the body like a ROUNDS slam, not a checkbox.

**Done =** a new player can read “who hurt me and how” in under a second; a veteran can express three distinct build identities without breaching the TTK floor; Hot Lobby FFA never feels like a firing squad by design; every card, element, and chaos mod has a three-layer juice signature; camera frames the duel without thrash; live funnel playtest confirms “this feels like ROUNDS × Stick Fight juice, not a prototype with good netcode.”

---

## What this is not

| Not this | Why |
|----------|-----|
| A new base weapon line | One starter pistol; content is orthogonal cards (pillars) |
| Pure ROUNDS loser-only draft | Escalation Engine owns universal draft; this goal owns *how power and feel behave once you have cards* |
| Competitive ranked / SBMM | Party + always-on world; fairness is mechanical, not matched |
| Photoreal VFX / post-stack bloat | Pixel-art discipline, additive glow, pooled particles — readable chaos |
| Hitscan-only competitive FPS | Gun-first, but **dodgeable** projectiles at mid range are the skill floor |
| Infinite bot difficulty as “content” | Bots keep the world alive and teach; they must not define the skill ceiling |
| Camera that chases every body in FFA | Player-anchored, soft fight lean — not a documentary crew |

---

## The reasoning flaw this kills

**Proxy:** “If the numbers are fair, the game is balanced.”  
**Product:** “If the **body** cannot feel who won the beat, the numbers never mattered.”

Arena games that last (ROUNDS, Duck Game, TowerFall, Stick Fight, Nuclear Throne-class shooters) all share one truth:

> Every stake has a reaction. Bigger stakes get bigger reactions.  
> — Vlambeer / Nijman, *The Art of Screenshake*

And the dual truth from competitive design (Sirlin, Halo, FGC):

> Every viable strategy has a counter. TTK that collapses the engagement loop collapses the game.

This goal kills the split brain of “balance in sim, juice later” and “juice without a TTK contract.”

---

## The fantasy (vivid, locked)

You open `play.elyad.io`. Hot Lobby is already breathing — two amber bots duel across a **full floor**, cover pylons breaking the sniper lane, hop plates that always climb back from ground. You spawn. First blood lands: a speed glint, a ping you *hear*. You die clean. No draft guilt. Round ends. Three cards slam in — staggered, each with its own **glow orb**. You pick **Void Fracture**. The screen blooms violet. Your rig flinches. Shards of absence spray. Next round your gun *sounds* wrong in the good way; hits leave a void thump; the bot still misses more than a human. Chaos rolls **low gravity** — the banner screams it. Someone stacks explosive + cluster. The arena flashes. Someone still *could have* dodged if they read the arc. Sudden death: walls close, gold rims, last shot. Clip saves itself. You share.

That loop is the product. Everything below exists to make that loop true every session.

---

## Locked doctrine (one page, no alternatives)

### 1. TTK is the master dial

| Layer | Band | Notes |
|-------|------|--------|
| **Base starter (no cards)** | **1.8s – 3.5s** neutral | `neutralTTK` on base weapon |
| **Stacked cards (worst honest combo)** | **≥ ~1.55s** effective | Floor clamp + pellet efficiency; not free instakill |
| **Chaos TTK breach** | Allowed only if **signposted** | Golden Gun / slappers: banner + color; never quiet |

**Compute honesty:** multi-projectile uses **efficiency &lt; 1** (not all pellets hit). Spreadsheets that ignore spread lie.

**Anti-pattern:** “+50% damage” with no tradeoff. Genre graveyard. Identity axes or cut.

### 2. Orthogonal identity &gt; flat power (RPS)

Every card pushes toward a **playstyle**, not a spreadsheet cell:

| Archetype | Wins by | Dies to |
|-----------|---------|---------|
| **Rapid** | Uptime, pressure | Burst / punish windows |
| **Heavy** | Committed hits, knock | Kite / rapid chip |
| **Burst** | Volume / cone | Spacing / miss |
| **Control** | Zone, status, slow | Direct DPS + close |

Cards declare buckets (`delivery / shape / trajectory / quantity / impact / element / utility`). **Unique** and **maxStacks** are laws, not suggestions — enforced in `createWeaponBuild`.

**Escalation:** universal draft (Escalation Engine). Catch-up = **richer weights**, never winner silence. This goal does not reopen that debate.

### 3. Three-layer juice on every stake

Every meaningful beat must hit **at least three** of:

visual · audio · camera trauma · hit-stop (render-only) · particles · rig flash · UI flash

| Stake | Minimum stack |
|-------|----------------|
| **Fire** | Muzzle + SFX (pitch variance) + tiny local recoil trauma |
| **Hit** | Impact burst (element/shape) + hit SFX + hit-stop + damage number |
| **Kill** | Bigger burst + freeze + shake + kill cinematic + layered SFX |
| **Card pick** | Orb identity + world burst in `visual.glowColor` + SFX + trauma + rig pulse |
| **Chaos roll** | Banner + color wash + audio sting (especially TTK-breakers) |
| **Parry / aegis** | Flash + ring + short hit-stop + parry SFX |
| **Movement** | Land / dash trauma (scaled); never zoom-spam on every hop |

**Sim never juices.** Events leave `StepResult`; render owns the stack (`ProjectileVfx`, `SimEventRouter`, `CardFeel`, `CameraJuice`).

### 4. Dodge window is skill, not lag

At mid range, time-to-impact ≥ **~250ms** for standard projectiles. Below that, players blame netcode; netcode is not the villain.

- Raycast / beam **identities** may approximate hitscan *feel* via delivery mapping, but the **default fantasy** is arc-readable crystal shards.
- Parry active window stays **skill-hard, learnable** (~120–180ms class) — not a hold-to-win.

### 5. Maps balance the gun

Hot Lobby mega docks:

- **Always a continuous floor** — fall is recoverable; climb is hop-chained  
- **Cover breaks floor-band snipes** (sightline ≤ ~480px open)  
- **Hop rise ≤ jump literacy** (≤ ~93% apex)  
- **Spawn lattice** fair and spaced; no soft-kill island pits  

1v1 cells may stay sealed boxes. Tower maps may gate high ground. **Profiles differ; laws stay honest.**

### 6. FFA is not 1v1 with more HP

Hot Lobby:

- Spawn fairness, cover, recoverability  
- Soft bots (sparse count, aim error, prefer bot-on-bot, FTUE grace)  
- Dogpile is a **bug**, not difficulty  
- Camera: **player-anchored**, soft envelope of the duel partner — not every body in the lobby  

### 7. Camera is weight, not panic

- Soft follow + deadzone; envelope pulls **partially**, sticky subject, EMA  
- Zoom-out is rare and slow; never thrash  
- Shake is a **bus** with max amplitude — footstep never clobbers kill  
- Mid sensitivity is the house default: not Stick Fight nauseous, not documentary float  

### 8. Chaos recolors; it does not gaslight

Players must know the rules of *this* round in **one second**. TTK-breaking chaos is loud. Quiet rule changes are the #1 unfairness driver in arena PvP.

---

## Moments we optimize (the fun list)

If a feature does not produce or enable one of these, cut it or redesign it.

1. **War-crime gun, still dodgeable** — round five, your build is absurd, the arena flashes, a good player *could* have lived.  
2. **Comeback without silence** — you were losing; catch-up offers + pity + skill; you still drafted every round.  
3. **Chaos vignette** — low-g + max recoil: nobody is in control; someone still wins; the banner told you first.  
4. **Sudden-death money shot** — both at target−1, world shrinks, cover dies, last crystal decides.  
5. **First-blood glint** — aggression paid; you hold the speed wager.  
6. **Card slam** — pick lands in the bones; the next shot *sounds* different.  
7. **Aegis turn** — slide-parry reads as a turn; the room hears it.  
8. **Hot Lobby breath** — join URL; world already fighting; you are never alone in a void.  
9. **Clip that sells the duel** — action cam + 9:16 crop holds **you and the enemy**.  
10. **Clean death** — no draft guilt; juice; back in under a breath.

---

## Genre scorecard (north-star comparison)

| Dimension | Genre best (ROUNDS / Stick Fight / TowerFall / Vlambeer) | JAKESJAM north star |
|-----------|----------------------------------------------------------|---------------------|
| Fight length | Short, decisive | 1.8–3.5s base; ≥1.55s stacked |
| Escalation | Cards / weapons change identity | Universal draft + orthogonal buckets |
| Catch-up | Loser draft (ROUNDS) | Richer weights, not winner silence |
| Readability | Silhouette + impact language | Shape + element VFX + clear hitboxes |
| Juice | 3+ layers per stake | Fire / hit / kill / pick / chaos / parry |
| Map | Small readable arenas | Full floor FFA + cover + hop literacy |
| Party density | 2–4 humans | Humans primary; bots sparse & soft |
| Camera | Stable, readable | Soft envelope, no stutter thrash |

---

## Done-done checklist

### Balance

- [ ] Starter `neutralTTK` in **1.8–3.5s**  
- [ ] No honest card stack under **~1.55s** effective TTK (tests + clamp)  
- [ ] `unique` / `maxStacks` enforced in `createWeaponBuild`  
- [ ] No pure +damage trap cards without identity or tradeoff  
- [ ] Delivery cards (raycast / beam / pulse) **feel** distinct in play  
- [ ] Chaos TTK breaches flagged in UI  
- [ ] Archetype / bucket diversity still readable at round 5  

### Feel

- [ ] Projectile path: muzzle + trail + shaped body + element impact/fizzle on live world  
- [ ] Hit / kill stacks via `SimEventRouter` (stop + shake + blast + SFX)  
- [ ] **Every** card pick fires `CardFeel` (color from `visual`)  
- [ ] Draft UI shows per-card identity (orb / glow), staggered spawn  
- [ ] Parry / shield / dash have audible + visual turns  
- [ ] SFX pitch variance on combat cues  
- [ ] Camera mid-weight, sticky duel partner, no hard-clamp stutter  

### Arena & lobby

- [ ] Hot Lobby maps: continuous floor, cover sightlines, hop recoverability  
- [ ] Spawns fair for 12–16 pads on mega docks  
- [ ] Bot count / aim / FTUE grace keep lobby alive without dogpile  
- [ ] Clip vertical crop envelopes fight pair  

### Proof

- [ ] Unit tests: TTK floor, unique/stacks, projectile VFX totality  
- [ ] Live playtest note: “felt like a real arena game, not a sim demo”  
- [ ] Pillars + this goal + Escalation Engine agree on draft + power  

---

## Reasoning anchors (why these numbers)

- **~250ms mid-range dodge:** human visual reaction floor; below = roulette.  
- **1.8–3.5s TTK:** room for one mistake and one answer (Halo engagement grain).  
- **1.55s card floor:** reward stacking without deleting skill.  
- **Parry ~120–180ms:** learnable, not autopilot (Sirlin “optimal but hard”).  
- **Three juice layers:** Nijman / Swink — one channel is never enough.  
- **Universal draft:** picker is the feature; silence the winner and you silence the game (Escalation Engine).  

---

## Phases (ship order)

| Phase | Outcome |
|-------|---------|
| **A — Contract** | TTK clamps, stacks/unique, delivery feel, tests green (started) |
| **B — Stake juice** | Fire/hit/kill/pick/parry all 3+ layers on live path |
| **C — Identity** | Every card’s combat identity audible + visible; no silent mutators |
| **D — Arena literacy** | Map laws + camera mid-feel + clip envelope locked |
| **E — Lobby ecology** | Bot policy + spawn + dogpile metrics; chaos signpost pass |
| **F — Proof** | Funnel playtest writeup against the fun list above |

---

## Ownership map

| Concern | Owner |
|---------|--------|
| Draft who/when | `docs/escalation-engine-goal.md` |
| TTK / cards / clamp / archetypes | This goal + `weaponBuild.ts` / `cards.ts` / combat-balance skill |
| Projectile & event juice | `ProjectileVfx`, `SimEventRouter`, `CardFeel`, ParticlePool |
| Camera | `ActionCamera` + actionCameraMath |
| Maps | `map-design.md` + vessel-nexus / mapGen |
| Bots | `worldBots.ts` + botArenaNav (serve this goal’s FFA ecology) |
| Shell / clips product surface | `ui-shell-goal.md` |

---

## One-line north star

**Short fights you can read, builds that get stupider without deleting skill, and juice so thick the body knows the score before the HUD does.**
