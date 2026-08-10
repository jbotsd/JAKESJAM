"""Burn-in captions for a narrated short, generated from the VO itself.

~85% of short-form viewing is muted (docs/CLIPPING-PROFESSION.md 3), so a
narrated short with no captions is a silent short. These are cut from the
SAME wav that is in the mix, with word timestamps, so they cannot drift out
of sync with the voice or claim something the voice does not say.

Chunked to 2-3 words in the "karaoke" style the craft notes call for, set in
the game's own Space Grotesk, and positioned by --y so it lands in the dead
space under the gameplay band rather than over it.

    python make-captions.py <vo.wav> <out.ass> [--y 1600] [--width 1080]
"""
import os, sys

SRC = sys.argv[1]
OUT = sys.argv[2]
def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default

# Distance from the BOTTOM edge to the caption. Alignment 2 (bottom-centre)
# is what a viewer expects of a caption and it keeps the top of the frame free
# for the hook.
MARGINV = int(arg("--marginv", "460"))
W = int(arg("--width", "1080"))
H = int(arg("--height", "1920"))
MAX_WORDS = int(arg("--words", "3"))
FONTSIZE = int(arg("--size", "66"))

from faster_whisper import WhisperModel

model = WhisperModel(os.environ.get("WHISPER_MODEL", "medium.en"),
                     device="cpu", compute_type="int8")
segments, _ = model.transcribe(SRC, beam_size=5, word_timestamps=True, vad_filter=False)

words = []
for s in segments:
    for w in (s.words or []):
        t = w.word.strip()
        if t:
            words.append((w.start, w.end, t))

# Group into short chunks, breaking on sentence punctuation so a caption
# never straddles two sentences.
# Break on punctuation or length, but never END a chunk on a function word
# ("1v1 me / this is / where you take" reads broken; "this is where / you
# take them" reads spoken). One extra word is allowed to finish the phrase.
FUNCTION_WORDS = {"a","an","the","this","that","is","are","was","and","or",
                  "of","to","in","on","at","you","your","my","we","i","it","no","not"}
chunks, cur = [], []
for st, en, t in words:
    cur.append((st, en, t))
    punct = t.endswith((".", "!", "?", ","))
    full = len(cur) >= MAX_WORDS
    dangling = t.lower().strip(".,!?\"'") in FUNCTION_WORDS
    if punct or (full and not dangling) or len(cur) >= MAX_WORDS + 2:
        chunks.append(cur)
        cur = []
if cur:
    chunks.append(cur)

def ts(sec):
    if sec < 0:
        sec = 0
    h = int(sec // 3600); m = int((sec % 3600) // 60); s = sec % 60
    return f"{h:d}:{m:02d}:{s:05.2f}"

# IDENT-GRAMMAR: bone-ivory on obsidian, teal is the single energy accent.
# ASS colours are &HBBGGRR.
BONE = "&H00E0ECF2"
OUTLINE = "&H00100C0A"

head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: cap,Space Grotesk,{FONTSIZE},{BONE},{OUTLINE},{OUTLINE},-1,0,0,0,100,100,0.6,0,1,3,2,2,60,60,{MARGINV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

# Each caption holds until the next begins (capped at +1.2s past its own
# words) so the reader never stares at an empty caption zone mid-sentence.
lines = []
for i, c in enumerate(chunks):
    st = c[0][0]
    en = c[-1][1]
    if i + 1 < len(chunks):
        nxt = chunks[i + 1][0][0]
        en = min(max(en, nxt), en + 1.2, nxt)
    if en - st < 0.28:
        en = st + 0.28
    text = " ".join(t for _, _, t in c).replace("\n", " ")
    lines.append(f"Dialogue: 0,{ts(st)},{ts(en)},cap,,0,0,0,,{text}")

open(OUT, "w").write(head + "\n".join(lines) + "\n")
print(f"{len(chunks)} caption chunks from {len(words)} words -> {OUT}")
for l in lines[:6]:
    print("  " + l.split(",,")[-1])
