#!/usr/bin/env python3
"""
A SMALL COPY OF A KIT PHOTO, and the photo's size as a browser shows it (the phone's rotation tag followed, as
OpenCV reads it). Run by `lib/stores/kit.ts` for the tray and the lists; the original is what shoppers enlarge.

    python3 thumb.py in.jpg out.jpg 720      → prints {"w": …, "h": …} (the original's size, upright)
"""
import json
import sys

import cv2


def main():
    src, dst, px = sys.argv[1], sys.argv[2], int(sys.argv[3])
    img = cv2.imread(src, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("cannot read the photo")
    h, w = img.shape[:2]
    s = min(1.0, px / max(w, h))
    small = cv2.resize(img, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA) if s < 1 else img
    cv2.imwrite(dst, small, [cv2.IMWRITE_JPEG_QUALITY, 86, cv2.IMWRITE_JPEG_PROGRESSIVE, 1])
    print(json.dumps({"w": w, "h": h}))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(str(e), file=sys.stderr)
        sys.exit(1)
