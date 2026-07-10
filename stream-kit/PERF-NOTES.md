# Stream-kit performance (2026-07-10)

## 3s sample — unplayable root cause (before)

| Process | ~CPU | Problem |
|---------|------|---------|
| Chromium `--disable-gpu` spectator (`jj-obs-x11-profile2`) | **~93%** | Full game software-rasterized |
| `voice-overlay-server` full draw @30fps silent | **~56%** | PIL geometry every frame even at level=0 |
| `game-capture-server` unbounded grim | **~30–58%** | Capture as fast as grim could go |
| `gpu-screen-recorder` + MJPEG both | **~7–13%** | **Double capture** of the same window |
| Idle spectator chromium | waste | Extra process |

**Total stream stack ≈ 180–280% CPU** while trying to play. That is the unplayable feel.

## Fixes applied

1. Killed software spectator + idle capture chromes + redundant GSR loop.
2. **Game capture** (`game-capture-server.py`):
   - Default **30 fps** (`JJ_CAPTURE_FPS`)
   - **Paced** grim (not free-run)
   - **Parks when `clients==0`** (OBS not reading stream)
3. **Voice overlay** (`voice-overlay-server.py`):
   - Silent → cached black JPEG (additive drops out)
   - Parks when no clients; idle poll 4fps, active 24fps
4. Do **not** launch Chromium with `--disable-gpu` for game/spectator.

## After (idle, no OBS client)

| Process | ~CPU |
|---------|------|
| game-capture | **~1%** |
| voice-overlay | **~1%** |

OBS opening Game Feed / Voice Seal will wake capture; close sources when not streaming to free the machine for play.

## Play tips

- Play with **OBS sources inactive** or OBS closed when not streaming.
- Never start a second spectator with `--disable-gpu`.
- One capture path only: grim→MJPEG **or** GSR, not both.

## GPU path (2026-07-10)

- Kiosk: `launch-game-kiosk.sh` enables GPU rasterization / zero-copy / ANGLE.
- Phaser: `preserveDrawingBuffer` only when clips consent is ON at boot
  (`buildGameConfig()`); `powerPreference: high-performance`.
- Hot Lobby bots: `WORLD_BOTS` default **2** (server restart with env).
