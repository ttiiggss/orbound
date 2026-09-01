#!/usr/bin/env python3
"""Remove backgrounds from ORBOUND mobile concept art using rembg (U2Net),
then crop to content bounds with small padding, producing clean transparent
PNGs suitable for use as game sprites.
"""
import sys
from pathlib import Path
from PIL import Image
from rembg import remove, new_session

SRC_DIR = Path.home() / "orbound" / "assets" / "mobiles"
OUT_DIR = Path.home() / "orbound" / "client" / "sprites"
OUT_DIR.mkdir(parents=True, exist_ok=True)

session = new_session("u2net")

files = sorted(SRC_DIR.glob("mobile_*_00001_.png"))
print(f"Found {len(files)} source images", file=sys.stderr)

for f in files:
    mobile_id = f.stem.split("_")[1]  # mobile_bastion_00001_ -> bastion
    print(f"Processing {mobile_id}...", file=sys.stderr)

    img = Image.open(f).convert("RGBA")
    result = remove(
        img,
        session=session,
        alpha_matting=True,
        alpha_matting_foreground_threshold=240,
        alpha_matting_background_threshold=10,
        alpha_matting_erode_size=8,
    )

    # Crop to content bounding box with padding
    bbox = result.getbbox()
    if bbox:
        pad = 12
        x0, y0, x1, y1 = bbox
        x0 = max(0, x0 - pad)
        y0 = max(0, y0 - pad)
        x1 = min(result.width, x1 + pad)
        y1 = min(result.height, y1 + pad)
        result = result.crop((x0, y0, x1, y1))

    out_path = OUT_DIR / f"{mobile_id}.png"
    result.save(out_path)
    print(f"  -> {out_path} ({result.width}x{result.height})", file=sys.stderr)

print("DONE", file=sys.stderr)
