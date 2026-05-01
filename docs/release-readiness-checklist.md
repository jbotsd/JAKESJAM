# JAKESJAM Release Readiness Checklist

Milestone 9 is the "can we hand this build to someone else without babysitting it?" pass.

## Required Checks

- `npm install`
- `npm run verify`
- `npm run dev:full`
- Open `http://127.0.0.1:5173/`
- Host a room.
- Join from a second browser window.
- Ready both players.
- Start match.
- Move both players and confirm remote snapshot motion.
- Toggle at least two chaos modifiers and confirm the local match restarts.

## Build Notes

- Client: Phaser + Vite, built by `npm run build`.
- Backend: Convex local dev is expected for current multiplayer testing.
- Production Convex deployment is still behind `npm run convex:deploy`.

## Ship/No-Ship Gates

Ship a playtest build when:

- TypeScript and Vite build pass.
- Browser opens without console-fatal startup errors.
- One local combat loop is playable for at least 3 minutes.
- Two-window room start succeeds.
- Known limitations are written in the playtest notes.

Do not ship when:

- Player movement collision regresses.
- Projectiles cannot hit the dummy.
- The lobby cannot create or join a room.
- Camera follow traps the player off-screen.
