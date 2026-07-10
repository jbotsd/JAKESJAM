#!/usr/bin/env python3
"""Hyprland game window → MJPEG for OBS.

Architecture:
  capture thread — grim -t ppm paced to TARGET_FPS (default 30), only while OBS clients > 0
  encode thread  — ppm → 1920×1080 JPEG
  http thread    — multipart MJPEG for OBS Media Source

  http://127.0.0.1:9876/stream.mjpg
"""
from __future__ import annotations

import io
import json
import os
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image

HOST = "127.0.0.1"
PORT = 9876
# 24fps default — looks fine on stream, ~half the grim/JPEG CPU of 30–45.
# Override: JJ_CAPTURE_FPS=30|45|60  JJ_CAPTURE_JPEG=40..70
TARGET_FPS = max(12, min(60, int(os.environ.get("JJ_CAPTURE_FPS", "24"))))
OUT_W, OUT_H = 1920, 1080
JPEG_QUALITY = int(os.environ.get("JJ_CAPTURE_JPEG", "42"))

TITLE_BITS = ("JAKESJAM", "play.elyad", "crystal-arena", "Hot Lobby", "jakesjam-kiosk")
SKIP_BITS = ("OBS", "Voice Seal")


def find_geom() -> str | None:
    try:
        raw = subprocess.check_output(["hyprctl", "clients", "-j"], text=True, timeout=0.4)
        clients = json.loads(raw)
    except Exception:
        return None
    best = None
    for c in clients:
        title = c.get("title") or ""
        cls = (c.get("class") or "")
        init = (c.get("initialClass") or "")
        cls_l, init_l = cls.lower(), init.lower()
        if any(s in title for s in SKIP_BITS):
            continue
        is_kiosk = (
            "jakesjam-kiosk" in cls_l
            or "jakesjam-kiosk" in init_l
            or "chrome-play.elyad.io" in cls_l
            or "chrome-play.elyad.io" in init_l
        )
        if not (is_kiosk or any(b in title for b in TITLE_BITS)):
            continue
        x, y = c["at"]
        w, h = c["size"]
        if w < 200 or h < 200:
            continue
        area = w * h + (10_000_000 if is_kiosk else 0)
        if w >= 1800 and h >= 1000:
            area += 5_000_000
        if best is None or area > best[0]:
            best = (area, f"{x},{y} {w}x{h}")
    return best[1] if best else None


def parse_ppm(data: bytes) -> Image.Image:
    if len(data) < 16 or data[0:2] != b"P6":
        return Image.open(io.BytesIO(data)).convert("RGB")
    parts: list[bytes] = []
    i = 2
    while len(parts) < 3 and i < len(data):
        while i < len(data) and data[i] in (9, 10, 13, 32):
            i += 1
        if i < len(data) and data[i] == 35:
            while i < len(data) and data[i] not in (10, 13):
                i += 1
            continue
        start = i
        while i < len(data) and data[i] not in (9, 10, 13, 32):
            i += 1
        parts.append(data[start:i])
    try:
        w, h = int(parts[0]), int(parts[1])
    except Exception:
        return Image.open(io.BytesIO(data)).convert("RGB")
    while i < len(data) and data[i] in (9, 10, 13, 32):
        i += 1
        break
    # after maxval, exactly one whitespace then payload
    # ensure we're past maxval token
    need = w * h * 3
    # find payload start: after third token's trailing whitespace
    # re-scan from start more carefully
    i = 2
    tokens = 0
    while tokens < 3 and i < len(data):
        while i < len(data) and data[i] in (9, 10, 13, 32):
            i += 1
        if i < len(data) and data[i] == 35:
            while i < len(data) and data[i] not in (10, 13):
                i += 1
            continue
        while i < len(data) and data[i] not in (9, 10, 13, 32):
            i += 1
        tokens += 1
    while i < len(data) and data[i] in (9, 10, 13, 32):
        i += 1
        break
    if i + need > len(data):
        return Image.open(io.BytesIO(data)).convert("RGB")
    return Image.frombytes("RGB", (w, h), memoryview(data)[i : i + need])


class Shared:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.ppm: bytes | None = None
        self.cap_seq = 0
        self.jpeg = b""
        self.jpg_seq = 0
        self.cap_fps = 0.0
        self.enc_fps = 0.0
        self.geom: str | None = None
        # MJPEG viewers (OBS). When zero we park capture — no grim spin.
        self.clients = 0


S = Shared()


def capture_loop() -> None:
    frames = 0
    t_fps = time.perf_counter()
    geom_age = 99.0
    period = 1.0 / TARGET_FPS
    while True:
        # Idle when nobody is watching — game stays playable without stream kit
        # chewing a whole core of grim+JPEG every frame.
        with S.lock:
            clients = S.clients
        if clients <= 0:
            time.sleep(0.15)
            continue
        t0 = time.perf_counter()
        geom_age += period
        if S.geom is None or geom_age > 0.6:
            S.geom = find_geom()
            geom_age = 0.0
        geom = S.geom
        if not geom:
            time.sleep(0.04)
            continue
        try:
            ppm = subprocess.check_output(
                ["grim", "-g", geom, "-t", "ppm", "-"],
                timeout=0.4,
                stderr=subprocess.DEVNULL,
            )
            with S.lock:
                S.ppm = ppm
                S.cap_seq += 1
            frames += 1
            now = time.perf_counter()
            if now - t_fps >= 1.0:
                S.cap_fps = frames / (now - t_fps)
                frames = 0
                t_fps = now
        except Exception:
            time.sleep(0.005)
        # Pace capture to target — was unbounded grim → 50%+ CPU alone.
        dt = time.perf_counter() - t0
        if dt < period:
            time.sleep(period - dt)


def encode_loop() -> None:
    last = -1
    frames = 0
    t_fps = time.perf_counter()
    period = 1.0 / TARGET_FPS
    while True:
        t0 = time.perf_counter()
        with S.lock:
            clients = S.clients
            seq = S.cap_seq
            ppm = S.ppm
        if clients <= 0:
            time.sleep(0.1)
            continue
        if ppm is None or seq == last:
            time.sleep(0.002)
            continue
        last = seq
        try:
            im = parse_ppm(ppm)
            if im.mode != "RGB":
                im = im.convert("RGB")
            if im.size != (OUT_W, OUT_H):
                im = im.resize((OUT_W, OUT_H), Image.Resampling.NEAREST)
            buf = io.BytesIO()
            im.save(
                buf,
                format="JPEG",
                quality=JPEG_QUALITY,
                optimize=False,
                subsampling=2,
            )
            jpeg = buf.getvalue()
            with S.lock:
                S.jpeg = jpeg
                S.jpg_seq += 1
            frames += 1
            now = time.perf_counter()
            if now - t_fps >= 1.0:
                S.enc_fps = frames / (now - t_fps)
                frames = 0
                t_fps = now
        except Exception:
            pass
        # Don't artificially cap below capture rate — emit ASAP up to 60
        dt = time.perf_counter() - t0
        # only sleep if we're faster than 60
        if dt < period:
            time.sleep(period - dt)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # noqa: ARG002
        return

    def do_GET(self) -> None:
        if self.path in ("/", "/health"):
            with S.lock:
                n, b = S.jpg_seq, len(S.jpeg)
                cf, ef = S.cap_fps, S.enc_fps
                cl = S.clients
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(
                f"ok frames={n} bytes={b} cap_fps={cf:.1f} enc_fps={ef:.1f} "
                f"target={TARGET_FPS} clients={cl}\n".encode()
            )
            return
        if self.path not in ("/stream.mjpg", "/stream.mjpeg", "/mjpeg"):
            self.send_error(404)
            return
        with S.lock:
            S.clients += 1
        self.send_response(200)
        self.send_header("Cache-Control", "no-cache, private")
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=jjframe")
        self.end_headers()
        last = -1
        try:
            while True:
                with S.lock:
                    jpeg, seq = S.jpeg, S.jpg_seq
                if not jpeg or seq == last:
                    time.sleep(0.004)
                    continue
                last = seq
                self.wfile.write(b"--jjframe\r\nContent-Type: image/jpeg\r\n")
                self.wfile.write(f"Content-Length: {len(jpeg)}\r\n\r\n".encode())
                self.wfile.write(jpeg)
                self.wfile.write(b"\r\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return
        finally:
            with S.lock:
                S.clients = max(0, S.clients - 1)


def main() -> None:
    threading.Thread(target=capture_loop, name="cap", daemon=True).start()
    threading.Thread(target=encode_loop, name="enc", daemon=True).start()
    for _ in range(80):
        with S.lock:
            if S.jpeg:
                break
        time.sleep(0.025)
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(
        f"[jj-capture] http://{HOST}:{PORT}/stream.mjpg target={TARGET_FPS}fps "
        f"(grim ceiling ~45–55; OBS still encodes 60)",
        flush=True,
    )
    httpd.serve_forever()


if __name__ == "__main__":
    main()
