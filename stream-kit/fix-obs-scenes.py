#!/usr/bin/env python3
"""Rebuild JAKESJAM OBS scene collection — clean 1080p layout + A/V sync.

Visuals (MJPEG game/voice) lag the live mic by ~150–220ms. We delay mic +
desktop audio by the same amount so speech/music land with the animated
frames, not ahead of them.

Run with OBS closed (or it will overwrite on exit).
"""
from __future__ import annotations

import json
import shutil
import subprocess
import time
import uuid
from datetime import datetime
from pathlib import Path

from PIL import Image

LIVE = Path.home() / ".config/obs-studio/basic/scenes/JAKESJAM.json"
KIT = Path(__file__).resolve().parent / "obs" / "JAKESJAM.json"
PNG = Path(__file__).resolve().parent / "assets" / "png"

# Matched to grim→MJPEG + OBS media buffering (tune via JJ_AV_DELAY_MS)
AV_DELAY_MS = int(__import__("os").environ.get("JJ_AV_DELAY_MS", "180"))
AV_DELAY_NS = AV_DELAY_MS * 1_000_000

MIC_DEV = "alsa_input.usb-Universal_Audio_Volt_476_24482040026582-00.pro-input-0"
DESK_DEV = "alsa_output.usb-Universal_Audio_Volt_476_24482040026582-00.pro-output-0.monitor"

CANVAS_W, CANVAS_H = 1920.0, 1080.0


def uid() -> str:
    return str(uuid.uuid4())


def full_item(
    name: str,
    suuid: str,
    iid: int,
    *,
    visible: bool = True,
    blend: str = "normal",
    locked: bool = False,
) -> dict:
    # bounds_type 1 = stretch to bounds; align 0 = center (align 5 = TOP-LEFT —
    # using 5 with center-based pos shoves items into the bottom-right quadrant)
    return {
        "name": name,
        "source_uuid": suuid,
        "visible": visible,
        "locked": locked,
        "rot": 0.0,
        "scale_ref": {"x": CANVAS_W, "y": CANVAS_H},
        "align": 0,
        "bounds_type": 1,
        "bounds_align": 0,
        "bounds_crop": False,
        "crop_left": 0,
        "crop_top": 0,
        "crop_right": 0,
        "crop_bottom": 0,
        "id": iid,
        "group_item_backup": False,
        "pos": {"x": CANVAS_W / 2, "y": CANVAS_H / 2},
        "pos_rel": {"x": 0.0, "y": 0.0},
        "scale": {"x": 1.0, "y": 1.0},
        "scale_rel": {"x": 1.0, "y": 1.0},
        "bounds": {"x": CANVAS_W, "y": CANVAS_H},
        "bounds_rel": {"x": 0.0, "y": 0.0},
        "scale_filter": "bicubic",
        "blend_method": "srgb_off",
        "blend_type": blend,
        "show_transition": {"duration": 0},
        "hide_transition": {"duration": 0},
        "private_settings": {},
    }


def pin_item(
    name: str,
    suuid: str,
    iid: int,
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    locked: bool = True,
) -> dict:
    # bounds_type 0 = none; top-left style placement with scale 1
    return {
        "name": name,
        "source_uuid": suuid,
        "visible": True,
        "locked": locked,
        "rot": 0.0,
        "scale_ref": {"x": float(w), "y": float(h)},
        "align": 0,  # center align; pos below is the source center (x+w/2, y+h/2)
        "bounds_type": 0,
        "bounds_align": 0,
        "bounds_crop": False,
        "crop_left": 0,
        "crop_top": 0,
        "crop_right": 0,
        "crop_bottom": 0,
        "id": iid,
        "group_item_backup": False,
        "pos": {"x": float(x + w / 2), "y": float(y + h / 2)},
        "pos_rel": {"x": 0.0, "y": 0.0},
        "scale": {"x": 1.0, "y": 1.0},
        "scale_rel": {"x": 1.0, "y": 1.0},
        "bounds": {"x": 0.0, "y": 0.0},
        "bounds_rel": {"x": 0.0, "y": 0.0},
        "scale_filter": "bicubic",
        "blend_method": "srgb_off",
        "blend_type": "normal",
        "show_transition": {"duration": 0},
        "hide_transition": {"duration": 0},
        "private_settings": {},
    }


def image_src(name: str, path: Path) -> dict:
    return {
        "prev_ver": 536936450,
        "name": name,
        "uuid": uid(),
        "id": "image_source",
        "versioned_id": "image_source",
        "settings": {
            "file": str(path),
            "unload": False,
            "linear_alpha": True,
        },
        "mixers": 0,
        "sync": 0,
        "flags": 0,
        "volume": 1.0,
        "balance": 0.5,
        "enabled": True,
        "muted": False,
        "push-to-mute": False,
        "push-to-mute-delay": 0,
        "push-to-talk": False,
        "push-to-talk-delay": 0,
        "hotkeys": {},
        "deinterlace_mode": 0,
        "deinterlace_field_order": 0,
        "monitoring_type": 0,
        "private_settings": {},
    }


def media_src(name: str, url: str, *, muted: bool = True) -> dict:
    # Multipart JPEG streams demux as **mpjpeg** in FFmpeg (not raw mjpeg).
    # Forcing input_format=mjpeg makes OBS Media Source stay black forever.
    return {
        "prev_ver": 536936450,
        "name": name,
        "uuid": uid(),
        "id": "ffmpeg_source",
        "versioned_id": "ffmpeg_source",
        "settings": {
            "is_local_file": False,
            "input": url,
            "input_format": "mpjpeg",
            "reconnect_delay_sec": 1,
            "restart_on_activate": True,
            "clear_on_media_end": False,
            "close_when_inactive": False,
            "hw_decode": False,
            "buffering_mb": 2,
            "speed_percent": 100,
            "color_range": 1,  # full / JPEG range
            "seekable": False,
        },
        "mixers": 0,
        "sync": 0,
        "flags": 0,
        "volume": 1.0,
        "balance": 0.5,
        "enabled": True,
        "muted": muted,
        "push-to-mute": False,
        "push-to-mute-delay": 0,
        "push-to-talk": False,
        "push-to-talk-delay": 0,
        "hotkeys": {},
        "deinterlace_mode": 0,
        "deinterlace_field_order": 0,
        "monitoring_type": 0,  # 0=none 1=monitor only 2=monitor and output
        "private_settings": {},
    }


def pulse_input(name: str, device_id: str, *, delay_ns: int) -> dict:
    return {
        "prev_ver": 536936450,
        "name": name,
        "uuid": uid(),
        "id": "pulse_input_capture",
        "versioned_id": "pulse_input_capture",
        "settings": {"device_id": device_id},
        "mixers": 255,
        "sync": delay_ns,  # nanoseconds — OBS audio sync offset
        "flags": 0,
        "volume": 1.0,
        "balance": 0.5,
        "enabled": True,
        "muted": False,
        "push-to-mute": False,
        "push-to-mute-delay": 0,
        "push-to-talk": False,
        "push-to-talk-delay": 0,
        "hotkeys": {},
        "deinterlace_mode": 0,
        "deinterlace_field_order": 0,
        "monitoring_type": 0,
        "private_settings": {},
    }


def pulse_output(name: str, device_id: str, *, delay_ns: int) -> dict:
    return {
        "prev_ver": 536936450,
        "name": name,
        "uuid": uid(),
        "id": "pulse_output_capture",
        "versioned_id": "pulse_output_capture",
        "settings": {"device_id": device_id},
        "mixers": 255,
        "sync": delay_ns,
        "flags": 0,
        "volume": 0.85,
        "balance": 0.5,
        "enabled": True,
        "muted": False,
        "push-to-mute": False,
        "push-to-mute-delay": 0,
        "push-to-talk": False,
        "push-to-talk-delay": 0,
        "hotkeys": {},
        "deinterlace_mode": 0,
        "deinterlace_field_order": 0,
        "monitoring_type": 0,
        "private_settings": {},
    }


def scene_src(name: str, items: list) -> dict:
    return {
        "prev_ver": 536936450,
        "name": name,
        "uuid": uid(),
        "id": "scene",
        "versioned_id": "scene",
        "settings": {
            "id_counter": 9000,
            "custom_size": False,
            "items": items,
        },
        "mixers": 0,
        "sync": 0,
        "flags": 0,
        "volume": 1.0,
        "balance": 0.5,
        "enabled": True,
        "muted": False,
        "push-to-mute": False,
        "push-to-mute-delay": 0,
        "push-to-talk": False,
        "push-to-talk-delay": 0,
        "hotkeys": {
            "OBSBasic.SelectScene": [],
        },
        "deinterlace_mode": 0,
        "deinterlace_field_order": 0,
        "monitoring_type": 0,
        "private_settings": {},
    }


def build() -> dict:
    lt_w, lt_h = Image.open(PNG / "lower-third.png").size
    iid = 5000

    def nid() -> int:
        nonlocal iid
        iid += 1
        return iid

    sources = [
        image_src("Starting Soon", PNG / "starting-soon.png"),
        image_src("BRB Screen", PNG / "brb.png"),
        image_src("Ending Screen", PNG / "ending.png"),
        image_src("Brand Corner", PNG / "brand-corner.png"),
        image_src("Lower Third", PNG / "lower-third.png"),
        media_src("Game Feed", "http://127.0.0.1:9876/stream.mjpg", muted=True),
        media_src("Voice Seal", "http://127.0.0.1:9877/stream.mjpg", muted=True),
        pulse_input("Mic (Volt)", MIC_DEV, delay_ns=AV_DELAY_NS),
        pulse_output("Desktop Audio", DESK_DEV, delay_ns=AV_DELAY_NS),
    ]
    uu = {s["name"]: s["uuid"] for s in sources}

    # Scene item order: the items array is BACK-to-FRONT — first in list is
    # drawn first (bottom), last is drawn on top. Feed/card goes first,
    # overlays after, or the opaque feed hides them.
    scenes = {
        "STARTING SOON": [
            full_item("Starting Soon", uu["Starting Soon"], nid()),
            full_item("Voice Seal", uu["Voice Seal"], nid(), blend="additive"),
        ],
        "GAME": [
            full_item("Game Feed", uu["Game Feed"], nid()),
            full_item("Voice Seal", uu["Voice Seal"], nid(), blend="additive"),
            full_item("Brand Corner", uu["Brand Corner"], nid()),
            pin_item(
                "Lower Third",
                uu["Lower Third"],
                nid(),
                48,
                CANVAS_H - lt_h - 48,
                lt_w,
                lt_h,
            ),
        ],
        "BRB": [
            full_item("BRB Screen", uu["BRB Screen"], nid()),
            full_item("Voice Seal", uu["Voice Seal"], nid(), blend="additive"),
        ],
        "ENDING": [
            full_item("Ending Screen", uu["Ending Screen"], nid()),
            full_item("Voice Seal", uu["Voice Seal"], nid(), blend="additive"),
        ],
    }

    scene_sources = [scene_src(name, items) for name, items in scenes.items()]
    all_sources = sources + scene_sources

    # Global audio sources must also appear in scenes for mixer... 
    # In OBS, desktop/mic are often in each scene OR in a special "audio sources"
    # Actually pulse sources show in mixer if they're in the current scene OR 
    # marked as audio-only always. Adding them to every scene as invisible items is safest.
    # OBS 28+ "always show" for audio is just having them in the collection - they appear
    # when added to a scene. Add muted-visible false... better add to each scene as hidden:
    for sc in scene_sources:
        items = sc["settings"]["items"]
        # Don't add audio as visual items — OBS audio sources don't need scene items
        # if they're in the sources list; they appear under "Audio Mixer" when in
        # the scene. So append them as items with no size... 
        # Actually for pulse_input_capture to show in mixer, it MUST be in the active scene.
        for aname in ("Mic (Volt)", "Desktop Audio"):
            items.append(
                {
                    "name": aname,
                    "source_uuid": uu[aname],
                    "visible": True,
                    "locked": True,
                    "rot": 0.0,
                    "scale_ref": {"x": 0.0, "y": 0.0},
                    "align": 0,
                    "bounds_type": 0,
                    "bounds_align": 0,
                    "bounds_crop": False,
                    "crop_left": 0,
                    "crop_top": 0,
                    "crop_right": 0,
                    "crop_bottom": 0,
                    "id": nid(),
                    "group_item_backup": False,
                    "pos": {"x": 0.0, "y": 0.0},
                    "pos_rel": {"x": 0.0, "y": 0.0},
                    "scale": {"x": 1.0, "y": 1.0},
                    "scale_rel": {"x": 1.0, "y": 1.0},
                    "bounds": {"x": 0.0, "y": 0.0},
                    "bounds_rel": {"x": 0.0, "y": 0.0},
                    "scale_filter": "disable",
                    "blend_method": "default",
                    "blend_type": "normal",
                    "show_transition": {"duration": 0},
                    "hide_transition": {"duration": 0},
                    "private_settings": {},
                }
            )

    return {
        "name": "JAKESJAM",
        "sources": all_sources,
        "groups": [],
        "scene_order": [{"name": n} for n in ("STARTING SOON", "GAME", "BRB", "ENDING")],
        "current_scene": "GAME",
        "current_program_scene": "GAME",
        "canvases": [],
        "current_transition": "Fade",
        "transition_duration": 300,
        "transitions": [],
        "quick_transitions": [],
        "saved_projectors": [],
        "preview_locked": False,
        "scaling_enabled": False,
        "scaling_level": 0,
        "scaling_off_x": 0.0,
        "scaling_off_y": 0.0,
        "modules": {},
        "version": 2,
    }


def write(path: Path, data: dict) -> None:
    if path.exists():
        bak = path.with_suffix(path.suffix + f".bak-{datetime.now().strftime('%H%M%S')}")
        shutil.copy2(path, bak)
        print(f"backup {bak.name}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")
    print(f"wrote {path}")


def main() -> None:
    print(f"AV delay = {AV_DELAY_MS} ms ({AV_DELAY_NS} ns) on Mic + Desktop")
    # OBS must be closed so it doesn't clobber the file on exit
    subprocess.run(["pkill", "-x", "obs"], check=False)
    # OBS saves the scene collection during shutdown (and often SIGSEGVs in
    # teardown on NVIDIA) — wait for the process to fully exit or its dying
    # save clobbers the JSON we're about to write.
    for _ in range(30):
        if subprocess.run(["pgrep", "-x", "obs"], capture_output=True).returncode != 0:
            break
        time.sleep(0.5)
    time.sleep(1.0)
    data = build()
    write(LIVE, data)
    write(KIT, data)
    # restart servers if needed
    for port, script in (
        (9876, "game-capture-server.py"),
        (9877, "voice-overlay-server.py"),
    ):
        try:
            import urllib.request

            urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=0.5)
            print(f":{port} already up")
        except Exception:
            root = Path(__file__).resolve().parent
            subprocess.Popen(
                ["python3", str(root / script)],
                stdout=open(f"/tmp/jj-{port}.log", "a"),
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            print(f"started {script}")
    time.sleep(0.8)
    subprocess.Popen(
        ["obs", "--profile", "JAKESJAM", "--collection", "JAKESJAM"],
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    # park on ws5
    time.sleep(1.5)
    try:
        clients = json.loads(
            subprocess.check_output(["hyprctl", "clients", "-j"], text=True)
        )
        for c in clients:
            if "obs" in (c.get("class") or "").lower():
                subprocess.run(
                    [
                        "hyprctl",
                        "dispatch",
                        "movetoworkspacesilent",
                        f"5,address:{c['address']}",
                    ],
                    capture_output=True,
                )
                print("OBS → workspace 5")
    except Exception:
        pass
    print("done — check Audio Mixer for Mic (Volt) + Desktop Audio")
    print(f"If lips still lead visuals, raise JJ_AV_DELAY_MS (now {AV_DELAY_MS})")
    print("If visuals lead lips, lower JJ_AV_DELAY_MS (try 120)")


if __name__ == "__main__":
    main()
