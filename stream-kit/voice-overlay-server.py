#!/usr/bin/env python3
"""OBS voice-reactive gnostic overlay — mic → geometry → MJPEG.

  http://127.0.0.1:9877/stream.mjpg

OBS Media Source → that URL · Blending: **Additive** (black drops out).

Mic via pw-record or arecord. No numpy required.
"""
from __future__ import annotations

import array
import io
import math
import os
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from shutil import which

from PIL import Image, ImageDraw, ImageChops, ImageEnhance, ImageFilter

HOST = "127.0.0.1"
PORT = 9877
W, H = 1920, 1080
# Active voice → full rate. Quiet still draws ambient seal (not pure black).
FPS_ACTIVE = max(12, min(30, int(os.environ.get("JJ_VOICE_FPS", "24"))))
FPS_IDLE = max(8, min(20, int(os.environ.get("JJ_VOICE_IDLE_FPS", "12"))))
IDLE_LEVEL = 0.02
# Digital gain (Volt pro-input often very cold into software).
VOICE_GAIN = float(os.environ.get("JJ_VOICE_GAIN", "18"))
VOICE_GATE = float(os.environ.get("JJ_VOICE_GATE", "0.003"))
MIC_TARGET = os.environ.get(
    "JJ_MIC_TARGET",
    "alsa_input.usb-Universal_Audio_Volt_476_24482040026582-00.pro-input-0",
)
# full = classic full-frame seal · avatar = voice puppet (default) · both
VOICE_MODE = os.environ.get("JJ_VOICE_MODE", "avatar").strip().lower()
# Avatar anchor — lower-left stream cam so gameplay stays clear (additive).
AX = int(os.environ.get("JJ_AVATAR_X", str(int(W * 0.16))))
AY = int(os.environ.get("JJ_AVATAR_Y", str(int(H * 0.68))))
AVATAR_S = float(os.environ.get("JJ_AVATAR_SCALE", "1.45"))
# Legacy full-frame centre (still used in full/both modes)
CX, CY = W // 2, H // 2

HL = (80, 227, 194)
HL_HI = (143, 248, 255)
GOLD = (201, 168, 76)
MAG = (232, 121, 249)  # hot magentas for peak vibrancy
ORANGE = (251, 146, 60)
VOID = (0, 0, 0)
PHI_INV = 1 / 1.618033988749895


def clamp01(x: float) -> float:
    return 0.0 if x < 0 else 1.0 if x > 1 else x


class MicLevel:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.level = 0.0
        self.onset = 0.0
        self._prev = 0.0

    def write(self, level: float) -> None:
        level = clamp01(level)
        with self.lock:
            k = 0.93 if level > self.level else 0.26
            self.level += (level - self.level) * k
            d = max(0.0, self.level - self._prev)
            self._prev = self.level
            self.onset = max(
                self.onset * 0.66,
                min(1.0, d * 24 + (self.level * 0.4 if self.level > 0.4 else 0.0)),
            )

    def snapshot(self) -> tuple[float, float]:
        with self.lock:
            return self.level, self.onset


MIC = MicLevel()
JPEG_BUF = b""
JPEG_LOCK = threading.Lock()
JPEG_SEQ = 0
STREAM_CLIENTS = 0
# Prebuilt transparent-black plate for additive OBS blend when silent.
_BLACK_JPEG: bytes | None = None


def black_jpeg() -> bytes:
    global _BLACK_JPEG
    if _BLACK_JPEG is None:
        bio = io.BytesIO()
        Image.new("RGB", (W, H), VOID).save(bio, format="JPEG", quality=40, optimize=False)
        _BLACK_JPEG = bio.getvalue()
    return _BLACK_JPEG

# Lightweight particles (SoA-ish lists) — burst on onset
_PART_N = 96
_px = [0.0] * _PART_N
_py = [0.0] * _PART_N
_pvx = [0.0] * _PART_N
_pvy = [0.0] * _PART_N
_plife = [0.0] * _PART_N
_phue = [0] * _PART_N  # 0 cyan 1 gold 2 mag 3 white
_pprev_onset = 0.0
_waves: list[tuple[float, float]] = []  # (birth_t, max_r)
_glitch = 0.0


def pcm_level_s16le(pcm: bytes, channels: int = 1) -> float:
    """Peak/avg level with multi-channel max (Volt pro-input is often 4ch)."""
    if len(pcm) < 4:
        return 0.0
    samples = array.array("h")
    samples.frombytes(pcm[: len(pcm) - (len(pcm) % 2)])
    if not samples:
        return 0.0
    ch = max(1, channels)
    # Per-channel peak, take the loudest (mic may only live on ch0 or ch1)
    peaks = [0] * ch
    accs = [0] * ch
    counts = [0] * ch
    for i, s in enumerate(samples):
        c = i % ch
        a = s if s >= 0 else -s
        if a > peaks[c]:
            peaks[c] = a
        accs[c] += a
        counts[c] += 1
    best = 0.0
    for c in range(ch):
        if counts[c] == 0:
            continue
        peak_f = peaks[c] / 32768.0
        avg_f = (accs[c] / counts[c]) / 32768.0
        raw = max(peak_f * 1.8, avg_f * 3.2) * VOICE_GAIN
        if raw > best:
            best = raw
    if best < VOICE_GATE:
        return 0.0
    # Soft knee so quiet speech still moves geometry
    return clamp01((best - VOICE_GATE * 0.5) ** 0.48 * 1.15)


def mic_loop() -> None:
    # Try Volt by name first (same device OBS Mic uses), then default target.
    backends: list[tuple[str, list[str], int]] = []
    if which("pw-record"):
        for label, target, ch in (
            ("pw-record:volt4", MIC_TARGET, 4),
            ("pw-record:volt1", MIC_TARGET, 1),
            ("pw-record:default", "0", 1),
        ):
            backends.append(
                (
                    label,
                    [
                        "pw-record",
                        "--rate=48000",
                        f"--channels={ch}",
                        "--format=s16",
                        "-P",
                        f"--target={target}",
                        "-",
                    ],
                    ch,
                )
            )
    if which("parec"):
        backends.append(
            (
                "parec:volt",
                [
                    "parec",
                    f"--device={MIC_TARGET}",
                    "--rate=48000",
                    "--channels=1",
                    "--format=s16le",
                    "--raw",
                ],
                1,
            )
        )
    if which("arecord"):
        backends.append(
            (
                "arecord",
                ["arecord", "-f", "S16_LE", "-r", "48000", "-c", "1", "-t", "raw", "-q", "-"],
                1,
            )
        )

    # Nudge capture gain (soft) so cold USB interfaces still trip the seal.
    try:
        subprocess.run(
            ["pactl", "set-source-volume", MIC_TARGET, "150%"],
            capture_output=True,
            timeout=1,
        )
    except Exception:
        pass

    for name, cmd, ch in backends:
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            print(f"[voice-overlay] mic via {name} gain={VOICE_GAIN} gate={VOICE_GATE}", flush=True)
            assert proc.stdout is not None
            chunk = 48000 // 25 * 2 * ch  # ~40ms
            # Bail if 1s of pure digital silence (wrong device / dead path)
            silent_chunks = 0
            while True:
                data = proc.stdout.read(chunk)
                if not data:
                    break
                lvl = pcm_level_s16le(data, ch)
                MIC.write(lvl)
                if lvl < 0.001:
                    silent_chunks += 1
                else:
                    silent_chunks = 0
                # After ~2s of total silence, try next backend (don't hang forever
                # on a dead channel while the stream shows no geometry).
                if silent_chunks > 50:
                    print(f"[voice-overlay] {name} silent — trying next backend", flush=True)
                    proc.kill()
                    break
            print(f"[voice-overlay] {name} ended", flush=True)
        except Exception as e:
            print(f"[voice-overlay] {name} failed: {e}", flush=True)

    print("[voice-overlay] no live mic — ambient breath only (check Volt gain / JJ_MIC_TARGET)", flush=True)
    t0 = time.time()
    while True:
        t = time.time() - t0
        # Soft idle so the seal still breathes on stream if mic is dead
        idle = 0.1 + 0.06 * (0.5 + 0.5 * math.sin(t * 0.7))
        MIC.write(idle)
        time.sleep(0.04)


def col(rgb: tuple[int, int, int], a: float) -> tuple[int, int, int, int]:
    return (rgb[0], rgb[1], rgb[2], int(255 * clamp01(a)))


def vibe_color(base: tuple[int, int, int], heat: float) -> tuple[int, int, int]:
    """Push cyan → white/magenta as voice heats up (vibrancy)."""
    heat = clamp01(heat)
    # mix toward white + a pink punch
    r = int(base[0] + (255 - base[0]) * heat * 0.55 + MAG[0] * heat * 0.25)
    g = int(base[1] + (255 - base[1]) * heat * 0.35)
    b = int(base[2] + (255 - base[2]) * heat * 0.45 + MAG[2] * heat * 0.15)
    return (min(255, r), min(255, g), min(255, b))


def _spawn_burst(strength: float, ox: float | None = None, oy: float | None = None) -> None:
    import random

    ox = float(CX if ox is None else ox)
    oy = float(CY if oy is None else oy)
    n = int(14 + strength * 36)
    for _ in range(n):
        for i in range(_PART_N):
            if _plife[i] <= 0:
                ang = random.random() * math.tau
                spd = 160 + strength * 720 + random.random() * 260
                _px[i] = ox
                _py[i] = oy
                _pvx[i] = math.cos(ang) * spd
                _pvy[i] = math.sin(ang) * spd
                _plife[i] = 0.4 + strength * 0.7 + random.random() * 0.35
                _phue[i] = random.choice([0, 0, 0, 1, 1, 2, 3])
                break


def _step_particles(dt: float) -> None:
    for i in range(_PART_N):
        if _plife[i] <= 0:
            continue
        _plife[i] -= dt
        _px[i] += _pvx[i] * dt
        _py[i] += _pvy[i] * dt
        _pvx[i] *= 0.955
        _pvy[i] *= 0.955


def _draw_plasma(d: ImageDraw.ImageDraw, t: float, energy: float) -> None:  # type: ignore[name-defined]
    """Cheap sine-field ribbons (shader vibes without a GPU)."""
    if energy < 0.08:
        return
    for band in range(5):
        amp = 40 + energy * 140 + band * 18
        y0 = H * (0.2 + band * 0.14)
        pts: list[tuple[float, float]] = []
        step = 28
        phase = t * (1.2 + band * 0.35) + band
        for x in range(0, W + step, step):
            y = y0 + math.sin(x * 0.008 + phase) * amp * (0.4 + energy)
            y += math.sin(x * 0.019 - phase * 1.3) * amp * 0.35
            pts.append((x, y))
        a = 0.04 + energy * 0.14
        c = vibe_color(HL if band % 2 == 0 else MAG, energy)
        if len(pts) > 1:
            d.line(pts, fill=col(c, a), width=1 + int(energy * 2))


def _draw_geometry(d: ImageDraw.ImageDraw, t: float, level: float, onset: float, flash: float, gnostic: float) -> float:
    """Core sacred geometry; returns R for later layers."""
    R = min(W, H) * (0.17 + gnostic * 0.2 + flash * 0.11)
    spin = t * (0.12 + gnostic * 1.9 + flash * 1.2)
    heat = clamp01(gnostic * 0.7 + flash * 0.5)

    # Soft radial bloom discs
    bloom_r = R * (1.25 + flash * 0.55)
    for k, ca in (
        (1.15, 0.05 + gnostic * 0.12 + flash * 0.08),
        (0.75, 0.08 + flash * 0.14),
        (0.4, 0.14 + level * 0.18 + flash * 0.12),
    ):
        rr = bloom_r * k
        d.ellipse([CX - rr, CY - rr, CX + rr, CY + rr], fill=col(vibe_color(HL, heat * 0.6), ca))

    # Shockwaves
    global _waves
    alive: list[tuple[float, float]] = []
    for birth, max_r in _waves:
        age = t - birth
        if age > 1.0:
            continue
        u = age / 1.0
        rr = 50 + max_r * u
        a = (1.0 - u) * (0.7 + flash * 0.4)
        w = 3 + int((1.0 - u) * 7 + flash * 4)
        d.ellipse([CX - rr, CY - rr, CX + rr, CY + rr], outline=col(vibe_color(HL_HI, heat), a), width=w)
        d.ellipse(
            [CX - rr * 0.9, CY - rr * 0.9, CX + rr * 0.9, CY + rr * 0.9],
            outline=col(GOLD, a * 0.5),
            width=max(1, w - 2),
        )
        alive.append((birth, max_r))
    _waves = alive

    # φ rings (fewer segs when quiet)
    n_rings = 12 if gnostic > 0.25 else 7
    for i in range(n_rings):
        rr = R * (PHI_INV ** (i * 0.34))
        a = 0.1 + gnostic * 0.55 + flash * 0.35 - i * 0.03
        if a <= 0.025:
            continue
        c = vibe_color(HL_HI if i % 2 else HL, heat * (0.4 + 0.05 * i))
        width = 2 + int(flash * 5) + (3 if i == 0 else 0)
        segs = 48 if gnostic > 0.2 else 32
        pts: list[tuple[float, float]] = []
        sense = 1 if i % 2 == 0 else -1
        for s in range(segs + 1):
            if (s % 5) == 4:
                if len(pts) > 1:
                    d.line(pts, fill=col(c, a), width=width)
                pts = []
                continue
            ang = spin * sense * (1.0 + i * 0.05) + (s / segs) * math.tau
            pts.append((CX + math.cos(ang) * rr, CY + math.sin(ang) * rr))
        if len(pts) > 1:
            d.line(pts, fill=col(c, a), width=width)

    # Ad-quadratum
    for i in range(6):
        half = R * 0.58 * (PHI_INV ** i)
        a = 0.12 + gnostic * 0.4 + flash * 0.25 - i * 0.04
        if a <= 0.03:
            continue
        rot = (i * math.pi / 4) + spin * 0.1 * (1 if i % 2 == 0 else -1)
        sq = []
        for k in range(4):
            ang = rot + k * math.tau / 4 + math.pi / 4
            sq.append((CX + math.cos(ang) * half * math.sqrt(2), CY + math.sin(ang) * half * math.sqrt(2)))
        sq.append(sq[0])
        d.line(sq, fill=col(vibe_color(GOLD if i % 2 == 0 else HL, heat), a), width=2 if i < 2 else 1)

    # Seed of life
    seed_r = R * 0.22
    seed_a = 0.1 + gnostic * 0.5 + flash * 0.3
    d.ellipse([CX - seed_r, CY - seed_r, CX + seed_r, CY + seed_r], outline=col(vibe_color(HL_HI, heat), seed_a), width=2)
    for k in range(6):
        ang = spin * 0.35 + k * math.tau / 6 - math.pi / 2
        ox = CX + math.cos(ang) * seed_r
        oy = CY + math.sin(ang) * seed_r
        d.ellipse([ox - seed_r, oy - seed_r, ox + seed_r, oy + seed_r], outline=col(vibe_color(HL, heat), seed_a * 0.9), width=2)

    # Vesica
    vr = R * 0.3
    va = 0.08 + gnostic * 0.35 + flash * 0.2
    d.ellipse([CX - vr * 1.5, CY - vr, CX + vr * 0.5, CY + vr], outline=col(vibe_color(HL, heat), va), width=2)
    d.ellipse([CX - vr * 0.5, CY - vr, CX + vr * 1.5, CY + vr], outline=col(vibe_color(HL, heat), va), width=2)

    # Upright triangle cascade
    for i, scale in enumerate((1.0, PHI_INV, PHI_INV**2, PHI_INV**3, 0.5, 0.25, 0.12)):
        rr = R * 1.0 * scale
        a = 0.2 + gnostic * 0.7 + flash * 0.5 - i * 0.045
        if a <= 0.03:
            continue
        c = vibe_color(GOLD if i in (1, 4) else (HL_HI if i % 2 else HL), heat)
        tri = []
        for k in range(3):
            ang = -math.pi / 2 + k * math.tau / 3
            tri.append((CX + math.cos(ang) * rr, CY + math.sin(ang) * rr))
        tri.append(tri[0])
        d.line(tri, fill=col(c, a), width=3 + int(flash * 4) + (2 if i == 0 else 0))
        if i < 4:
            for vx, vy in tri[:3]:
                nr = 3 + flash * 6 + gnostic * 3
                d.ellipse([vx - nr, vy - nr, vx + nr, vy + nr], fill=col(vibe_color(HL_HI, heat), 0.4 + flash * 0.55))

    # Hex / oct
    for n, mul, sa in ((6, 0.92, 0.18), (8, 0.74, 0.12), (12, 0.6, 0.1), (6, 0.48, 0.14)):
        hex_r = R * (mul + flash * 0.08)
        pts = []
        for k in range(n):
            ang = spin * (0.22 if n == 6 else -0.18) - math.pi / 2 + k * math.tau / n
            if n == 6 and mul < 0.7:
                ang += math.pi / 6
            pts.append((CX + math.cos(ang) * hex_r, CY + math.sin(ang) * hex_r))
        pts.append(pts[0])
        d.line(pts, fill=col(vibe_color(HL, heat), sa + gnostic * 0.45 + flash * 0.3), width=2)

    # Spokes
    for i in range(48):
        ang = spin * 0.14 + i * math.tau / 48
        major = i % 3 == 0
        super_m = i % 6 == 0
        ri = R * (0.25 if super_m else 0.36 if major else 0.55)
        ro = R * (1.06 + flash * 0.12 + (0.06 if super_m else 0))
        a = (0.32 if super_m else 0.18 if major else 0.07) + gnostic * 0.5 + flash * 0.3
        d.line(
            [
                (CX + math.cos(ang) * ri, CY + math.sin(ang) * ri),
                (CX + math.cos(ang) * ro, CY + math.sin(ang) * ro),
            ],
            fill=col(vibe_color(HL_HI if major else HL, heat), a),
            width=4 if super_m else 2 if major else 1,
        )

    # Beams
    beam_a = 0.15 + gnostic * 0.4 + flash * 0.65
    beam_w = 3 + int(flash * 8)
    reach = R * (1.1 + flash * 0.25)
    bc = vibe_color(HL, heat)
    d.line([(CX - reach, CY), (CX + reach, CY)], fill=col(bc, beam_a), width=beam_w)
    d.line([(CX, CY - reach), (CX, CY + reach)], fill=col(bc, beam_a), width=beam_w)
    if flash > 0.15:
        d.line(
            [(CX - reach * 0.75, CY - reach * 0.75), (CX + reach * 0.75, CY + reach * 0.75)],
            fill=col(GOLD, beam_a * 0.65),
            width=max(2, beam_w - 1),
        )
        d.line(
            [(CX + reach * 0.75, CY - reach * 0.75), (CX - reach * 0.75, CY + reach * 0.75)],
            fill=col(MAG, beam_a * 0.45),
            width=max(1, beam_w - 2),
        )

    return R


def _draw_avatar(
    d: ImageDraw.ImageDraw,
    t: float,
    level: float,
    onset: float,
    flash: float,
    gnostic: float,
    heat: float,
) -> None:
    """Voice puppet — gnostic vessel avatar. Limbs/halo lag with the voice.

    Additive-friendly: pure black background, cyan/gold figure + geometry.
    """
    s = AVATAR_S
    # Soft bob / lean from voice (drunken-master sway)
    sway = math.sin(t * 2.1) * (4 + level * 10) * s
    bob = math.sin(t * 3.4) * (2 + level * 6) * s + flash * 4 * s
    breath = math.sin(t * 1.7) * (1.5 + level * 3) * s
    # Squash on onset, stretch on sustain
    stretch = 1.0 + flash * 0.12 - level * 0.04
    squash = 1.0 + level * 0.06 - flash * 0.05

    ax = AX + sway
    ground = AY + 70 * s
    pelvis_y = ground - (48 * s + bob) * stretch
    chest_y = ground - (74 * s + bob * 0.7 + breath) * stretch
    head_y = ground - (98 * s + bob * 0.5 + breath * 1.2) * stretch
    # Jaw opens with level
    jaw = level * 7 * s + flash * 4 * s

    # ── Halo / mandorla behind figure ──
    halo_r = (90 + gnostic * 70 + flash * 40) * s
    for k, ca in (
        (1.35, 0.04 + gnostic * 0.1 + flash * 0.08),
        (1.0, 0.08 + gnostic * 0.14 + flash * 0.1),
        (0.65, 0.12 + level * 0.2 + flash * 0.15),
    ):
        rr = halo_r * k
        d.ellipse(
            [ax - rr, head_y - rr * 0.85, ax + rr, head_y + rr * 1.15],
            fill=col(vibe_color(HL, heat * 0.7), ca),
        )
    # Spinning seal ring around head
    ring_r = (52 + gnostic * 28 + flash * 18) * s
    segs = 36
    spin = t * (0.8 + gnostic * 3.5 + flash * 2)
    pts: list[tuple[float, float]] = []
    for i in range(segs + 1):
        if i % 5 == 4:
            if len(pts) > 1:
                d.line(pts, fill=col(vibe_color(HL_HI, heat), 0.35 + gnostic * 0.5), width=2 + int(flash * 3))
            pts = []
            continue
        ang = spin + i / segs * math.tau
        pts.append((ax + math.cos(ang) * ring_r, head_y + 4 * s + math.sin(ang) * ring_r * 0.92))
    if len(pts) > 1:
        d.line(pts, fill=col(vibe_color(GOLD, heat), 0.4 + flash * 0.4), width=2)

    # Upright triangle crest above head
    crest = (38 + flash * 16) * s
    tri = [
        (ax, head_y - 28 * s - crest),
        (ax - crest * 0.72, head_y - 10 * s),
        (ax + crest * 0.72, head_y - 10 * s),
        (ax, head_y - 28 * s - crest),
    ]
    d.line(tri, fill=col(vibe_color(GOLD, heat), 0.45 + gnostic * 0.45), width=2 + int(flash * 2))

    # ── Shadow ──
    d.ellipse(
        [ax - 28 * s * squash, ground - 4 * s, ax + 28 * s * squash, ground + 8 * s],
        fill=col((0, 0, 0), 0.35),
    )

    # ── Legs (simple two-bone, voice-timed step) ──
    step = t * (2.8 + level * 4.5)
    for side, phase in ((-1, 0.0), (1, math.pi)):
        hip = (ax + side * 8 * s * squash, pelvis_y)
        stride = math.cos(step + phase) * (10 + level * 14) * s
        lift = max(0.0, math.sin(step + phase)) * (6 + level * 10) * s
        foot = (hip[0] + stride * 0.6, ground - lift)
        knee = (
            (hip[0] + foot[0]) * 0.5 + side * 4 * s,
            (hip[1] + foot[1]) * 0.5 + 6 * s,
        )
        d.line([hip, knee, foot], fill=col(vibe_color(HL, heat * 0.5), 0.55 + level * 0.35), width=max(3, int(5 * s)))
        d.ellipse([foot[0] - 5 * s, foot[1] - 3 * s, foot[0] + 7 * s, foot[1] + 4 * s], fill=col(vibe_color(HL_HI, heat), 0.5 + flash * 0.3))

    # ── Torso plates ──
    tw = (18 + level * 4) * s * squash
    # pelvis
    d.polygon(
        [
            (ax - tw * 0.9, pelvis_y + 6 * s),
            (ax + tw * 0.9, pelvis_y + 6 * s),
            (ax + tw * 0.7, pelvis_y - 10 * s),
            (ax - tw * 0.7, pelvis_y - 10 * s),
        ],
        fill=col(vibe_color((20, 40, 55), heat * 0.3), 0.75),
    )
    # chest
    d.polygon(
        [
            (ax - tw * 0.75, chest_y + 14 * s),
            (ax + tw * 0.75, chest_y + 14 * s),
            (ax + tw * 1.05, chest_y - 16 * s),
            (ax - tw * 1.05, chest_y - 16 * s),
        ],
        fill=col(vibe_color((12, 28, 42), heat * 0.4), 0.85),
    )
    # spine glow
    d.line(
        [(ax, pelvis_y), (ax + sway * 0.15, chest_y), (ax + sway * 0.2, head_y + 12 * s)],
        fill=col(vibe_color(HL_HI, heat), 0.5 + gnostic * 0.45 + flash * 0.3),
        width=max(2, int(3 * s + flash * 2)),
    )
    # chest seal (seed triangle)
    cr = (10 + gnostic * 8 + flash * 6) * s
    chest_tri = [
        (ax, chest_y - cr),
        (ax - cr * 0.85, chest_y + cr * 0.6),
        (ax + cr * 0.85, chest_y + cr * 0.6),
        (ax, chest_y - cr),
    ]
    d.line(chest_tri, fill=col(vibe_color(GOLD, heat), 0.55 + flash * 0.4), width=2)
    d.ellipse([ax - 3 * s, chest_y - 3 * s, ax + 3 * s, chest_y + 3 * s], fill=col(HL_HI, 0.7 + flash * 0.3))

    # ── Arms ──
    for side, phase in ((-1, 0.5), (1, 0.0)):
        shoulder = (ax + side * 16 * s * squash, chest_y - 8 * s)
        # Talk gesture: arms float / raise with level
        swing = math.sin(t * 2.4 + phase) * (8 + level * 18) * s
        raise_y = -level * 22 * s - flash * 10 * s
        hand = (
            shoulder[0] + side * (14 + level * 10) * s + swing * 0.3,
            shoulder[1] + 28 * s + raise_y + swing * 0.5,
        )
        elbow = (
            (shoulder[0] + hand[0]) * 0.5 - side * 6 * s,
            (shoulder[1] + hand[1]) * 0.5 + 4 * s,
        )
        d.line([shoulder, elbow, hand], fill=col(vibe_color(HL, heat * 0.6), 0.6 + level * 0.3), width=max(3, int(4.5 * s)))
        # hand glow (voice energy)
        hr = (4 + level * 6 + flash * 5) * s
        d.ellipse(
            [hand[0] - hr, hand[1] - hr, hand[0] + hr, hand[1] + hr],
            fill=col(vibe_color(HL_HI, heat), 0.45 + level * 0.45 + flash * 0.3),
        )

    # ── Head / hood / visor ──
    hr = (16 + level * 2) * s * squash
    d.ellipse(
        [ax - hr * 1.05, head_y - hr * 1.1, ax + hr * 1.05, head_y + hr * 0.95 + jaw * 0.3],
        fill=col(vibe_color((10, 22, 36), heat * 0.35), 0.9),
    )
    # visor seam of light
    d.arc(
        [ax - hr * 0.85, head_y - hr * 0.35, ax + hr * 0.85, head_y + hr * 0.55 + jaw],
        start=200,
        end=340,
        fill=col(vibe_color(HL_HI, heat), 0.75 + flash * 0.25),
        width=max(2, int(3 * s + level * 2)),
    )
    # eyes
    eye_y = head_y - 2 * s
    eye_a = 0.55 + level * 0.4 + flash * 0.3
    for side in (-1, 1):
        ex = ax + side * 6 * s
        d.ellipse([ex - 3 * s, eye_y - 2 * s, ex + 3 * s, eye_y + 2.5 * s], fill=col(HL_HI, eye_a))
        if flash > 0.2:
            d.ellipse([ex - 5 * s, eye_y - 4 * s, ex + 5 * s, eye_y + 4 * s], outline=col(GOLD, flash * 0.6), width=1)
    # mouth / energy slit (opens with voice)
    mw = (3 + level * 10 + flash * 6) * s
    mh = max(1.5 * s, jaw * 0.55)
    d.ellipse(
        [ax - mw, head_y + 6 * s, ax + mw, head_y + 6 * s + mh + 2 * s],
        fill=col(vibe_color(HL_HI if flash > 0.15 else HL, heat), 0.5 + level * 0.5),
    )

    # ── Voice shock rings at chest ──
    if onset > 0.08 or flash > 0.1:
        for k in range(3):
            rr = (20 + onset * 90 + k * 18 + flash * 30) * s
            a = (0.35 - k * 0.1) * (0.4 + onset)
            d.ellipse(
                [ax - rr, chest_y - rr * 0.7, ax + rr, chest_y + rr * 0.7],
                outline=col(vibe_color(HL_HI, heat), a),
                width=2 + int(flash * 2),
            )

    # Nameplate tick under feet
    d.rectangle(
        [ax - 36 * s, ground + 10 * s, ax + 36 * s, ground + 14 * s],
        fill=col(vibe_color(HL, heat), 0.35 + level * 0.45),
    )
    # Level pip
    pip = int(72 * s * clamp01(level))
    d.rectangle(
        [ax - 36 * s, ground + 10 * s, ax - 36 * s + pip, ground + 14 * s],
        fill=col(vibe_color(GOLD if flash > 0.15 else HL_HI, heat), 0.75 + flash * 0.25),
    )


def draw_frame(t: float, dt: float) -> bytes:
    global _pprev_onset, _waves, _glitch
    level, onset = MIC.snapshot()
    # Always draw while OBS is watching. Quiet = dim breath; voice scales.
    breath = 0.1 + 0.045 * (0.5 + 0.5 * math.sin(t * 1.1))
    level_vis = max(level, breath)
    onset_vis = max(onset, breath * 0.25 if level < IDLE_LEVEL else onset)

    gnostic = clamp01(level_vis * 1.45 + onset_vis * 1.05)
    flash = clamp01(onset_vis * 1.45 + level * 0.55)
    heat = clamp01(gnostic * 0.8 + flash * 0.55)

    avatar_mode = VOICE_MODE in ("avatar", "both", "")
    full_mode = VOICE_MODE in ("full", "both")

    if onset > _pprev_onset + 0.08 and onset > 0.12:
        ox, oy = (AX, AY - 40 * AVATAR_S) if avatar_mode else (CX, CY)
        _spawn_burst(onset, ox, oy)
        _waves.append((t, 100 + onset * 520 + level * 240))
        if len(_waves) > 8:
            _waves = _waves[-8:]
        _glitch = max(_glitch, onset)
    _pprev_onset = onset
    _glitch = max(0.0, _glitch - dt * 2.8)
    _step_particles(dt)

    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if full_mode:
        _draw_plasma(d, t, gnostic)
        R = _draw_geometry(d, t, level, onset, flash, gnostic)
        # full-frame core
        core = 10 + int(level * 42 + flash * 36)
        for rad, ca in (
            (core * 3.4, 0.07 + flash * 0.22),
            (core * 2.2, 0.14 + flash * 0.28),
            (core * 1.3, 0.35 + gnostic * 0.45),
            (core * 0.55, 0.9 + flash * 0.1),
            (core * 0.22, 1.0),
        ):
            d.ellipse(
                [CX - rad, CY - rad, CX + rad, CY + rad],
                fill=col(vibe_color(HL_HI if rad < core * 0.8 else HL, heat), ca),
            )
        # corners + scan only in full mode
        ch = 36 + int(level * 32 + flash * 16)
        for sx, sy, dx, dy in (
            (100, 80, 1, 1),
            (W - 100, 80, -1, 1),
            (100, H - 80, 1, -1),
            (W - 100, H - 80, -1, -1),
        ):
            a = 0.2 + gnostic * 0.65 + flash * 0.45
            d.line(
                [(sx - ch * dx, sy - ch * dy * 0.35), (sx, sy), (sx - ch * dx, sy + ch * dy * 0.35)],
                fill=col(vibe_color(HL, heat), a),
                width=3,
            )
        if gnostic > 0.1 or _glitch > 0.05:
            for k in range(5):
                yy = CY + math.sin(t * 2.8 + k * 1.4) * (90 + gnostic * 160)
                a = 0.05 + gnostic * 0.16 + flash * 0.12 + _glitch * 0.2
                d.line([(80, yy), (W - 80, yy)], fill=col(vibe_color(HL_HI, heat), a), width=1 + int(_glitch * 3))

    if avatar_mode:
        _draw_avatar(d, t, level_vis, onset_vis, flash, gnostic, heat)

    # Particles
    hues = (HL, GOLD, MAG, (255, 255, 255))
    for i in range(_PART_N):
        if _plife[i] <= 0:
            continue
        life = _plife[i]
        a = clamp01(life * 1.5) * (0.55 + flash * 0.55)
        pr = 2 + life * 6 + flash * 3
        c = vibe_color(hues[_phue[i] % 4], heat)
        d.ellipse([_px[i] - pr, _py[i] - pr, _px[i] + pr, _py[i] + pr], fill=col(c, a))
        d.ellipse(
            [_px[i] - pr * 0.4, _py[i] - pr * 0.4, _px[i] + pr * 0.4, _py[i] + pr * 0.4],
            fill=col((255, 255, 255), a * 0.7),
        )

    # Voice meter (under avatar or centre)
    if avatar_mode:
        full = int(90 * AVATAR_S)
        bar_x = int(AX - full / 2)
        bar_y = int(AY + 90 * AVATAR_S)
    else:
        full = int(W * 0.36)
        bar_x = (W - full) // 2
        bar_y = H - 70
    bar_w = max(6, int(full * (0.06 + level * 0.94)))
    d.rectangle(
        [bar_x - 3, bar_y - 3, bar_x + full + 3, bar_y + 12],
        outline=col(vibe_color(HL, heat), 0.35 + flash * 0.3),
        width=2,
    )
    d.rectangle(
        [bar_x, bar_y, bar_x + bar_w, bar_y + 9],
        fill=col(vibe_color(HL_HI if flash > 0.15 else HL, heat), 0.55 + level * 0.45),
    )

    # ── Post (voice heat only) ──
    base = Image.new("RGB", (W, H), VOID)
    base.paste(img, mask=img.split()[3])
    out = base

    if heat > 0.14:
        qw, qh = W // 5, H // 5
        small = base.resize((qw, qh), Image.Resampling.BILINEAR)
        bloom = small.filter(ImageFilter.GaussianBlur(radius=2 + int(heat * 4)))
        bloom = bloom.resize((W, H), Image.Resampling.BILINEAR)
        bloom = ImageEnhance.Brightness(bloom).enhance(1.05 + heat * 1.3 + flash * 0.4)
        bloom = ImageEnhance.Color(bloom).enhance(1.3 + heat * 1.5)
        out = ImageChops.add(base, bloom)
        if flash > 0.25:
            shift = int(1 + heat * 8 + flash * 5)
            r, g, b = out.split()
            r = ImageChops.offset(r, shift, 0)
            b = ImageChops.offset(b, -shift, 0)
            out = Image.merge("RGB", (r, g, b))
        out = ImageEnhance.Color(out).enhance(1.15 + heat * 1.1)
        out = ImageEnhance.Brightness(out).enhance(0.97 + level * 0.3 + flash * 0.15)

    bio = io.BytesIO()
    out.save(bio, format="JPEG", quality=70, optimize=False)
    return bio.getvalue()


def render_loop() -> None:
    global JPEG_BUF, JPEG_SEQ
    t0 = time.time()
    last = t0
    while True:
        now = time.time()
        t = now - t0
        dt = min(0.05, now - last)
        last = now
        with JPEG_LOCK:
            clients = STREAM_CLIENTS
        level, onset = MIC.snapshot()
        # Always keep a live avatar frame ready — never park on pure black
        # (OBS would flash black on reconnect / first activate).
        idle = level < IDLE_LEVEL and onset < IDLE_LEVEL and _glitch < 0.02
        if clients <= 0:
            period = 1.0 / 4  # warm buffer cheaply
        else:
            period = 1.0 / (FPS_IDLE if idle else FPS_ACTIVE)
        try:
            frame = draw_frame(t, dt)
        except Exception as e:
            print(f"[voice-overlay] draw_frame error: {e}", flush=True)
            frame = black_jpeg()
        with JPEG_LOCK:
            JPEG_BUF = frame
            JPEG_SEQ += 1
        sleep = period - (time.time() - now)
        if sleep > 0:
            time.sleep(sleep)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # noqa: ARG002
        return

    def do_GET(self) -> None:
        global JPEG_BUF, JPEG_SEQ, STREAM_CLIENTS
        if self.path in ("/", "/health"):
            with JPEG_LOCK:
                n, b = JPEG_SEQ, len(JPEG_BUF)
                cl = STREAM_CLIENTS
            level, onset = MIC.snapshot()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(
                f"ok frames={n} bytes={b} level={level:.2f} onset={onset:.2f} clients={cl}\n".encode()
            )
            return
        if self.path not in ("/stream.mjpg", "/stream.mjpeg", "/mjpeg"):
            self.send_error(404)
            return
        with JPEG_LOCK:
            STREAM_CLIENTS += 1
        self.send_response(200)
        self.send_header("Cache-Control", "no-cache, private")
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=jjvoice")
        self.end_headers()
        last = -1
        try:
            while True:
                with JPEG_LOCK:
                    jpeg, seq = JPEG_BUF, JPEG_SEQ
                if not jpeg or seq == last:
                    time.sleep(0.012)
                    continue
                last = seq
                self.wfile.write(b"--jjvoice\r\nContent-Type: image/jpeg\r\n")
                self.wfile.write(f"Content-Length: {len(jpeg)}\r\n\r\n".encode())
                self.wfile.write(jpeg)
                self.wfile.write(b"\r\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return
        finally:
            with JPEG_LOCK:
                STREAM_CLIENTS = max(0, STREAM_CLIENTS - 1)


def main() -> None:
    threading.Thread(target=mic_loop, daemon=True).start()
    threading.Thread(target=render_loop, daemon=True).start()
    time.sleep(0.35)
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[voice-overlay] http://{HOST}:{PORT}/stream.mjpg", flush=True)
    print("[voice-overlay] OBS: Media Source + Additive blend", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
