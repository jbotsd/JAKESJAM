# ROUNDS Gameplay Screenshot Reference List

**Purpose:** Gather visual references for JAKESJAM adaptation  
**Date:** 2026-05-02  
**Target:** 20 specific screenshots with design rationale

---

## How to Use This List

1. **Find ROUNDS gameplay footage** (YouTube, Twitch, Steam screenshots)
2. **Capture or timestamp** each listed screenshot
3. **Save to:** `docs/rounds-reference/screenshots/`
4. **Name format:** `01-draft-ui-3cards.png`, `02-combat-projectiles.png`, etc.
5. **Reference in design docs** when implementing features

---

## Category 1: Draft Phase (5 screenshots)

### 01. Draft UI - Three Card Choice

**WHAT TO CAPTURE:**
- Full draft screen showing 3 card options
- Player character/build visible in background (dimmed)
- Card rarity colors clearly visible
- Any timer or "choose your upgrade" text

**WHERE TO FIND:**
- Search: "ROUNDS gameplay draft" or "ROUNDS card selection"
- YouTube timestamps: Look for post-round moments
- Steam Community Hub → Screenshots → Filter "Draft"

**WHY IT MATTERS FOR JAKESJAM:**
- Reference for card layout (horizontal vs vertical)
- Card size ratios (width:height)
- Rarity color coding (common/uncommon/rare)
- Background treatment during draft
- Text hierarchy (title > effect > stats)

**IMPLEMENTATION REFERENCE:**
- `client/src/game/scenes/DraftScene.ts` - Layout structure
- Card spacing, sizing, and positioning
- Color palette for rarity borders

---

### 02. Draft UI - Card Hover/Selection State

**WHAT TO CAPTURE:**
- Close-up of a single card when hovered/selected
- Any stat change indicators (+green/-red numbers)
- Highlight effects or borders
- Tooltip or expanded description if present

**WHERE TO FIND:**
- Video reviews with commentary (streamers often hover cards)
- Twitch VODs of ROUNDS gameplay
- Discord communities sharing clips

**WHY IT MATTERS FOR JAKESJAM:**
- Hover state design (glow, scale, border?)
- Stat display format (inline vs separate boxes)
- Benefit/penalty color coding
- Animation timing (how fast does hover respond?)

**IMPLEMENTATION REFERENCE:**
- `client/src/game/ui/CardHover.ts` - Interaction feedback
- Benefit text: `#4ADE80` (green)
- Penalty text: `#F87171` (red)

---

### 03. Draft UI - Current Build Display

**WHAT TO CAPTURE:**
- Any UI showing already-owned cards during draft
- Card stack indicators (if duplicates shown)
- Build summary or active effects list

**WHERE TO FIND:**
- Late-game draft moments (round 4-5 when players have many cards)
- Streamer overlays sometimes show build summaries

**WHY IT MATTERS FOR JAKESJAM:**
- Where to display existing build (top of screen? side?)
- How to show card stacks (number badge? repeated icons?)
- Synergy highlighting (do owned cards glow during draft?)

**IMPLEMENTATION REFERENCE:**
- `client/src/game/ui/Hud.ts` - Build summary panel
- Stack display: small number badge on card corner

---

### 04. Draft Result - Card Applied Feedback

**WHAT TO CAPTURE:**
- Moment after card selection is confirmed
- Any visual feedback on player character
- Transition back to gameplay
- "Card acquired" or similar confirmation text

**WHERE TO FIND:**
- Post-draft moments in gameplay videos
- Look for visual changes to character/projectiles

**WHY IT MATTERS FOR JAKESJAM:**
- Confirmation that selection registered
- Transition timing (how long until next round?)
- Character update feedback (glow, animation, particle?)

**IMPLEMENTATION REFERENCE:**
- `client/src/game/systems/CardSystem.ts` - Apply card visual feedback
- Particle flash on player, projectile change preview

---

### 05. Draft UI - Rarity Distribution

**WHAT TO CAPTURE:**
- Multiple draft screens showing different rarity mixes
- Common (white/gray), Uncommon (blue), Rare (magenta) cards
- Frequency of each rarity appearing

**WHERE TO FIND:**
- Compilation videos or long playthroughs
- Collect screenshots from different matches

**WHY IT MATTERS FOR JAKESJAM:**
- Rarity color palette reference
- Distribution balance (how often do rares appear?)
- Comeback weighting (do losing players see more rares?)

**IMPLEMENTATION REFERENCE:**
- Common border: `#9CA3AF` (gray)
- Uncommon border: `#3B82F6` (blue)
- Rare border: `#D946EF` (magenta)

---

## Category 2: Combat Showing Cards (5 screenshots)

### 06. Combat - Projectile Variety

**WHAT TO CAPTURE:**
- Multiple projectile types visible simultaneously
- Different sizes, colors, trails
- Bouncing, exploding, or special projectiles

**WHERE TO FIND:**
- Late-game combat (round 3+ when builds are developed)
- "Insane ROUNDS build" compilation videos

**WHY IT MATTERS FOR JAKESJAM:**
- Projectile visual differentiation
- Size scaling reference (how big is "big bullets"?)
- Trail effects for different projectile types
- Color coding for elemental/status effects

**IMPLEMENTATION REFERENCE:**
- `client/src/game/systems/ProjectileSystem.ts` - Visual variants
- `client/src/game/data/projectileModifiers.ts` - Size/speed/trail data

---

### 07. Combat - Character Size Changes

**WHAT TO CAPTURE:**
- Side-by-side comparison of normal vs enlarged character
- Cards that make player larger (Homing Greed style)
- Visual indicator of size modifier

**WHERE TO FIND:**
- Videos showing "Homing" card or similar size-tradeoff cards
- Before/after draft comparison shots

**WHY IT MATTERS FOR JAKESJAM:**
- Size scale reference (1.5x? 2x? how visible?)
- Hitbox visualization (does hitbox match visual?)
- Tradeoff clarity (can opponents see you're bigger?)

**IMPLEMENTATION REFERENCE:**
- `client/src/game/entities/Player.ts` - Size scaling
- Character scale: 1.0 (normal) to 2.0 (maximum)

---

### 08. Combat - Block/Defense Activation

**WHAT TO CAPTURE:**
- Shield/block visual effects
- Bombs Away explosion on block
- EMP ring projectiles
- Any defensive ability activation

**WHERE TO FIND:**
- Defensive build gameplay
- Cards like "Bombs Away", "EMP", "Shield Charge"

**WHY IT MATTERS FOR JAKESJAM:**
- Active defense feedback (block is an input, not passive)
- Explosion/shield VFX timing
- Color coding for defensive effects

**IMPLEMENTATION REFERENCE:**
- `client/src/game/systems/CombatSystem.ts` - Block activation
- Shield flash duration: 0.3s
- Explosion radius: 100-150px

---

### 09. Combat - Status Effects

**WHAT TO CAPTURE:**
- Burning, slowed, poisoned, or other status indicators
- Visual markers above player heads
- Ground effects (fire patches, poison clouds)

**WHERE TO FIND:**
- Videos featuring "Poison", "Cold Bullets", "Toxic Cloud"
- Status effect compilation if available

**WHY IT MATTERS FOR JAKESJAM:**
- Status icon design (simple, readable at small size)
- Ground effect persistence (how long do they last?)
- Player feedback (do they know they're burning?)

**IMPLEMENTATION REFERENCE:**
- `client/src/game/types/game.ts` - StatusEffect type
- Status duration: 2-5 seconds typical
- Icon size: 32x32px minimum

---

### 10. Combat - Build Synergy in Action

**WHAT TO CAPTURE:**
- Multiple cards working together visibly
- Example: Spray + Scavenger (never reloading)
- Example: Tactical Reload + Shields Up (infinite block)
- Chaos moments with many effects active

**WHERE TO FIND:**
- "Broken ROUNDS build" videos
- High-level gameplay with developed builds
- Community highlight reels

**WHY IT MATTERS FOR JAKESJAM:**
- Visual clarity when many effects active
- Performance reference (how many projectiles is too many?)
- Combo readability (can you tell what's happening?)

**IMPLEMENTATION REFERENCE:**
- `client/src/game/systems/CardSystem.ts` - Synergy detection
- Projectile cap: 50-100 active max
- Effect priority: projectiles > explosions > trails > ambient

---

## Category 3: UI Elements (5 screenshots)

### 11. Health Bar - Normal State

**WHAT TO CAPTURE:**
- Player and opponent health bars
- Position (above head? bottom of screen?)
- Color (green? gradient?)
- Any shield/armor overlay

**WHERE TO FIND:**
- Any gameplay footage, pause at clear moment
- HUD-focused screenshots

**WHY IT MATTERS FOR JAKESJAM:**
- Health bar placement (world-space vs screen-space)
- Size (readable but not obtrusive)
- Color (green for healthy, red for low?)
- Shield overlay design

**IMPLEMENTATION REFERENCE:**
- `client/src/game/ui/Hud.ts` - Health bar component
- Bar size: 100x8px for player, 80x6px for opponent
- Colors: `#22C55E` (healthy), `#EF4444` (low <30%)

---

### 12. Health Bar - Low Health State

**WHAT TO CAPTURE:**
- Health bar when critically low (<25%)
- Any warning indicators (flashing, red tint, sound wave?)
- Screen effects (vignette, color shift?)

**WHERE TO FIND:**
- Close match moments
- "Low HP comeback" videos

**WHY IT MATTERS FOR JAKESJAM:**
- Urgency feedback (player knows they're in danger)
- Visual intensity (subtle vs dramatic?)
- Accessibility (colorblind-friendly warnings?)

**IMPLEMENTATION REFERENCE:**
- Flash frequency: 2Hz when <25% HP
- Screen vignette: subtle red overlay
- Audio cue: heartbeat sound

---

### 13. Ammo/Reload Indicator

**WHAT TO CAPTURE:**
- Ammo counter or reload progress bar
- Visual style (numbers? bar? dots?)
- Empty weapon indicator
- Reload animation or progress

**WHERE TO FIND:**
- Gameplay with weapons that have magazines
- Cards like "Spray", "Barrage" that show ammo clearly

**WHY IT MATTERS FOR JAKESJAM:**
- Ammo tracking method (numeric vs visual)
- Reload progress feedback (circular bar? linear?)
- Empty state clarity (click sound? visual indicator?)

**IMPLEMENTATION REFERENCE:**
- `client/src/game/ui/Hud.ts` - Ammo display
- Ammo dots: 8-12 dots max for readability
- Reload bar: circular, 1.0-1.5s typical

---

### 14. Round/Score Display

**WHAT TO CAPTURE:**
- Current round number
- Player scores (rounds won)
- Match format (first to 3? best of 5?)
- Position (top center? corners?)

**WHERE TO FIND:**
- Any gameplay, look at HUD corners
- Match start/end moments

**WHY IT MATTERS FOR JAKESJAM:**
- Score tracking visibility
- Round number clarity
- Match progress awareness

**IMPLEMENTATION REFERENCE:**
- `client/src/game/ui/Hud.ts` - Score panel
- Position: top center, 48px from top
- Format: "Round 3" / "P1: 2 - 1:P2"

---

### 15. Round Result Banner

**WHAT TO CAPTURE:**
- "ROUND 1 - PLAYER 1 WINS" or similar
- Animation (slide in? fade? zoom?)
- Duration before transition to draft
- Colors (green for win, red for loss?)

**WHERE TO FIND:**
- End of every round in gameplay videos
- Multiple examples for animation study

**WHY IT MATTERS FOR JAKESJAM:**
- Result clarity (who won? how clear?)
- Timing (how long displayed before draft?)
- Emotional weight (celebratory vs neutral?)

**IMPLEMENTATION REFERENCE:**
- `client/src/game/scenes/MatchScene.ts` - Round end flow
- Banner duration: 2 seconds
- Transition: 0.5s fade to draft

---

## Category 4: Visual Effects (3 screenshots)

### 16. Muzzle Flash & Fire Effect

**WHAT TO CAPTURE:**
- Weapon firing visual
- Muzzle flash shape and size
- Fire rate visualization (continuous flash on auto?)
- Recoil animation

**WHERE TO FIND:**
- Close-up combat shots
- Weapon showcase videos if available

**WHY IT MATTERS FOR JAKESJAM:**
- Fire feedback (does every shot feel impactful?)
- Flash duration (single frame? multiple?)
- Recoil kick (screen shake? weapon animation?)

**IMPLEMENTATION REFERENCE:**
- `client/src/game/systems/CombatSystem.ts` - Fire VFX
- Muzzle flash: 3-5 frame animation
- Recoil: 2-4px weapon kickback

---

### 17. Projectile Impact/Explosion

**WHAT TO CAPTURE:**
- Bullet hitting terrain or player
- Explosion radius visualization
- Spark/debris particles
- Impact flash brightness

**WHERE TO FIND:**
- Explosive bullet gameplay
- Combat with environmental destruction

**WHY IT MATTERS FOR JAKESJAM:**
- Impact readability (can you tell what hit what?)
- Explosion size reference (50px? 100px radius?)
- Particle density (how much is too much?)

**IMPLEMENTATION REFERENCE:**
- `client/src/game/systems/ProjectileSystem.ts` - Impact VFX
- Explosion radius: 60-120px depending on card
- Particle count: 8-16 per explosion

---

### 18. Movement Trails & Effects

**WHAT TO CAPTURE:**
- Speed boost trails
- Jump/dash effects
- Teleport or blink visuals
- Any movement-enhancing card VFX

**WHERE TO FIND:**
- Movement-focused builds
- "Speedrun" or high-mobility gameplay

**WHY IT MATTERS FOR JAKESJAM:**
- Speed visualization (can you tell they're fast?)
- Trail persistence (how long do trails last?)
- Motion clarity (not too distracting?)

**IMPLEMENTATION REFERENCE:**
- `client/src/game/systems/MovementSystem.ts` - Trail particles
- Trail duration: 0.3-0.5s fade
- Color: player-specific or card-specific

---

## Category 5: Feedback & Polish (2 screenshots)

### 19. Hit Marker/Damage Number

**WHAT TO CAPTURE:**
- Hit confirmation (X marker? flash? sound wave?)
- Damage numbers if present
- Critical hit indicators
- Position (near impact? near health bar?)

**WHERE TO FIND:**
- Clear combat shots
- Damage recap moments

**WHY IT MATTERS FOR JAKESJAM:**
- Hit feedback (did I hit them?)
- Damage communication (how much did I do?)
- Satisfaction (does hitting feel good?)

**IMPLEMENTATION REFERENCE:**
- `client/src/game/systems/CombatSystem.ts` - Hit feedback
- Hit marker: 0.2s fade, white or player color
- Damage numbers: optional, float upward 0.5s

---

### 20. Death/Elimination Effect

**WHAT TO CAPTURE:**
- Player death animation
- Explosion, disintegration, or ragdoll
- Death icon in score feed
- Respawn timer if applicable

**WHERE TO FIND:**
- Round-ending moments
- Elimination montages

**WHY IT MATTERS FOR JAKESJAM:**
- Death clarity (no ambiguity about who died)
- Emotional weight (satisfying, not gruesome)
- Respawn timing (if applicable)

**IMPLEMENTATION REFERENCE:**
- `client/src/game/entities/Player.ts` - Death handling
- Death animation: 0.5-1.0s
- Respawn: N/A for 1v1 duel (round-based)

---

## Screenshot Organization

### File Naming Convention

```
docs/rounds-reference/screenshots/
├── 01-draft-ui-3cards.png
├── 02-draft-ui-hover-state.png
├── 03-draft-ui-build-display.png
├── 04-draft-result-feedback.png
├── 05-draft-rarity-distribution.png
├── 06-combat-projectile-variety.png
├── 07-combat-character-size.png
├── 08-combat-block-activation.png
├── 09-combat-status-effects.png
├── 10-combat-build-synergy.png
├── 11-ui-healthbar-normal.png
├── 12-ui-healthbar-low.png
├── 13-ui-ammo-reload.png
├── 14-ui-score-display.png
├── 15-ui-round-result.png
├── 16-vfx-muzzle-flash.png
├── 17-vfx-impact-explosion.png
├── 18-vfx-movement-trails.png
├── 19-feedback-hit-marker.png
└── 20-feedback-death-effect.png
```

### Reference Matrix

Create a spreadsheet or table linking screenshots to implementation files:

| Screenshot | Feature | Implementation File | Priority |
|------------|---------|---------------------|----------|
| 01 | Draft UI layout | `DraftScene.ts` | 🔴 High |
| 06 | Projectile variety | `ProjectileSystem.ts` | 🔴 High |
| 11 | Health bar | `Hud.ts` | 🔴 High |
| 15 | Round result | `MatchScene.ts` | 🔴 High |
| 19 | Hit feedback | `CombatSystem.ts` | 🟡 Medium |

---

## Where to Find ROUNDS Footage

### Primary Sources

1. **YouTube Search:**
   - "ROUNDS gameplay"
   - "ROUNDS all cards"
   - "ROUNDS best builds"
   - "ROUNDS draft guide"

2. **Steam Community:**
   - Store page: https://store.steampowered.com/app/1000040/ROUNDS/
   - Community Hub → Screenshots
   - Filter by "Draft", "Combat", "UI"

3. **Twitch:**
   - Search "ROUNDS" category
   - VODs from fighting game streamers
   - Look for card selection moments

4. **Discord Communities:**
   - ROUNDS official Discord (if exists)
   - Indie game Discords
   - Fighting game community servers

### Secondary Sources

- Reddit: r/ROUNDSgame (if exists)
- Twitter/X: #ROUNDSgame hashtag
- TikTok: Short gameplay clips
- itch.io: ROUNDS page (if listed)

---

## Capture Guidelines

### Technical Specifications

- **Resolution:** 1920x1080 minimum (or source resolution)
- **Format:** PNG for UI shots (lossless), WebP acceptable for effects
- **Quality:** Maximum quality, no compression artifacts
- **Aspect Ratio:** 16:9 (match ROUNDS native)

### Ethical Considerations

- **Fair Use:** Screenshots for reference/education are fair use
- **Attribution:** Note source if from specific creator
- **No Redistribution:** Don't repost others' content without permission
- **Personal Use:** These are for internal dev reference only

---

## Next Steps

1. **Gather screenshots** using this list as guide
2. **Organize into folders** by category
3. **Reference in implementation** (link screenshots to code comments)
4. **Create mood board** for art team reference
5. **Update design docs** with specific visual targets

**Save completed screenshots to:**
`/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/docs/rounds-reference/screenshots/`
