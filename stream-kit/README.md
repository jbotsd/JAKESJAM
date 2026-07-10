# JAKESJAM Stream Kit (software ready)

OBS **profile + scene collection** is installed on this machine:

| What | Where |
|------|--------|
| Scene collection | `~/.config/obs-studio/basic/scenes/JAKESJAM.json` |
| Profile | `~/.config/obs-studio/basic/profiles/JAKESJAM/` |
| Global select | `~/.config/obs-studio/global.ini` (Profile + Collection = JAKESJAM) |
| Overlay PNGs | `stream-kit/assets/png/` |
| Thumbnail | `stream-kit/assets/thumbnail-friday.jpg` |
| YouTube copy | `stream-kit/YOUTUBE-COPY.md` |

## One command (Hyprland layout)

```bash
./stream-kit/open-on-workspaces.sh
```

| Workspace | Contents |
|-----------|----------|
| **5** | OBS + all overlays + PNG folder + thumbnail + docs |
| **6** | Game (`play.elyad.io`) |

```bash
./stream-kit/launch-stream-ready.sh   # OBS + game only (no workspace split)
```

## Scenes (already built)

| Scene | Contents |
|-------|----------|
| **STARTING SOON** | Full-screen void + triangle + link |
| **GAME** | Game capture + brand corner + lower third |
| **BRB** | Be right back card |
| **ENDING** | Keep playing card |

## First-time clicks (only things I can’t do for you)

1. **Game Capture** → Properties → pick the Chromium window showing JAKESJAM  
2. **Stream key** → OBS Settings → Stream → YouTube key (from Studio)  
3. **Start Streaming**

Optional: `sudo pacman -S obs-studio-plugin-browser` if you want live HTML browser sources instead of PNGs.

## Encoder defaults (profile)

- Canvas 1920×1080 → output **1920×1080 @ 60fps**
- x264 / **8000 Kbps** CBR (drop to 6000 if upload drops frames)
- Game capture uses normal player camera (no spectator director)
- Recordings: `~/Videos/JAKESJAM/`
