#!/usr/bin/env python3
"""Generate all 8 ORBOUND mobile concept art assets via ComfyUI/Flux Schnell.
Locked art style: flat vector illustration, thick black outlines, cel-shaded
flat color, chunky cartoon vehicle-with-face design, no text/logos/gradients.
"""
import json
import subprocess
import sys
from pathlib import Path

TOOLS = Path(__file__).parent
WORKFLOW = TOOLS / "flux_schnell_square.json"
OUT_DIR = Path.home() / "orbound" / "assets" / "mobiles"

STYLE_PREFIX = (
    "flat vector illustration of an original video game vehicle mascot character, "
    "thick uniform black outline, flat cel-shaded color fill with no gradients, "
    "2D game asset icon style, chunky rounded cartoon shapes, cute simple face "
    "with two eyes, bold saturated colors, simple flat design like a mobile game "
    "icon, clean sticker illustration, plain white background, no text, no logos, "
    "no letters, no branding, no shading gradients, no 3D render"
)
NEGATIVE = (
    "text, letters, logo, branding, mario, nintendo, copyrighted character, "
    "watermark, signature, photorealistic, 3d render, gradient shading, glossy, "
    "realistic metal texture, gritty, dark, blurry, photograph"
)

MOBILES = [
    {
        "id": "bastion",
        "seed": 100,
        "desc": (
            "a stout heavy battle tank with thick tank treads and a big front "
            "cannon, gunmetal grey and red color scheme, frontline tank vehicle"
        ),
    },
    {
        "id": "driller",
        "seed": 101,
        "desc": (
            "a burrowing drill vehicle with a large spinning drill nose cone, "
            "orange and dark brown color scheme, digging machine on small wheels"
        ),
    },
    {
        "id": "twinsplit",
        "seed": 102,
        "desc": (
            "a floating magical orb vehicle with a glowing crystal core, "
            "purple and gold color scheme, hovering arcane sphere with small wings"
        ),
    },
    {
        "id": "bouncer",
        "seed": 103,
        "desc": (
            "a cheerful frog-shaped hopping vehicle with big coiled spring legs, "
            "bright green and dark green color scheme, bouncy amphibious mobile"
        ),
    },
    {
        "id": "fortress",
        "seed": 104,
        "desc": (
            "a heavily armored turtle-shaped tank with a big domed shell cannon, "
            "olive green and lime yellow color scheme, bulky defensive vehicle"
        ),
    },
    {
        "id": "skyfin",
        "seed": 105,
        "desc": (
            "a sleek winged dragon-shaped flying vehicle with small jet wings, "
            "sky blue and white color scheme, aerodynamic aerial mobile"
        ),
    },
    {
        "id": "ricochet",
        "seed": 106,
        "desc": (
            "a sleek knight-shaped vehicle with a jousting lance on its side, "
            "silver and royal blue color scheme, precision skirmisher mobile"
        ),
    },
    {
        "id": "voltaic",
        "seed": 107,
        "desc": (
            "a compact coil-shaped vehicle with crackling electric arc rods on top, "
            "bright yellow and dark navy color scheme, lightning-themed mobile"
        ),
    },
]


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    wf = json.loads(WORKFLOW.read_text())
    results = []
    for m in MOBILES:
        prompt = f"{STYLE_PREFIX}, {m['desc']}"
        wf["6"]["inputs"]["text"] = prompt
        wf["7"]["inputs"]["text"] = NEGATIVE
        wf["3"]["inputs"]["seed"] = m["seed"]
        wf["9"]["inputs"]["filename_prefix"] = f"mobile_{m['id']}"

        tmp_path = TOOLS / f"_tmp_{m['id']}.json"
        tmp_path.write_text(json.dumps(wf, indent=2))

        print(f"--- Generating {m['id']} (seed={m['seed']}) ---", file=sys.stderr)
        proc = subprocess.run(
            [
                sys.executable, str(TOOLS / "run_workflow.py"),
                "--workflow", str(tmp_path),
                "--args", "{}",
                "--output-dir", str(OUT_DIR),
            ],
            capture_output=True, text=True,
        )
        tmp_path.unlink(missing_ok=True)
        print(proc.stdout, file=sys.stderr)
        if proc.returncode != 0:
            print(f"FAILED: {m['id']}: {proc.stderr}", file=sys.stderr)
            results.append({"id": m["id"], "status": "failed", "error": proc.stderr[-500:]})
            continue
        try:
            out = json.loads(proc.stdout)
            results.append({"id": m["id"], "status": "ok", "file": out["outputs"][0]["file"]})
        except Exception as e:
            results.append({"id": m["id"], "status": "parse_error", "error": str(e)})

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
