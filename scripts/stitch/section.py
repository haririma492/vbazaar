#!/usr/bin/env python3
"""
WHERE IS EACH SECTION IN ITS SHELF'S PHOTO? (owner, 2026-11-15, the pastry redesign: "a small thin arrow connects
that photo - type IV - to its exact location on the already stopped moving shelf on the top section". Run by
`lib/stores/kit.ts`.)

    python3 section.py --shelf shelf.jpg --out places.json section1.jpg section2.jpg ...

The shelf's quality photo (Type III) is square-on, and each section photo (Type IV) is a close-up of part of it. SIFT
points of the section against the shelf, Lowe's ratio test, a homography by MAGSAC; the section's four corners
through it are its place in the shelf photo, as fractions (top-left, top-right, bottom-right, bottom-left).

A homography between unrelated pictures still "agrees" at 10-25 points (measured on the zoom photos, 2026-11-11),
so a place is believed only with enough agreeing points, spread over the section, landing as a sane quadrilateral
inside the shelf. Anything else: { found: false, note } and the operator draws it by hand on the store's page.

The answer: [{ found, quad: [x0,y0, x1,y1, x2,y2, x3,y3] | null, points, note }] in the order given. Free: no AI.
"""
import argparse
import json
import sys

import cv2
import numpy as np

SHELF_PX = 2600
SECTION_PX = 1600


def load(path, px):
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError(f"cannot read {path}")
    h, w = img.shape[:2]
    s = min(1.0, px / max(w, h))
    if s < 1.0:
        img = cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
    return img


def convex(q):
    sign = 0
    for i in range(4):
        a, b, c = q[i], q[(i + 1) % 4], q[(i + 2) % 4]
        z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        if abs(z) < 1e-9:
            return False
        if sign and np.sign(z) != sign:
            return False
        sign = np.sign(z)
    return True


def area(q):
    return abs(sum(q[i][0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * q[i][1] for i in range(4))) / 2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shelf", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("sections", nargs="+")
    a = ap.parse_args()

    sift = cv2.SIFT_create(nfeatures=12000, contrastThreshold=0.02)
    shelf = load(a.shelf, SHELF_PX)
    H0, W0 = shelf.shape[:2]
    ks, ds = sift.detectAndCompute(shelf, None)
    matcher = cv2.FlannBasedMatcher({"algorithm": 1, "trees": 5}, {"checks": 64})
    out = []
    for path in a.sections:
        r = {"found": False, "quad": None, "points": 0, "note": ""}
        try:
            sec = load(path, SECTION_PX)
            h, w = sec.shape[:2]
            kq, dq = sift.detectAndCompute(sec, None)
            if ds is None or dq is None or len(kq) < 20:
                r["note"] = "too few details in the photo to find it"
                out.append(r)
                continue
            pairs = matcher.knnMatch(dq, ds, k=2)
            good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.75 * n.distance]
            if len(good) < 25:
                r["note"] = f"only {len(good)} points in common with the shelf's photo"
                out.append(r)
                continue
            src = np.float32([kq[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
            dst = np.float32([ks[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
            H, inl = cv2.findHomography(src, dst, cv2.USAC_MAGSAC, 4.0, maxIters=5000, confidence=0.999)
            n = int(inl.sum()) if inl is not None else 0
            r["points"] = n
            if H is None or n < 30:
                r["note"] = f"only {n} points agree"
                out.append(r)
                continue
            # The agreeing points must be spread over the section, not bunched in one corner.
            pts = src.reshape(-1, 2)[inl.ravel() > 0]
            spread = (np.ptp(pts[:, 0]) / w) * (np.ptp(pts[:, 1]) / h)
            corners = cv2.perspectiveTransform(np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2), H).reshape(-1, 2)
            q = [(float(x) / W0, float(y) / H0) for x, y in corners]
            inside = all(-0.05 <= x <= 1.05 and -0.05 <= y <= 1.05 for x, y in q)
            if spread < 0.15 or not convex(q) or not inside or area(q) < 0.003 or area(q) > 1.05:
                r["note"] = "the match does not make a believable place in the shelf"
                out.append(r)
                continue
            r["found"] = True
            r["quad"] = [round(min(1.0, max(0.0, v)), 4) for p in q for v in p]
            r["note"] = f"found: {n} points agree"
        except Exception as e:  # noqa: BLE001 — said, and the next photo is tried
            r["note"] = f"could not be read: {e}"
        out.append(r)
    with open(a.out, "w") as f:
        json.dump(out, f)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(str(e), file=sys.stderr)
        sys.exit(1)
