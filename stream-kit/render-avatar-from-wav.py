#!/usr/bin/env python3
"""Render the voice-reactive seal OFFLINE from a WAV — frame-exact, no capture.

Feeds the file's envelope through the SAME MicLevel smoother + draw_frame as
the live server, pipes JPEGs to ffmpeg, muxes the source audio. Output is
black-background video for additive/screen blend — identical look to the OBS
Voice Seal source, but deterministic and perfectly synced to the audio.

  python3 render-avatar-from-wav.py in.wav out.mp4

Env (same knobs as the live server):
  JJ_VOICE_MODE=avatar|full|both   default avatar (lower-left puppet)
  JJ_VOICE_GAIN=<float>            skip auto-calibration and force a gain
  JJ_VOICE_FPS=24                  render fps

Gain is AUTO-CALIBRATED from the file by default: the 95th-percentile speech
chunk maps to ~0.9 after the server's soft-knee, so the seal rides the full
dynamic range instead of pinning at max on every syllable (a studio WAV is
~30x hotter than the cold Volt pro-input the live default of 18 is tuned for).
"""
import array
import os
import subprocess
import sys
from importlib.machinery import SourceFileLoader

_FORCED_GAIN = os.environ.get("JJ_VOICE_GAIN")
os.environ.setdefault("JJ_VOICE_GAIN", "1.0")  # placeholder; set after scan

HERE = os.path.dirname(os.path.abspath(__file__))
srv = SourceFileLoader(
    "voseal", os.path.join(HERE, "voice-overlay-server.py")
).load_module()

if len(sys.argv) != 3:
    sys.exit("usage: render-avatar-from-wav.py <in.wav> <out.mp4>")
wav, out = sys.argv[1], sys.argv[2]

FPS = srv.FPS_ACTIVE
pcm = subprocess.run(
    ["ffmpeg", "-v", "error", "-i", wav, "-f", "s16le", "-acodec", "pcm_s16le",
     "-ac", "1", "-ar", "48000", "-"],
    check=True, capture_output=True,
).stdout
bytes_per_frame = int(48000 / FPS) * 2
frames = (len(pcm) + bytes_per_frame - 1) // bytes_per_frame


def raw_unity_level(chunk: bytes) -> float:
    """The server's pre-knee level at gain 1 (peak*1.8 vs avg*3.2)."""
    s = array.array("h")
    s.frombytes(chunk[: len(chunk) - (len(chunk) % 2)])
    if not s:
        return 0.0
    peak = max(abs(v) for v in s) / 32768.0
    avg = sum(abs(v) for v in s) / len(s) / 32768.0
    return max(peak * 1.8, avg * 3.2)


if _FORCED_GAIN is not None:
    srv.VOICE_GAIN = float(_FORCED_GAIN)
else:
    raws = sorted(
        r for i in range(frames)
        if (r := raw_unity_level(pcm[i * bytes_per_frame : (i + 1) * bytes_per_frame])) > 0.01
    )
    if raws:
        p95 = raws[int(len(raws) * 0.95)]
        # knee(x) = x**0.48 * 1.15 → knee ≈ 0.9 at x ≈ 0.60
        srv.VOICE_GAIN = max(0.05, min(18.0, 0.60 / p95))
print(f"voice gain: {srv.VOICE_GAIN:.2f} ({'forced' if _FORCED_GAIN else 'auto-calibrated'})")

enc = subprocess.Popen(
    ["ffmpeg", "-y", "-v", "error",
     "-f", "image2pipe", "-vcodec", "mjpeg", "-framerate", str(FPS), "-i", "-",
     "-i", wav,
     "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
     "-c:a", "aac", "-b:a", "192k", "-shortest", out],
    stdin=subprocess.PIPE,
)
assert enc.stdin is not None

dt = 1.0 / FPS
for i in range(frames):
    chunk = pcm[i * bytes_per_frame : (i + 1) * bytes_per_frame]
    srv.MIC.write(srv.pcm_level_s16le(chunk, 1))
    enc.stdin.write(srv.draw_frame(i * dt, dt))
    if i % (FPS * 20) == 0:
        print(f"{i}/{frames} frames", flush=True)
enc.stdin.close()
enc.wait()
print(f"done: {frames} frames @ {FPS}fps -> {out}")
