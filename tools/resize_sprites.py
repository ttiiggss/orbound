#!/usr/bin/env python3
"""Downscale ORBOUND sprites to game-appropriate resolution and emit a
manifest of dimensions/aspect ratios the renderer can use to draw them
at correct proportions instead of a fixed square.
"""
import json
from pathlib import Path
from PIL import Image

SPRITE_DIR = Path.home() / "orbound" / "client" / "sprites"
MAX_DIM = 220

manifest = {}
for f in sorted(SPRITE_DIR.glob("*.png")):
    img = Image.open(f).convert("RGBA")
    w, h = img.size
    scale = MAX_DIM / max(w, h)
    new_w, new_h = round(w * scale), round(h * scale)
    resized = img.resize((new_w, new_h), Image.LANCZOS)
    resized.save(f)
    manifest[f.stem] = {"width": new_w, "height": new_h, "aspect": round(new_w / new_h, 4)}
    print(f"{f.stem}: {w}x{h} -> {new_w}x{new_h}")

manifest_path = SPRITE_DIR / "manifest.json"
manifest_path.write_text(json.dumps(manifest, indent=2))
print(f"Manifest written: {manifest_path}")
