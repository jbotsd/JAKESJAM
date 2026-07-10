# JAKESJAM Stream Kit — OBS Setup

**I cannot control OBS on your PC remotely.**  
This kit is drop-in: browser overlays + thumbnail + copy. You paste/import in OBS.

## Paths

| Item | Path |
|------|------|
| Overlays | `stream-kit/overlays/*.html` |
| Styles | `stream-kit/overlays/styles.css` |
| Thumbnail | `stream-kit/assets/thumbnail-friday.jpg` |
| Copy | `stream-kit/YOUTUBE-COPY.md` |

Open overlay files with **absolute file URLs** in OBS (example):

```
file:///mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM/stream-kit/overlays/starting-soon.html
```

On your machine, use the real absolute path to this repo.

---

## Recommended scenes

### Scene: `STARTING SOON`
1. **Browser** → `starting-soon.html`  
   - Width **1920** · Height **1080**  
   - ✅ Shutdown source when not visible  
   - Background transparent (page is full-bleed dark)

### Scene: `GAME`
Sources **bottom → top**:

1. **Browser / Window Capture** — Chrome on `https://play.elyad.io`  
   - Prefer **Window Capture** (Chrome) or **Browser Source** with the game URL (Browser Source can be laggy for WebGL; Window Capture is safer)
2. **Browser** — `brand-corner.html` (1920×1080, transparent)
3. **Browser** — `lower-third.html` (1920×1080, transparent)  
   - Optional: hide after 60s with a filter or just leave it

### Scene: `BRB`
1. **Browser** → `brb.html` (1920×1080)

### Scene: `ENDING`
1. **Browser** → `ending.html` (1920×1080)

---

## Audio

| Source | Setting |
|--------|---------|
| Mic | Monitoring: Monitor Off (unless headphones need it) |
| Desktop Audio | Game + browser |
| Filters on Mic | Noise Suppression (RNNoise) · maybe Compressor |

Aim: voice clear, game music ~−20 to −16 LUFS under voice.

---

## YouTube output (OBS → Settings → Stream)

| Setting | Value |
|---------|--------|
| Service | YouTube — RTMPS |
| Server | Primary |
| Key | From YouTube Studio → Go live → Stream key |

### Output (simple)
| Setting | **1080p60 (default)** | 720p60 (weak upload) |
|---------|----------------------|----------------------|
| Encoder | x264 or NVENC | x264 |
| Bitrate | **7000–9000** Kbps | **4500–6000** |
| Keyframe | **2** | **2** |
| CPU preset | veryfast / NVENC quality | veryfast |

Resolution: canvas **1920×1080**, output **1920×1080 @ 60** (profile default).

### Fullscreen game (no browser chrome)
```bash
./stream-kit/launch-game-kiosk.sh
```
Chromium `--app=` + Hyprland fullscreen on workspace 6 — no tabs/URL bar.
See `FULLSCREEN-NO-BROWSER.md`.

### GAME scene capture (Wayland)
There is **no obs-browser** on this machine, and PipeWire window pick needs a manual portal.

**Configured setup:**
1. Capture server (auto): `stream-kit/game-capture-server.py`  
   → `http://127.0.0.1:9876/stream.mjpg` (grim → MJPEG of JAKESJAM window)
2. OBS **Game Feed** = Media Source pointed at that URL
3. Overlays: Brand Corner (full transparent plate) + Lower Third (bottom-left)

Start capture if needed:
```bash
python3 stream-kit/game-capture-server.py   # game window → :9876
python3 stream-kit/voice-overlay-server.py  # mic → gnostic seal → :9877
```

### Voice Seal (OBS, not in-game)
- Source **Voice Seal** = Media Source → `http://127.0.0.1:9877/stream.mjpg`
- **Blending: Additive** so black is transparent
- On GAME / STARTING SOON / BRB / ENDING — geometry pulses when you talk
- In-game mic is **off** by default (music only). In-game `?voice=1` is separate.

Health:
```bash
curl http://127.0.0.1:9876/health   # game
curl http://127.0.0.1:9877/health   # voice level / onset
```

---

## YouTube Studio

1. Upload thumbnail: `stream-kit/assets/thumbnail-friday.jpg`
2. Paste title/description from `YOUTUBE-COPY.md`
3. Category: **Gaming**
4. Stream → **Go live** → Start Streaming in OBS

---

## Preflight (10 min)

```
[ ] Server + tunnel up
[ ] play.elyad.io loads match
[ ] You sitting in Hot Lobby
[ ] OBS: GAME scene looks good, mic meters move
[ ] STARTING SOON → switch to GAME when ready
[ ] Pin chat: play.elyad.io
[ ] CLIPS ON in-game
```

---

## Hotkeys (set in OBS)

| Hotkey | Scene |
|--------|--------|
| F1 | STARTING SOON |
| F2 | GAME |
| F3 | BRB |
| F4 | ENDING |

---

## Notes

- **Browser Source + Phaser/WebGL** can stutter. Prefer capturing the real Chrome window for gameplay.
- Overlays are pure HTML/CSS — edit text in the `.html` files anytime.
- Keep `styles.css` next to the HTML files (relative `href`).
