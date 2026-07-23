# Voice Pass Inventory — Track V (convergence-goal.md) / Pillar 2 (cohesion-goal.md)

Date: 2026-07-23 · Branch: `track-v/voice-pass` · Assembler: single-writer apply of the 28-agent proposal set (104 proposals, 104/104 judge-passed).

**The two registers.** In-play copy = the crucible: gnostic, optimistic, self-empowering ("iron begets iron"). End-of-match copy = the record's gravity ("Let the record show"). Banned from all in-play copy: prohibited, tribunal, war crime, illegal, treaty, sanction, forbidden, contraband. Record vocabulary (unmade, testimony, "the record") appears ONLY on end-of-match surfaces. Enforced from this commit by `client/src/sim/__tests__/voiceRegister.test.ts`.

**Mechanics guarantee.** Only `description`/`flavorText` moved; `sim/tools/gen_card_data.ts` re-run after the pass produced a byte-identical `sim/src/data/cards_gen.zig` (display copy does not cross the codegen).

## Cards changed (88)

| id | description (old → new) | flavor (old → new) |
| --- | --- | --- |
| `raycast-prism` | Hitscan beam: no travel time. Slightly less damage, softer kick — pure aim reward. **→** Hitscan beam: no travel time. Slightly less damage, softer kick — your aim is the only variable. | (unchanged) |
| `crystal-volley` | Tighter, faster baseline shot. The clean default when you want honest gunplay. **→** Tighter, faster baseline shot — the clean default that asks only for your aim. | (unchanged) |
| `circle-rounds` | Short-fused rounds — much less range, but they're already there. Win it up close before it becomes a poke war. **→** Short-fused rounds — much less range, but they're already there. Step in and end it before range matters. | (unchanged) |
| `triangle-rounds` | Long-hafted shards built to cross the whole map. Slower off the hand, but distance is the whole point. **→** Long-hafted shards that cross the whole map. Slower off the hand — the far fight belongs to you. | (unchanged) |
| `square-rounds` | Heavy slabs built to shove. Massive knockback punts enemies off platforms and out of position — slow to arrive. **→** Heavy slabs, slow to arrive — massive knockback drives enemies off platforms and out of position. | Mass over manners. **→** Ground is taken, not given. |
| `x-rounds` | The biggest standard round in the pool — a wide X-cut slab that's hard to miss and hard to dodge. Slower to throw, impossible to ignore. **→** The biggest standard round in the pool: a wide X-cut slab, hard to miss, hard to dodge — slower to throw. | Big enough to matter. **→** Presence is a weapon. |
| `i-rounds` | Slow off the hand, then it isn't — bar-crystals that build speed the longer they fly. Lean into long sightlines; lead less at range, more up close. **→** Slow off the hand, these bar-crystals build speed the longer they fly. Lead less at range, more up close. | A straight answer, delayed on purpose. **→** Momentum is earned in flight. |
| `orby-blap-blap` | Fat orbs fire in a two-shot blap. Slower flight, huge presence, close-range bully. **→** Heavy orbs loosed in a two-shot burst. Slower flight, huge presence — built to rule the close fight. | Blap once. Blap again. **→** Once to open. Once to end. |
| `continuous-refractor` | Hold to pour a continuous beam. Lower per-tick damage, relentless pressure and glow. **→** Hold to pour an unending beam. Lower per-tick damage — ceaseless pressure, ceaseless light. | A wall made of now. **→** Your will, unbroken. |
| `shard-bloom` | Close-range shard burst instead of a pulse wave. Severe range cut — devastating in faces, useless at distance. **→** Your pulse wave becomes a close shard burst. Severe range cut — devastating up close, nothing at range. | The core empties its pockets. **→** Step in. Give everything. |
| `deadfall-mortar` | A true lob: steep drop, big boom. Arc it over cover and walls — the impact does the rest. **→** A true lob: steep drop, heavy blast. Arc it over cover and walls — the landing does the rest. | What goes up, negotiates. **→** Send it high. Trust the fall. |
| `seeker-facets` | Main shot homes toward the nearest foe with a capped turn rate. Still aim — it assists, not auto-wins. **→** Your main shot homes toward the nearest foe, turn rate capped. Aim still rules — it assists, not replaces. | It remembers the slight. **→** It seeks what you intend. |
| `micro-seekers` | Extra tiny homers peel into the fight. Chaos fuel for multi-target messes. **→** Extra tiny homing shards peel into the fight. Strongest against many foes. | Small. Personal. Persistent. **→** Small. Tireless. Yours. |
| `extra-bounce` | +1 ricochet on everything you fire. Stacks the geometry game. **→** +1 ricochet on everything you fire. Stacks — every surface becomes another angle. | One more vote for the wall. **→** Another angle earned. |
| `boomerang-return` | After half range, shots curl home. Catch retreats and punish chase-you play. **→** Past half range, your shots turn and come home. Catch retreats; punish anyone who hunts your heels. | Regret, sharpened. **→** What leaves your hand comes home keener. |
| `falling-star` | Blistering point-blank speed that burns off fast. Everything up close, nothing at range. **→** Blistering point-blank speed that burns off fast. Everything up close, nothing at range — close in. | All at once, then nothing. **→** Spend it all where it counts. |
| `triple-fan` | (unchanged) | The core spreads its hands. The walls don't stop it. **→** The walls fight beside you. |
| `five-shard-spray` | (unchanged) | Accuracy left. Velocity stayed. **→** Five shards, one will. |
| `one-more-shard` | (unchanged) | Just one more. Famous last words. **→** You are more than you were. |
| `orbiting-satellites` | Two orbiting crystals auto-harass nearby foes. Passive your hands for the big shot. **→** Two crystals orbit you, harrying any foe that strays close. Your hands stay free for the big shot. | The little ones are listening. **→** What orbits you, fights for you. |
| `cluster-bomb` | On first hit, the shot splits into six child shards. Openers become area denial. **→** On first hit, your shot splits into six child shards. One opening blow claims the ground around it. | Impact has children. They bite. **→** Struck true, one becomes many. |
| `explosive-facet` | Hits detonate a prism burst. Splash for groups and soft cover peels. **→** Every hit detonates in a prism burst. Splash scours packs and peels foes from soft cover. | Impact, then argument. **→** Pressure in, radiance out. |
| `sticky-shards` | Shards stick, glow, then burst. Plant threats on bodies and walls. **→** Shards stick to bodies and walls, glow, then burst. Plant your threat where the fight is going. | This is home now. **→** Your will waits where you left it. |
| `pierce-chain` | Pierce three targets and shed copies. Line up multi-kills through clumped packs. **→** Your shot drives through three foes, shedding copies as it goes. Line up the pack; take them as one. | One shot, several endings. **→** Draw one line through many. |
| `molten-core` | (unchanged) | Refraction comes out angry. **→** You were tempered hotter than this. |
| `voltaic-spark` | Lightning: pierces and arcs to a nearby target. Multi-mark punishment. **→** Lightning: pierces and arcs to a nearby target. The more they gather, the more you reach. | (unchanged) |
| `void-fracture` | Void: ignores held shields and pierces two. Punish turtles and stacks. **→** Void: ignores held shields and pierces two. Their cover and their numbers both give way. | (unchanged) |
| `radiant-overload` | Radiant: high damage, blinding white hit flash. The honest power pick. **→** Radiant: high damage, blinding white hit flash. Strength that hides nothing. | A small sun. Bad manners. **→** A small sun, and it is yours. |
| `rapid-refraction` | Faster fire, softer recoil, thinner faster needles. Win trades with tempo you can SEE. **→** Faster fire, softer recoil, thinner faster needles. Tempo you can see; trades you can win. | Blink — already rude twice. **→** The bent path arrives first. |
| `needle-compressor` | Higher rate of fire, smaller shots. Hose them down; aim still matters. **→** Higher rate of fire, smaller shots. Sustain the pressure — aim still matters. | Tiny shots. Horrible tempo. **→** A hundred needles, one will. |
| `heavy-coolant` | (unchanged) | Big crystal. Slow manners. **→** Patience, given mass. |
| `essence-battery` | (unchanged) | Reload before regret. **→** The well is deep. Draw again. |
| `crystal-plating` | (unchanged) | More of you to fight for. **→** You are more than you were. |
| `wide-parry` | Wider dash-bash arc you can SEE on the shield shell. Catch more angles when you slide-block. **→** Your dash-bash arc widens — and shows on the shield shell. Slide-block and catch more angles. | (unchanged) |
| `quick-parry` | Shorter dash-bash cooldown — slide-guard more often. Snappier square cores mark the tempo. **→** Shorter dash-bash cooldown — slide-guard more often. Snappier square cores mark your tempo. | Still rude. Sooner. **→** Your no arrives sooner. |
| `overcharge` | Slower fire, huge shots, wider impact. Patient, brutal, platform-popping. **→** You fire slower; each shot lands huge with wider impact — enough to pop platforms. | Wait. Then nonsense. **→** Patience, then thunder. |
| `mirror-shield` | (unchanged) | No — you. **→** The whetstone answers. |
| `cataclysmic-prism` | Explosive + Radiant: massive nova and pure white flash. Round-ender energy. **→** Explosive meets Radiant: a massive nova and a pure white flash. Rounds end here. | Look directly at the math. **→** Every facet fires at once. |
| `homing-cluster` | Homing + triple fan: three seekers curve into the kill. Beautiful and unfair. **→** Homing meets triple fan: three seekers curve onto the target. Loose them and move. | Three bad ideas with a destination. **→** Three arcs. One answer. |
| `sticky-ray` | Hitscan ray that paints sticky crystal bursts. Beam leaves delayed pain. **→** A hitscan ray that paints sticky crystal where it lands; each burst arrives a beat late. | The beam leaves receipts. **→** The crystal keeps your word. |
| `sprint-coils` | Much faster ground and air move. Outrun peeks, claim high ground first. **→** Move much faster on ground and in air. Outrun their peeks; claim the high ground first. | The floor is a suggestion. **→** Speed chooses the ground. |
| `glide-membrane` | Lower gravity: floatier jumps, longer hang for wall routes and aim windows. **→** Gravity loosens its hold on you: floatier jumps, longer hang for wall routes and aim windows. | (unchanged) |
| `gecko-grip` | Sticky wall-slide — cling and reset. Vertical maps become your house. **→** Sticky wall-slide — cling and reset. The vertical belongs to you. | Down is optional. **→** Where they fall, you hold. |
| `double-jump` | (unchanged) | Who said one? **→** Rise, and rise again. |
| `bulwark-core` | Much larger shield reserve. Hold block through longer volleys before it pops. **→** Much larger shield reserve. Hold your block through longer volleys before it breaks. | A bigger no. **→** Their storm breaks on you. |
| `rapid-capacitor` | Shield recharges much faster between blocks. Spam safe peeks and re-engage. **→** Shield recharges much faster between blocks. Peek safely and re-engage, again and again. | Back up before they do. **→** Ready again before they are. |
| `aim-barrier` | Shield only covers where you aim — but that frontal wall is huge. Point the no. **→** Your shield holds only where you aim — but that frontal wall is vast. Face what you would stop. | (unchanged) |
| `riot-mirror` | Aimed reflect wall with big charge: face threats and bounce their shots home. **→** Aimed reflect wall with a heavy charge: face what fires and its shots fly back to their source. | Return to sender. Fast. **→** Meet it. Turn it. Return it. |
| `stolen-fangs` | Blocked hits bank locks (max 2). Next shot burns a lock into a weaker homing bolt. **→** Each blocked hit stores a lock (max 2). Your next shot spends one to loose a weaker homing bolt. | It bit. Now it owes you. **→** What bit you now hunts for you. |
| `crimson-tithe` | (unchanged) | The congregation pays in what it bleeds. **→** Strike, and be restored. |
| `shadow-step` | Active (9s cooldown): blink toward your aim. Walls are a suggestion; landing inside one is not. **→** Active (9s cooldown): blink toward your aim — pass through walls, but you cannot land inside one. | Filed in the space between spaces. Approved before it was asked. **→** The space between spaces opens for you. |
| `veil-of-nought` | Active (1.5s, 16s cooldown): unmade — homing and satellites lose you; firing ends it early. **→** Active (1.5s, 16s cooldown): become untraceable — homing and satellites lose you; firing ends it early. | The archons cannot audit what is not. **→** The archons cannot strike what is not. |
| `sunlance` | Active (0.7s window, 7s cooldown): shots deal 1.6x damage while it holds. **→** Active (0.7s window, 7s cooldown): your shots strike at 1.6x damage while it holds. | I finished a sentence the crystal started. **→** A moment of sun, honed to a point. |
| `prism-fan` | (unchanged) | Still crystal munitions — just more of the angle. **→** Split the light; every ray still cuts. |
| `lattice` | Active (9s cooldown): a crystal lattice plane settles around you, damaging anyone standing in it for a few seconds. **→** Active (9s cooldown): a crystal lattice plane settles around you, damaging all standing in it for a few seconds. | Space denial, angle-first. **→** Where you stand, structure follows. |
| `hard-aperture` | Active (0.6s window, 9s cooldown): a damage gate — halves incoming gunfire while it holds. Melee, ability blasts, and burn ticks pass through untouched. **→** Active (0.6s window, 9s cooldown): halves incoming gunfire. Melee, ability blasts, and burn ticks pass through. | (unchanged) |
| `overclock` | (unchanged) | Cast-weave fuel. **→** Three seconds of more than you were. |
| `slip-node` | (unchanged) | Reposition, not freeflow. **→** Space bends for the one who studied it. |
| `recoil-step` | Active (6s cooldown): hop opposite your aim; shots fired in the next 1.2s barely push you around. **→** Active (6s cooldown): hop opposite your aim; shots you fire in the next 1.2s barely push you around. | Micro-kiting, the geometrician's way. **→** Every step back is drawn, not driven. |
| `bastion-pulse` | Active (8s cooldown): instant shield-charge tick, doubled if Ward is actively held. **→** Active (8s cooldown): an instant shield-charge tick — doubled if Ward is actively held. | Ward synergy, not a second shield identity. **→** Hold the line, and the line holds you. |
| `sunspike` | Active (7s cooldown): an aimed thrust — a single fast, narrow, short-range hit. High single-target damage. **→** Active (7s cooldown): a fast aimed thrust — one narrow, short-range hit. High single-target damage. | Focus the one who ignored the line. **→** All of dawn, driven through one point. |
| `judgment-line` | Active (3s mark, 8s cooldown): marks the nearest foe in your aim cone — your Kindled Edge hits on them are amplified. **→** Active (3s mark, 8s cooldown): mark the nearest foe in your aim cone; Kindled Edge hits on them are amplified. | Duel the tank. **→** Choose your whetstone, and meet it. |
| `unbroken-seal` | Active (5s window, 7s cooldown): your next landed Kindled Edge hit is amplified and staggers the victim. **→** Active (5s window, 7s cooldown): your next landed Kindled Edge hit is amplified and staggers the foe. | One committed overhead that lands. **→** Everything you are, behind one blow. |
| `aegis-share` | Active (3s window, 8s cooldown): your team-peel shadow (Kindled Ward's reach for allies) widens — no ally nearby, gain Kindling instead. **→** Active (3s window, 8s cooldown): Kindled Ward reaches further for allies; no ally near, gain Kindling instead. | Peel readable, peel real. **→** Your shield was always wide enough for two. |
| `plant-charge` | Active (6s cooldown): a short charge that ends in a Ward-ready stance, tipping your shield charge up. **→** Active (6s cooldown): a short charge that ends in a Ward-ready stance and tips your shield charge up. | Plant to plant, not freeflow. **→** Charge, plant, become the wall. |
| `shock-ring` | Active (9s cooldown): a modest hop, then a slam shock on landing. Space claim, not sky-god. **→** Active (9s cooldown): a modest hop, then a slam shock on landing. Claim the ground you take. | (unchanged) |
| `rally-light` | Active (5s window, 9s cooldown): allies near you (including you, solo-safe) fight harder and move quicker. **→** Active (5s window, 9s cooldown): allies near you — yourself included, even alone — fight harder, move quicker. | (unchanged) |
| `kindled-resolve` | Active (4s window, 12s cooldown, spends 40 Kindling): harden your resolve — resist stagger, hit a little harder. No Kindling banked, no effect. **→** Active (4s window, 12s cooldown): spend 40 Kindling — resist stagger, hit a little harder. None banked, no effect. | (unchanged) |
| `bleed-tithe` | Active (6s cooldown): a self-guiding fire-tendril finds the nearest enemy on its own — burns them and tithes a fraction of the damage back to you. **→** Active (6s cooldown): a fire-tendril seeks the nearest enemy on its own — burns them, tithes part of the damage to you. | It finds them. You don't have to. **→** What it burns, it brings home. |
| `severance` | (unchanged) | The debt comes due on its own schedule. **→** You name the hour the debt falls due. |
| `borrowed-time` | Active (8s cooldown): heals the nearest hurt ally on its own — some of it drains back a few seconds later, whether or not they earned it. Self-cast if no ally nearby needs it, weaker both ways. **→** Active (8s cooldown): heals the nearest hurt ally on its own; part drains back a few seconds later. No ally nearby in need: self-cast, weaker both ways. | I already gave you more than you'll pay back. **→** Take the loan. Win before it's due. |
| `focus-hex` | Active (6s cooldown): marks the nearest enemy without needing to aim at them — your hits on the marked target amplify while it lasts. **→** Active (6s cooldown): marks the nearest enemy — no aim needed. Your hits on the mark amplify while it lasts. | You were already the closest thing to me. **→** Undivided attention is a weapon. |
| `contagion` | Active (9s cooldown): every burning enemy nearby passes their fire on to the nearest un-burned enemy — the word spreads on its own. **→** Active (9s cooldown): every burning enemy nearby spreads their fire to the nearest un-burned enemy. | It only ever touches what was already lawfully applied. **→** Kindle one. Ignite them all. |
| `flock-pulse` | Active (7s cooldown): a weak cool-white nova around you that also slows — grows with every ally you're buffing and every enemy you have burning. **→** Active (7s cooldown): a weak cool-white slowing nova around you — grows with every ally you're buffing and every enemy you have burning. | The congregation, counted. **→** Everyone you lift lifts you. |
| `self-lattice` | Active (6s cooldown): a small absorb barrier on yourself — deliberately weaker than what you'd cast on an ally. Solo still has a button. **→** Active (6s cooldown): a small absorb barrier on yourself — weaker, by design, than what you'd grant an ally. | Invest outward. This is what's left for you. **→** Give everything. Keep enough. |
| `glass-ward` | Active (7s cooldown): a stronger absorb barrier finds the nearest ally on its own — falls back to a weaker self-cast if nobody's close enough. **→** Active (7s cooldown): a stronger absorb barrier seeks your nearest ally — weaker self-cast if none is near. | Teams peak here. Solo still has a floor. **→** Armor the arm that fights beside you. |
| `haste-gift` | Active (7s cooldown): a haste tendril finds the nearest ally on its own — self-cast at half strength if you're alone. **→** Active (7s cooldown): a haste tendril seeks your nearest ally on its own — self-cast at half strength if alone. | Keep pace with what I gave you. **→** Swiftness shared is swiftness doubled. |
| `drift-step` | Active (6s cooldown): a short reposition toward your aim — keep curse/gift uptime alive without leaving the fight. **→** Active (6s cooldown): a short step toward your aim — hold curse and gift uptime without leaving the fight. | Not Interstice speed. Just enough. **→** A step toward, never away. |
| `undercut` | Active (8s cooldown, 4s window): a landed arc hit against anyone already below 15% health finishes them outright. **→** Active (8s cooldown, 4s window): a landed arc hit on anyone below 15% health finishes them outright. | You were already gone. This just made it official. **→** You made the opening. Take it. |
| `edge-storm` | Active (8s cooldown, 6s window): your next three swings emit a hard-hitting wave when they finish — a whiff still fires it, an interrupted swing doesn't. **→** Active (8s cooldown, 6s window): next 3 swings each finish with a heavy wave — whiffs fire it, interrupts don't. | (unchanged) |
| `needle` | Active (5s cooldown): close the last few feet on the nearest enemy and put a fast, hard shard through them — no target, no cast. **→** Active (5s cooldown): close the last few feet and put a fast, hard shard through the nearest enemy — no aim, no cast. | (unchanged) |
| `read-mark` | Active (6s cooldown, 5s window): mark the nearest enemy without needing to aim at them — while marked, every arc hit you land on them cuts harder. **→** Active (6s cooldown, 5s window): mark the nearest enemy — no aim. While marked, your arc hits on them cut harder. | I already modeled you. This is just showing my work. **→** The blade finishes what knowing began. |
| `shard-ring` | (unchanged) | The air kept cutting after I stopped moving. **→** Stillness is not surrender. |
| `wall-bloom` | (unchanged) | The wall remembers the kick longer than you do. **→** Even your leaving cuts. |
| `ghost-guard` | Active (9s cooldown, 6s window): banks one near-miss — the next ordinary hit that lands while you're moving simply doesn't. Burn, void, and chain damage still get through. **→** Active (9s cooldown, 6s window): while you move, the next ordinary hit doesn't land. Burn, void, chain still do. | You hit where I was. **→** Motion is its own armor. |
| `second-wind` | Active (8s cooldown, 1.5s window): land a hit in the next 1.5s for a flat burst of health and energy — not a cut of the damage dealt. **→** Active (8s cooldown, 1.5s window): land one hit for a flat burst of health and energy — not scaled to damage dealt. | (unchanged) |
| `razor-route` | (unchanged) | Faster than the read that was supposed to catch me. **→** Make the road a razor. |
| `paper-double` | Active (9s cooldown): spawn a decoy sprinting your heading — dies at 20 damage or 2.5s, and its burst hits for 10 in a 90px radius and fools victims into taking +25% damage for 2s. Cast during a resonance window and you swap places with a live decoy instead. **→** Active (9s cooldown): decoy sprints your heading, dies at 20 damage or 2.5s, bursts 10 in 90px; struck: +25% damage, 2s. Resonance cast: swap with a live decoy. | Same feet, same weight, same lie. **→** Let them fight the echo. Arrive as the answer. |

### Assembler deviation (1) — needs Jake's eye

- `paper-double`: the judged proposal's description was 220 chars, over the 160-char card-face cap the voice-lint test enforces (old copy was 258 — a pre-existing violation). Applied a tightened 160-char version that keeps every mechanical fact (9s cooldown, decoy sprints your heading, dies at 20 damage or 2.5s, 10 burst in 90px, +25% damage for 2s on struck, resonance-window swap with a live decoy):
  - Proposal (220): "Active (9s cooldown): a decoy sprints your heading — dies at 20 damage or 2.5s, bursting for 10 in a 90px radius; those struck take +25% damage for 2s. Cast in a resonance window to swap places with a live decoy instead."
  - Applied (160): "Active (9s cooldown): decoy sprints your heading, dies at 20 damage or 2.5s, bursts 10 in 90px; struck: +25% damage, 2s. Resonance cast: swap with a live decoy."

## Cards left unchanged (16)

No proposals failed judging (0 judgePass=false). These 16 were judged already on-register and proposed as-is:

| id | judge reason |
| --- | --- |
| `arc-shards` | Left unchanged, correctly — original description is mechanically clear (lob arcs over cover, drops fire on ledges/platforms) and 'Gravity works for you.' is already second-person and self-empowering. |
| `bouncy-prism` | Copy unchanged and already in-register ('Own the corridors', 'Walls are just more aim' — terse, empowering, mechanically clear: up to four ricochets, brighter each bounce). The 'Ricochet Prism' rename is correctly presented as a flagged candidate only, not an applied value, which the name constraint permits. |
| `x-velocity` | Unchanged copy already in-register: terse, second-person, forward-leaning ('Be there first.'); mechanics trivially preserved. |
| `zero-g-floaters` | Copy unchanged and already in-register ('Hang time is a weapon.'); the rename is correctly flagged only as a candidate ('Weightless Shards'), not applied, which complies with the name-preservation constraint. |
| `wide-barrage` | Unchanged copy passes as-is: 'Not aim — weather.' frames the player's fire as an overwhelming force (self-empowering, not grimdark or jokey); mechanics trivially preserved. |
| `slow-field` | Unchanged is acceptable: description is a clean mechanical tooltip (slowing crystal aura on impact, combo setup, escape denial) and 'Time snags on the facets' sits comfortably in the crystal grammar — no banned vocab, no grimdark, no jokey register. Nothing to fix. |
| `frost-prism` | Unchanged is acceptable: tooltip states the mechanics plainly (ice, freezing facets, slow-leaning hits, lock-then-finish) and 'Cold light cuts clean' is terse, confident, and in the crystal grammar with no banned vocab or off-register tone. |
| `lead-boots` | Kept as-is, and the original is already in-register: "Drop onto fights like a hammer" is forward-leaning arming language, "Down arrives on time" is terse and confident without being jokey. All mechanics (heavier fall, slightly faster run, sooner wall-jump landings) intact. |
| `spring-heel` | Kept as-is; already clean crucible copy. "Reach routes others cannot; dive from above" is self-empowering and terse, "The ground pushes back" is optimistic physics-as-ally flavor. Mechanics (higher jump and wall-jump) fully stated. |
| `blink-dash` | Kept as-is; the description is load-bearing UI copy (DASH unlock, C / dash button, one air-dash per land) and correctly left alone. "Be elsewhere. Now." is terse imperative self-empowerment, squarely in-register. |
| `severing-answer` | Unchanged proposal is right — the original is already in-register: mechanics clear (0.5s, 12s cooldown, next hit negated and returned, capped), 'Ask again.' is terse forward-leaning crucible flavor, signed-off name intact, no banned vocab. |
| `shelter-seal` | Unchanged proposal is right — signed-off name Shelter Writ and its flavor riff stay; 'writ' is not on the banned-word list and is inherent to two Jake-signed-off names. Mechanics clear and intact (2.5s, 12s cooldown, damage halved while shell holds); flavor reads as protective sanctuary, not tribunal register. |
| `facet-break` | Unchanged; original was already in-register. Mechanics intact by definition, flavor is empowering precision imagery with no banned vocab, and the copy is terse. |
| `return-glass` | Unchanged; mechanics intact by definition. Flavor 'What broke, mends — a little.' sits squarely in the what-breaks-you-arms-you grammar, optimistic and terse, no banned vocab. |
| `measure` | Unchanged; mechanics intact by definition. Flavor 'The true line, drawn once.' is terse, earned, self-empowering precision — already in-register with no banned vocab. |
| `bulwark-step` | Proposed unchanged, and the original already sits squarely in-register: terse, self-empowering, mechanics fully explicit (4s cooldown, lateral shuffle in current walk direction, Ward never drops). Nothing to fix. |

## Rename CANDIDATES (9) — flagged only, awaiting Jake

Not applied. Card `id`s are load-bearing (glyphs, saves, draft offers); a rename would touch `name` only, but even that is held for sign-off.

| id | current name | candidate |
| --- | --- | --- |
| `triangle-rounds` | Triangle Rounds | **Spire Rounds** |
| `orby-blap-blap` | Orby Blap Blap | **Twin Orbs** |
| `bouncy-prism` | Bouncy Prism | **Ricochet Prism** |
| `zero-g-floaters` | Zero-G Floaters | **Weightless Shards** |
| `orbiting-satellites` | Orbiting Satellites | **Attendant Shards** |
| `cluster-bomb` | Cluster Bomb | **Fracture Bloom** |
| `aim-barrier` | Aim Barrier | **Meant Angle** |
| `judgment-line` | Judgment Line | **Whetstone Mark** |
| `contagion` | Contagion | **Wildfire** |

## Record surfaces — applied (6)

All applied changes land in `client/src/game/ui/MatchResultsOverlay.ts` — the single results renderer for world and room modes.

| file | current | applied | note |
| --- | --- | --- | --- |
| `client/src/game/ui/MatchResultsOverlay.ts` | MATCH WINNER | THE RECORD NAMES ITS VICTOR | Line 121, subtitle under the winner's big name — the record does the naming so the victor never gloats; still unambiguous as 'this player won'. |
| `client/src/game/ui/MatchResultsOverlay.ts` | `First to ${view.targetScore}` | `First to ${view.targetScore} — the record closes level` | Line 126, draw-case subtitle — 'First to N' survives verbatim; the draw is stated plainly, awarded to no one. |
| `client/src/game/ui/MatchResultsOverlay.ts` | `First to ${view.targetScore} · match over` | `First to ${view.targetScore} · the record is closed` | Line 131, secondary subtitle under the winner — flat 'match over' becomes the record's close; mechanics verbatim. |
| `client/src/game/ui/MatchResultsOverlay.ts` | FINAL BUILD | BUILD AS IT STOOD | Line 270, per-row card-stack label — keeps the cross-surface mechanical word BUILD (BuildChangeToast/describeBuild use it mid-fight) while reading as testimony of the stack when the record closed. |
| `client/src/game/ui/MatchResultsOverlay.ts` | STARTER BUILD | BUILD AS FORGED | Line 270, zero-draft case — 'as forged' = base vessel, pairs with the empty-list line below; BUILD anchor word retained. |
| `client/src/game/ui/MatchResultsOverlay.ts` | No cards drafted | No cards drafted — stood as forged | Line 274 — dignity for the base-kit combatant; the mechanical fact stays verbatim up front. |

## Record surfaces — deliberate keeps / flags (6)

| file | string | ruling |
| --- | --- | --- |
| `client/src/game/ui/MatchResultsOverlay.ts` | DRAW | Line 123, the big title carries the bare mechanical fact; the register moves into the subtitle below — renaming the title would trade clarity for tone. |
| `client/src/game/ui/MatchResultsOverlay.ts` | Rematch / Back to Lobby | Lines 147/152 — action buttons take imperative clarity over register; the record voice lives in the testimony lines, not the exits. |
| `client/src/game/ui/MatchResultsOverlay.ts` | Share highlight / Copied! / Check out this play from JAKESJAM! | Lines 160/172/167 — sanctioned gold-exception house feature plus outbound share-sheet voice (revenue over purity); same strings repeat in DeathOverlay.ts, ClipShareToast.ts, ShellController.ts — keep everywhere for consistency. |
| `client/src/game/ui/DeathOverlay.ts` | ELIMINATED | Line 76 — docs/visual-language-gnostic-vessel.md explicitly rules 'no YOU DIED clone; keep ELIMINATED'; flagged only, not a candidate. |
| `client/src/game/scenes/MatchScene.ts` | OFF COURSE / Recovering — try again | Line 200, practice-mode DeathOverlay variant — practice copy is deliberately non-combat (docs/practice-zone-goal.md); a register push would import crucible framing where there is no opponent. |
| `client/src/game/scenes/OnlineMatchScene.ts` | Waiting for next round… | Line 2972, status line after clicking Rematch — functional boundary string; if touched at all it should state the ready mechanic ('Ready — next round when all have answered'), but keep is the default. |

### Skipped by the assembler (1) — mid-fight surface, out of this pass's scope

- `client/src/game/ui/DeathOverlay.ts` line ~76, default respawn subtitle: proposal "Watch the arena — you're going back in" → "Watch the arena — what breaks you, arms you". The proposal is crucible-register (correct for the surface), but the brief scopes this pass to end-of-match surfaces only and the respawn subtitle is mid-fight HUD. Flagged for a follow-up in-play copy pass; not applied here.

## Proposed epigraphs (5) — future content, NOT applied

Suggestion from the record-surfaces agent: a small const array in a new `client/src/game/ui/resultEpigraphs.ts`, rendered as one quiet mono line between subtitle and scoreboard in MatchResultsOverlay.

1. "Let the record show: none left as they entered." — suggest a small const array in a new client/src/game/ui/resultEpigraphs.ts, rendered as one quiet mono line between subtitle and scoreboard in MatchResultsOverlay; draw-safe.
2. "Every mark in this record was paid in full." — tallies as testimony; draw-safe.
3. "The fallen are entered beside the victor. The record keeps them all." — dignity for the fallen, victor ascendant without gloat; winner screens only (skip on DRAW).
4. "What the arena unmade, the record remembers." — 'unmade' vocabulary lives only on this end-of-match surface per the register split; draw-safe.
5. "The tally is testimony. The arena keeps no secrets." — the enormity stated plainly; draw-safe.

## Survey notes

- Searched the whole client: killstreak labels (killstreakLabels.ts) and RoundBanner round-over copy ('TO X' / 'DRAW') are mid-fight/round-boundary HUD and excluded per brief; the only cycle-end run-summary copy is the FINAL BUILD line + card chips covered above. MatchResultsOverlay is the single results renderer (fed by HudCompositor.ts and OnlineMatchScene.ts), so every rewrite lands in world and room modes at once.
