# JAKESJAM Playtest Stress Plan

Milestone 8 turns the prototype from "features exist" into "we can learn from a session."

## Goals

- Prove two-window online movement sync before judging combat.
- Run a 6-player lobby stress pass with movement-only expectations.
- Capture whether the 10-screen Boxworks camera feels readable.
- Identify which chaos modifiers are fun, noisy, or broken.

## Baseline Test Matrix

| Test | Setup | Pass Signal |
| --- | --- | --- |
| Local movement | One browser, no room | Player can traverse camera-follow world without losing aim context. |
| Local combat | One browser, no chaos | Projectiles, destructibles, fire, and dummy reset remain readable. |
| Chaos stack | One browser, Low Grav + Fire Hazard + Max Recoil | Game remains controllable and recovers with `R`. |
| Online 1v1 | Two browser windows, host/join/start | Remote player rigs follow low-frequency snapshots. |
| 6-player lobby | Six tabs join one room | Room list, ready state, and match handoff do not fail. |

## Session Notes Template

```text
Date:
Build:
Players/tabs:
Mode:
Chaos modifiers:

Movement feel:
Combat readability:
Camera readability:
Networking notes:
Destructible/fire notes:
Crashes or stalls:
Top 3 fixes:
```

## Current Known Limits

- Remote players use low-frequency snapshot smoothing, not authoritative rollback.
- Combat hits are still local prototype behavior.
- Chaos modifiers are local/custom-mode experiments and should not be treated as ranked balance.
