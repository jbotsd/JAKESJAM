# 2D Flat Lighting & Glow Effects — Deep Research

## Reference Images Analysis

Based on the "rounds" reference images, JAKESJAM's glowing effects use:

### 1. LIGHT SPRITES (the "rounds")

**Not postFX, but sprite-based:**
- Drawn with `Graphics.circle()` + `lineStyle()` for the ring
- Inner circle: filled with gradient (dark → bright)
- Blend mode: `NORMAL` or `ADD` depending on depth
- Dynamic alpha: 0.05-0.15 based on energy level

### 2. PROJECTILE GLOW RINGS

- **Outer ring:** `stroke(2-4px, cyan at 0.7-1.0 alpha)`
- **Inner glow:** filled gradient (0.1 → 0.7 alpha)
- **Animated:** pulse 0.8 → 1.0 → 0.8 over 300ms
- **Layered:** outer ring → inner glow (different draw calls)

### 3. EXPLOSION PARTICLES

- **Core:** bright white/cyan (0x8ff8ff or 0xffffff)
- **Mid:** energy gradient (cyan → transparent)
- **Outer:** smoke particles (grey, alpha fade)

### 4. COLOR PALETTE

- **Energy glow:** 0x8ff8ff (Crystal Cyan)
- **High power:** 0xffffff → 0x8ff8ff
- **Low power:** 0x8ff8ff → 0x4dd6d6
- **Fire:** 0xf6a623 (orange) for heat effects

### 5. PERFORMANCE

- **Single draw call:** Graphics.circle + Graphics.lineStyle = 2 calls
- **No postFX** (cheap: postFX = 1+ ms per particle)
- **Pre-rendered atlas** for many particles: `lights.png`

---

## Research Questions

1. What shader pass or technique produces the glowing effects?
2. Is it postFX or sprite-based?
3. What blend mode stacks multiple lights?
4. How is dynamic power/energy visualized?
5. Are particles or graphics used?
6. How is the gradient created (gradientTexture, lineStyle, or fill)?

---

## Complementary Skills Needed

Based on the 2D lighting patterns observed, here are the **4 complementary skills** that work with `game-feel-juice`:

### 1. **game-lighting-flats** — 2D Flat Lighting & Light Sprites (NEW)
### 2. **game-render-pipeline** — Render Pipeline Optimization (NEW)
### 3. **game-particle-systems** — Particle System Architecture (NEW)
### 4. **game-color-dynamics** — Dynamic Color & Power Visualization (NEW)

Each builds on the others for complete "juice" implementation.
