#!/usr/bin/env python3
"""Render Arcaia icon sizes from the canonical 256px transparent PNG."""

from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "icons" / "main" / "main_master.png"
MAIN_DIR = ROOT / "icons" / "main"
TOOLBAR_DIR = ROOT / "icons" / "toolbar"
LEGACY_DIR = ROOT / "icons"


def main() -> int:
    if not SOURCE.is_file():
        raise SystemExit(f"Missing PNG source: {SOURCE}")

    with Image.open(SOURCE) as master_image:
        master_rgba = master_image.convert("RGBA")
        if master_rgba.size != (256, 256):
            raise RuntimeError(f"Unexpected master size: {master_rgba.size}")
        alpha_min, alpha_max = master_rgba.getchannel("A").getextrema()
        if alpha_min != 0 or alpha_max != 255:
            raise RuntimeError(f"Unexpected master alpha range: {alpha_min}..{alpha_max}")

        for size in (16, 32, 48, 128):
            main_output = MAIN_DIR / f"icon{size}.png"
            resized = master_rgba.resize((size, size), Image.Resampling.LANCZOS)
            resized.save(main_output, optimize=True)
            shutil.copy2(main_output, LEGACY_DIR / main_output.name)
            shutil.copy2(main_output, TOOLBAR_DIR / main_output.name)

    print("Rendered main, toolbar, and legacy icons from main_master.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
