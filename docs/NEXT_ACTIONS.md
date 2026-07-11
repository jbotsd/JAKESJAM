# Five physical acts — the entire remaining distance to the goal

Everything code-shaped shipped 2026-07-10 (50 commits, evidence in
[END_PRODUCT_GOAL.md](./END_PRODUCT_GOAL.md)). These five acts close the
remaining acceptance rows. Ordered by payoff-per-minute.

## 1. ~~Watch two clips → closes pillar 2~~ DONE 2026-07-11
Accepted after 4 art rounds (motion "REALLY good", round-4 gnostic look
"good, will have to do for now"). Canonical pair pinned:
- A (live vector): https://play.elyad.io/c/065c267e-0be2-4b9e-b18d-f25173a70107
- B (baked r4):    https://play.elyad.io/c/02bb89e6-bdcf-41f1-8eb6-8f806a17245e

Future art tweaks: edit `BakedPlayerRig.bakeParts()`, then re-render B with
`?replay=world-1783689217085.jjr&render=1&from=1500&ticks=1200&rig=baked&follow=bot_piston&zoom=2.6`

## 2. Plug the TV into the Pi (~2 min) → closes pillar 1's Pi row
The rpi renders the game hardware-accelerated but tonight both HDMI ports
were disconnected (headless output clock capped measurements at ~24fps with
a zombie mpv also decoding). With the TV attached:
```
ssh rpi
# then on the Pi (or just open it from the TV UI):
chromium --app="https://play.elyad.io/?kiosk=1&world=1"
```
Stats toggle shows FPS. Target: 30fps sustained (already at 24 under worse
conditions). If short, the next lever is profiling with the display real.

## 3. gsr upgrade + one command (~3 min) → closes pillar 4's host row
5.13.9 segfaults in EGL init on nvidia-open 610 (three core dumps prove it).
```
paru -S gpu-screen-recorder-git       # or -bin; needs 5.14+
cd /mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM
./stream-kit/launch-replay-buffer.sh   # from a terminal IN the session
```
Then restart the game server with `JJ_HOST_REPLAY=1` added to its env block
— every kill saves a free NVENC clip through the normal share pipeline.

## 4. Play on the phone for 15 minutes → closes pillar 5's soak
Just play. The frame-time telemetry (stats HUD / governor logs) is the
evidence; sustained 60fps through thermal equilibrium = PASS. Bonus: do it
on 5G and act 5 happens automatically.

## 5. One 5G tap → closes pillar 5's timing row
Phone on 5G (wifi off) → open https://play.elyad.io/?world=1 → count to
being in the match. Bound: 15s. LAN baseline: 5.7s.

## Desktop bonus (30 seconds, no pillar but satisfying)
Settings → Graphics → Ultra, then the stats toggle: your 4080 rendering
supersampled MSAA vector art at your display's full refresh.
