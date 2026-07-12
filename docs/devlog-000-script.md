# DEVLOG 000 — "My multiplayer game has 1 player (me)"

Story-driven candid devlog, ~2:45 spoken at ~175 wpm. One narrative arc:
green tests at 2am → the empty-stadium realization → climbing out of the cave →
the invitation. One CTA (email → play in browser). Friday = FIGHT NIGHT,
livestreamed, 7pm Perth (spoken as New York / London / Sydney times).

Prompter-formatted version: `devlog-000-prompter.txt` (serve at localhost:7777).

---

## COLD OPEN

[VISUAL: the best five seconds of gameplay footage, loud]

This is JAKESJAM. Ten space wizard ninjas, one arena, and abilities that
mutate into self-guided geometric war crimes.

[VISUAL: hard cut — dashboard, PLAYERS ONLINE: 1]

It has exactly one player. Me.

[beat]

I built the stadium first. This video is the invitation.

## THE GAME

[VISUAL: gameplay montage synced to the beats]

Every match starts fair. Everyone drops in with the same kit. You shield.
You dash-bash across the arena. You parry rockets back into people's
faces. You throw geometry at anything that moves.

Then the cards drop, and your abilities mutate. Homing shots. Shots that
bounce. Shots that split into five more shots. The cards stack, so a few
minutes into a round your clean opening kit has turned into something the
balance spreadsheet legally refuses to acknowledge.

[VISUAL: absurd late-game build filling the screen]

When you die, you lose everything and start fresh. Best design decision in
the game: every life is a brand-new science accident.

And the engineering got out of hand. The whole simulation is written in
Zig and compiled to WebAssembly, so the server and your browser run the
exact same match, tick for tick, down to the last random number.

Two weeks ago, at two in the morning, the last piece — rollback netcode —
finally worked, and I sat there watching a perfect match play itself.

[VISUAL: beat — empty arena, one player idle in the middle]

I had built the stadium. Laid the turf. Calibrated the floodlights. And I
was standing in the middle of it, alone, kicking a ball against the wall.

## THE REALIZATION

[VISUAL: slow scroll through store pages with zero reviews]

Indie games have a graveyard, and it's mostly full of good ones. Clean
mechanics, clever netcode, real craft — made by developers who spent two
years polishing in a cave, surfaced, hit publish, and heard the sound of
one hand clapping.

My roadmap said: perfect the parry timing, then tell people. I was
speedrunning my way into that graveyard with excellent test coverage.

[VISUAL: voice seal avatar, deadpan]

The ones who make it out build their audience while they build the game.
For years that sounded like a distraction to me. It's the whole job.
They show the mess — the desyncs, the broken builds, the bug where the
physics let you parry your own rocket straight back into your own face. By
the time they launch, actual humans are waiting at the door.

## THE PLAN

So this video is me climbing out of the cave.

From here on, I build in the open. Every week you get the real workbench:
what worked, what exploded, and which card combo currently breaks the game.

There's one link below. Drop your email and you're playing the prototype
in your browser about eight seconds from now. You'll be shooting geometry
with me while it's still rough — the funniest time to be here.

## OUTRO — FIGHT NIGHT

[VISUAL: gameplay — one clean kill, freeze frame]

And every Friday night is Fight Night. The server goes live, the stream
goes live, and everyone on the list gets the arena link — so you can shoot
geometry at my actual face while I commentate my own deaths. Morning
coffee in New York, lunchtime in London, beer o'clock in Sydney.

First one's this Friday. I have no idea what state the build will be in by
then. That's the show.

[VISUAL: final beat — arena gates, lights up]

The stadium's built. The floodlights are on. Friday night, we open the gates.

---

## VOICE — the geometric seal avatar

- The talking-head is the voice-reactive gnostic seal (stream-kit Voice Seal),
  not a webcam. Composite it over gameplay with **additive/screen blend**
  (black background), same as the OBS source.
- VO track: `~/Downloads/jakesjamvideo-lasttakes.wav` — last take of every
  phrase, dead air spliced, peaks −0.8 dB (recorded 2026-07-11).
- Avatar video: rendered OFFLINE, frame-exact to the VO — no screen capture:
  `stream-kit/render-avatar-from-wav.py <vo.wav> <out.mp4>`
  (same draw code as the live server; `JJ_VOICE_MODE=full` for the big
  centered seal, default `avatar` for the lower-left puppet;
  `JJ_VOICE_GAIN=2.5` offline vs 18 live — studio WAV runs hot).
- Rendered take: `~/Videos/JAKESJAM/devlog-000-voice-seal.mp4`

## FIGHT NIGHT — the ritual

- **Every Friday, 7pm Perth** (say it as: 7am New York / noon London / 9pm Sydney)
- First one: **Friday 17 July 2026** — recurring calendar event created
- Livestreamed (stream-kit: `stream-kit/launch-stream-ready.sh` — game feed
  :9876, voice avatar :9877, OBS)
- Pre-flight: game server up, funnel URL checked, email the list the arena
  link the morning of

## Title options (thumbnail-test, don't marry one)

1. **My multiplayer game has 1 player (me)** — honest hook, strongest
2. I built the stadium. You're the crowd.
3. I over-engineered a game nobody's played
4. Zig + WASM + 1 player: a love story

## Thumbnail

Face (mild despair) + gameplay chaos + big text: **"PLAYERS: 1"**

## Description block (the machine part)

- 1 link only: landing page → email → browser prototype access + Fight Night invite
- First line repeats the title promise (subject/CTA mirror rule)
- Fight Night times listed: Fri 7am ET / 12pm London / 9pm Sydney

## Series notes (Brunson mechanics, applied)

- Rep 1 of ~50 before the voice clicks. Ship it stiff. Weekly minimum.
- Every devlog = one true story from the actual workbench (verifiable
  specificity — the desync bug, the balance disaster, the broken chaos
  modifier) → pivot → the same single CTA. Never rotate the CTA.
- Fight Night is the retention loop: the list gets a reason to come back
  every single week whether or not a devlog shipped.
- The list is the asset. The game is iterable. Launch = email the list.
