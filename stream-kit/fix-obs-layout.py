#!/usr/bin/env python3
"""Rewrite JAKESJAM OBS scene transforms for a clean 1080p layout.

Full-screen cards: stretch to canvas.
Brand + lower-third: native size at design positions (from meta.json crop).
Game capture / browser: stretch full canvas.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path
from datetime import datetime

HOME = Path.home()
LIVE = HOME / ".config/obs-studio/basic/scenes/JAKESJAM.json"
KIT = Path(__file__).resolve().parent / "obs" / "JAKESJAM.json"
PNG = Path(__file__).resolve().parent / "assets" / "png"

# Design anchors on 1920×1080 (matches styles.css)
BRAND_X, BRAND_Y = 28.0, 28.0
# lower-third: left 48, bottom 48 → y = 1080 - h - 48
LT_X, LT_BOTTOM = 48.0, 48.0

CANVAS_W, CANVAS_H = 1920.0, 1080.0


def item_transform(
    *,
    name: str,
    source_uuid: str,
    item_id: int,
    pos_x: float,
    pos_y: float,
    scale_x: float,
    scale_y: float,
    bounds_w: float,
    bounds_h: float,
    bounds_type: int,
    visible: bool = True,
    scale_ref_w: float = CANVAS_W,
    scale_ref_h: float = CANVAS_H,
) -> dict:
    """bounds_type: 0=none 1=stretch 2=scale_inner."""
    return {
        "name": name,
        "source_uuid": source_uuid,
        "visible": visible,
        "locked": False,
        "rot": 0.0,
        "scale_ref": {"x": scale_ref_w, "y": scale_ref_h},
        "align": 0,  # center (align 5 = top-left)
        "bounds_type": bounds_type,
        "bounds_align": 0,
        "bounds_crop": False,
        "crop_left": 0,
        "crop_top": 0,
        "crop_right": 0,
        "crop_bottom": 0,
        "id": item_id,
        "group_item_backup": False,
        "pos": {"x": pos_x, "y": pos_y},
        "pos_rel": {"x": 0.0, "y": 0.0},
        "scale": {"x": scale_x, "y": scale_y},
        "scale_rel": {"x": 1.0, "y": 1.0},
        "bounds": {"x": bounds_w, "y": bounds_h},
        "bounds_rel": {"x": 0.0, "y": 0.0},
        "scale_filter": "bicubic",
        "blend_method": "default",
        "blend_type": "normal",
        "show_transition": {"duration": 0},
        "hide_transition": {"duration": 0},
        "private_settings": {},
    }


def uuid_of(sources: list, name: str) -> str:
    for s in sources:
        if s.get("name") == name:
            return s["uuid"]
    raise KeyError(name)


def load_meta(stem: str) -> dict:
    p = PNG / f"{stem}.meta.json"
    if p.exists():
        return json.loads(p.read_text())
    # fallback sizes
    from PIL import Image

    im = Image.open(PNG / f"{stem}.png")
    return {"x": 0, "y": 0, "w": im.size[0], "h": im.size[1], "canvas": {"w": 1920, "h": 1080}}


def fix_collection(path: Path) -> None:
    data = json.loads(path.read_text())
    sources = data["sources"]
    uu = {
        "Starting Soon": uuid_of(sources, "Starting Soon"),
        "BRB Screen": uuid_of(sources, "BRB Screen"),
        "Ending Screen": uuid_of(sources, "Ending Screen"),
        "Brand Corner": uuid_of(sources, "Brand Corner"),
        "Lower Third": uuid_of(sources, "Lower Third"),
        "Game Capture (pick Chrome)": uuid_of(sources, "Game Capture (pick Chrome)"),
        "Game Browser (fallback)": uuid_of(sources, "Game Browser (fallback)"),
    }

    brand = load_meta("brand-corner")
    lt = load_meta("lower-third")
    brand_full = bool(brand.get("full")) or (
        float(brand.get("w", 0)) >= 1800 and float(brand.get("h", 0)) >= 1000
    )
    brand_w, brand_h = float(brand["w"]), float(brand["h"])
    lt_w, lt_h = float(lt["w"]), float(lt["h"])

    # Brand plate: full transparent HUD → 0,0 stretch; cropped → design pin
    if brand_full:
        brand_x, brand_y = 0.0, 0.0
        brand_bounds_type = 1  # stretch to canvas
        brand_bw, brand_bh = CANVAS_W, CANVAS_H
        brand_srw, brand_srh = CANVAS_W, CANVAS_H
    else:
        brand_x, brand_y = BRAND_X, BRAND_Y
        brand_bounds_type = 0
        brand_bw, brand_bh = 0.0, 0.0
        brand_srw, brand_srh = brand_w, brand_h

    lt_x = float(lt.get("x", LT_X))
    if lt_x > 120:
        lt_x = LT_X
    lt_y = float(lt["y"]) if lt.get("y", 0) > 400 else (CANVAS_H - lt_h - LT_BOTTOM)

    print(f"brand full={brand_full} pos=({brand_x},{brand_y}) size=({brand_w},{brand_h})")
    print(f"lt pos=({lt_x},{lt_y}) size=({lt_w},{lt_h})")

    next_id = 1000

    def nid() -> int:
        nonlocal next_id
        next_id += 1
        return next_id

    full = lambda name, suuid: item_transform(
        name=name,
        source_uuid=suuid,
        item_id=nid(),
        pos_x=0,
        pos_y=0,
        scale_x=1,
        scale_y=1,
        bounds_w=CANVAS_W,
        bounds_h=CANVAS_H,
        bounds_type=1,  # stretch to canvas
        scale_ref_w=CANVAS_W,
        scale_ref_h=CANVAS_H,
    )

    scene_items = {
        "STARTING SOON": [full("Starting Soon", uu["Starting Soon"])],
        "BRB": [full("BRB Screen", uu["BRB Screen"])],
        "ENDING": [full("Ending Screen", uu["Ending Screen"])],
        "GAME": [
            full("Game Capture (pick Chrome)", uu["Game Capture (pick Chrome)"]),
            item_transform(
                name="Game Browser (fallback)",
                source_uuid=uu["Game Browser (fallback)"],
                item_id=nid(),
                pos_x=0,
                pos_y=0,
                scale_x=1,
                scale_y=1,
                bounds_w=CANVAS_W,
                bounds_h=CANVAS_H,
                bounds_type=1,
                visible=False,
            ),
            # Brand — full transparent plate or cropped pin
            item_transform(
                name="Brand Corner",
                source_uuid=uu["Brand Corner"],
                item_id=nid(),
                pos_x=brand_x,
                pos_y=brand_y,
                scale_x=1.0,
                scale_y=1.0,
                bounds_w=brand_bw,
                bounds_h=brand_bh,
                bounds_type=brand_bounds_type,
                scale_ref_w=brand_srw,
                scale_ref_h=brand_srh,
            ),
            # Lower third — native cropped pixels
            item_transform(
                name="Lower Third",
                source_uuid=uu["Lower Third"],
                item_id=nid(),
                pos_x=lt_x,
                pos_y=lt_y,
                scale_x=1.0,
                scale_y=1.0,
                bounds_w=0,
                bounds_h=0,
                bounds_type=0,
                scale_ref_w=lt_w,
                scale_ref_h=lt_h,
            ),
        ],
    }

    for s in sources:
        if s.get("id") != "scene" and s.get("unversioned_id") != "scene":
            continue
        name = s.get("name")
        if name in scene_items:
            s.setdefault("settings", {})["items"] = scene_items[name]
            print(f"rewrote scene {name}: {len(scene_items[name])} items")

    # Ensure image paths still point at png/
    for s in sources:
        if s.get("id") == "image_source":
            fn = {
                "Starting Soon": "starting-soon.png",
                "BRB Screen": "brb.png",
                "Ending Screen": "ending.png",
                "Brand Corner": "brand-corner.png",
                "Lower Third": "lower-third.png",
            }.get(s.get("name", ""))
            if fn:
                s.setdefault("settings", {})["file"] = str(PNG / fn)
                s["settings"]["unload"] = False
                s["settings"]["linear_alpha"] = True

    data["current_scene"] = "GAME"
    data["current_program_scene"] = "GAME"

    bak = path.with_suffix(path.suffix + f".bak-{datetime.now().strftime('%H%M%S')}")
    shutil.copy2(path, bak)
    path.write_text(json.dumps(data, indent=2) + "\n")
    print(f"wrote {path} (backup {bak.name})")


def main() -> None:
    # Fix live + kit copies
    for p in (LIVE, KIT):
        if p.exists():
            fix_collection(p)
        else:
            print("skip missing", p)


if __name__ == "__main__":
    main()
