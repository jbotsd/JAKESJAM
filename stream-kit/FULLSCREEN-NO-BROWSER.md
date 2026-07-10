# Fullscreen, no browser chrome

## Goal
A **16:9 canvas with no tab bar / URL bar / OS borders** for OBS capture and play.

## What we ship (tonight)

| Layer | What |
|-------|------|
| **Chromium `--app=`** | No tabs, no omnibox — app window only |
| **Isolated profile** | `~/.cache/jakesjam-kiosk-profile` (no extensions) |
| **Hyprland rules** | `chrome-play.elyad.io__-Default` → WS6, fullscreen, 0 border |
| **`?kiosk=1`** | Client: hide cursor, Fullscreen API, canvas edge-to-edge |
| **Launcher** | `stream-kit/launch-game-kiosk.sh` |

```bash
./stream-kit/launch-game-kiosk.sh
# or
./stream-kit/open-on-workspaces.sh   # OBS on 5, kiosk game on 6
```

## Why not Electron / Tauri yet
Same WebGL game, extra packaging. Kiosk Chromium is production-identical to play.elyad.io.
Later: Tauri shell loading the same URL if we want a `.desktop` binary with zero Chromium flags.

## Why not pure native
Phaser is the renderer. Zig is for sim. Native fullscreen would reimplement the client.

## Capture
`game-capture-server.py` prefers the kiosk / `chrome-play.elyad.io` window for grim → MJPEG.
