#!/usr/bin/env python3
"""
THE VBAZAAR LOOK ON ANY PHOTO (owner, 2026-11-12: "lets coin a template … that we use for all vbazaar photoes").

    python3 look.py in.jpg out.jpg [--quality 92] [--template other.json]

The template is `look.json` beside this file: its brief in words, and the numbers that carry it out. The work is
`look()` in `stack.py` (the shelf zoom photos' stitcher uses the same function): arithmetic on the camera's own
pixels, no generating model, so no word, label, brand or product can change.
"""
import argparse
import sys

import cv2

from stack import look, look_template


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--quality", type=int, default=92)
    ap.add_argument("--template")
    a = ap.parse_args()
    img = cv2.imread(a.src, cv2.IMREAD_COLOR)
    if img is None:
        sys.exit(f"«{a.src}» could not be opened as a photo.")
    T = look_template(a.template)
    out = look(img, lambda m: print(f"[look] {m}", file=sys.stderr), T)
    ok = cv2.imwrite(a.dst, out, [cv2.IMWRITE_JPEG_QUALITY, a.quality] if a.dst.lower().endswith((".jpg", ".jpeg")) else [])
    if not ok:
        sys.exit(f"«{a.dst}» could not be written.")
    print(f"{T['name']} v{T['version']}: {a.dst}")


if __name__ == "__main__":
    main()
