# JAKESJAM announcer — recording script (Halo-style, Jake's voice)

## The lines

Say each line **3 times** (pick-your-best happens automatically), ~1s pause
between takes, **3+ seconds of silence between different lines** (the
splitter keys on the long gaps). Keep the ORDER exactly as below — the
processor maps groups to keys by sequence.

Delivery: Halo announcer — deep, resonant, deliberate. Punch the
consonants; let the last syllable ring. Slightly slower than feels natural.

| # | Key | Line | Delivery note |
|---|-----|------|---------------|
| 1 | `kill` | "Kill" | short, hard stop |
| 2 | `double-kill` | "Double kill" | rising weight |
| 3 | `triple-kill` | "Triple kill" | bigger |
| 4 | `multi-kill` | "MULTI-KILL" | maximum — the crowd moment |
| 5 | `first-blood` | "First blood" | relish it |
| 6 | `fight` | "FIGHT" | explosive, clipped |
| 7 | `round-over` | "Round over" | settling, final |
| 8 | `victory` | "Victory" | triumphant, long tail |
| 9 | `eliminated` | "Eliminated" | cold, judicial |
| 10 | `soul-reclaimed` | "Soul... reclaimed" | gnostic — slow, reverent (plays as your soul reaches the seal) |
| 11 | `sudden-death` | "Sudden death" | ominous |
| 12 | `welcome` | "Welcome... to JAKESJAM" | the title card |

Optional extras (same rules, after the 12 — record if you're feeling it):
`draft` "Choose your weapon" · `killing-spree` "Killing spree" ·
`unstoppable` "UNSTOPPABLE"

## Recording on this rig

1. Volt 476 into Pro Audio profile for the DAW:
   `pactl set-card-profile $(pactl list cards short | grep -o '[0-9]*.*Volt' | head -1 | cut -f1) pro-audio`
   (back to `output:analog-surround-40` afterwards for normal playback)
2. Audacity → input: Volt 476, **48000 Hz, mono**, 24-bit.
3. Gain so your LOUDEST line peaks around **−12 dB** (MULTI-KILL is the
   loudest — check with that one).
4. ~15 cm off-axis from the mic, pop filter if handy.
5. One continuous recording, script order, then:
   **File → Export Audio → WAV 24-bit** to
   `~/Music/announcer_raw.wav`
6. Tell Claude "announcer recorded" — processing, mastering, and game
   wiring take it from there (`scripts/process-announcer.ts`).

## What the processor does
Splits on the long silences → groups takes per line → picks the cleanest
take (best RMS with no clipping) → trims → masters (highpass, gentle
compression, loudnorm to −16 LUFS, a short arena-hall tail) → encodes
`.m4a` into `client/public/audio/announcer/<key>.m4a`.

## The diatribe — `lore-intro` (record LAST, after a long silence)

One take is fine (do two if the first doesn't land). This is the title-
screen monologue — the myth of the game in ~40 seconds. Slow. Deep.
Reverent, then hungry. Pause hard at every line break. The em-dashes are
breaths.

> He came back.
>
> And the world... was made new.
>
> The last war is won. The dragon is done.
> Death itself... lost its sting.
>
> And we, the redeemed — gathered spark by spark
> into the Seal, every soul brought home —
>
> we found that glory... is not stillness.
>
> A blade at rest forgets its edge.
> A spirit at ease forgets its fire.
>
> So in the Kingdom, we built an arena.
>
> Here, spirit pours into vessel.
> Here, brother contends with brother — not in wrath...
> in LONGING.
>
> For iron sharpens iron —
> and one soul sharpens another.
>
> Fall — and there is no sting. The Seal carries you home.
> Rise — and be sharpened.
>
> Welcome... to JAKESJAM.

Delivery notes: "He came back" — hushed awe, like you were there.
"Death itself lost its sting" — 1 Corinthians 15 cadence, triumphant
and quiet at once. Build through the arena section; "LONGING" is the
peak — let it tear a little. "Iron sharpens iron" is scripture-measured
(Proverbs 27:17). "No sting" lands gently — it's the whole reason the
game is joyful. Final "Welcome to JAKESJAM" — arms open, doors open.

Processing: the pipeline handles it automatically as the final group —
it lands as `lore-intro.m4a` and plays from the title screen (skippable,
once per session; replayable from Settings).
