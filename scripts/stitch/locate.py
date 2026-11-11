#!/usr/bin/env python3
"""
WHERE IS THIS SHELF IN THE WALK? (owner, 2026-11-11: "during the free tour … we need to identify the shelves for
which a set of gigapan photos are submitted … bordered with some line, maybe green line, in a rectangle shape … so
the shopper know … this shelf is the one that is fully pictured in a high quality". Run by `lib/stores/gigapan.ts`.)

    python3 locate.py --master master.jpg --video walk.mp4 --projection flat|equirect --out found.json

The shelf's stitched photo is looked for in the walk's own video, and followed while it is in view:

  1  Scan     one moment every `--step` seconds; on a 360° walk six views round the horizon, on a flat walk the
              frame itself. SIFT points of the photo against each view, Lowe's ratio test, a homography by MAGSAC.
  2  Refuse   ⚠️ a homography between two unrelated pictures still "agrees" with 10–25 points (measured on the
              owner's pantry walk against a photo of a dresser). It is believed only when the photo's outline lands
              as a sane quadrilateral (convex, about the photo's shape, a sensible size) and the agreeing points
              are spread over the photo, not bunched in a corner.
  3  Follow   from the best moment, every 0.25 s both ways, the view aimed at where the shelf was; it stops when
              the shelf is lost for a second. A find that cannot be followed for a second is not a find.
  4  Outline  the photo's four corners at every step, in the walk's own units (a direction on a 360° walk: yaw and
              pitch in radians, as the walk's lights; fractions of the frame on a flat one), smoothed over time.

The answer: { ok, found, frames: [{ t, c: [x0,y0, x1,y1, x2,y2, x3,y3] }] (top-left, top-right, bottom-right,
bottom-left), note }. Free: no AI.
"""
import argparse
import json
import math
import sys

import cv2
import numpy as np

MIN_INLIERS = 22
STEP_FOLLOW = 0.25
MISSES = 4            # steps the shelf may be lost for before the follow stops (1 s)
MIN_TRACK = 5         # steps it must be followed for to count (a second)
VIEW_N = 960          # a 360° walk's views, pixels a side
SCAN_FOV = math.radians(100)


def log(m):
    print(f"[locate] {m}", file=sys.stderr, flush=True)


# ── A 360° frame's views: the same arithmetic as `viewDir` / `panoPixel` in lib/splats/projection.ts ──
def view_dirs(lon0, lat0, fov, n, px, py):
    k = math.tan(fov / 2) / (n / 2)
    a, b = (px - n / 2) * k, (n / 2 - py) * k
    cl, sl, co, so = math.cos(lat0), math.sin(lat0), math.cos(lon0), math.sin(lon0)
    x = cl * so + a * co - b * sl * so
    y = sl + b * cl
    z = cl * co - a * so - b * sl * co
    return np.arctan2(x, z), np.arcsin(y / np.sqrt(x * x + y * y + z * z))


def cut_view(frame, lon0, lat0, fov, n=VIEW_N):
    h, w = frame.shape[:2]
    px, py = np.meshgrid(np.arange(n, dtype=np.float32) + 0.5, np.arange(n, dtype=np.float32) + 0.5)
    lon, lat = view_dirs(lon0, lat0, fov, n, px, py)
    u = lon / (2 * math.pi) + 0.5
    u -= np.floor(u)
    mx = (u * w - 0.5).astype(np.float32)
    my = ((0.5 - lat / math.pi) * h - 0.5).astype(np.float32)
    return cv2.remap(frame, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)


class Finder:
    def __init__(self, master):
        s = min(1.0, 1600.0 / max(master.shape[:2]))
        m = cv2.resize(master, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s < 1 else master
        self.mw, self.mh = m.shape[1], m.shape[0]
        self.sift = cv2.SIFT_create(nfeatures=8000, contrastThreshold=0.025)
        kp, self.des = self.sift.detectAndCompute(cv2.cvtColor(m, cv2.COLOR_BGR2GRAY), None)
        self.pts = np.float32([k.pt for k in kp])
        self.bf = cv2.BFMatcher(cv2.NORM_L2)
        self.corners = np.float32([[[0, 0], [self.mw, 0], [self.mw, self.mh], [0, self.mh]]])

    def match(self, view):
        """The photo's outline in `view` (4 points, pixels) and how many points agree; (None, 0) when not there."""
        g = cv2.cvtColor(view, cv2.COLOR_BGR2GRAY)
        up = 1.0
        if max(g.shape) < 1000:  # a small frame: enlarged, so its finest detail is reached
            up = 2.0
            g = cv2.resize(g, None, fx=up, fy=up, interpolation=cv2.INTER_CUBIC)
        kp, des = self.sift.detectAndCompute(g, None)
        if des is None or len(kp) < 12 or self.des is None:
            return None, 0
        good = [m[0] for m in self.bf.knnMatch(self.des, des, k=2) if len(m) == 2 and m[0].distance < 0.78 * m[1].distance]
        if len(good) < MIN_INLIERS:
            return None, 0
        src = np.float32([self.pts[m.queryIdx] for m in good]).reshape(-1, 1, 2)
        dst = (np.float32([kp[m.trainIdx].pt for m in good]) / up).reshape(-1, 1, 2)
        H, inl = cv2.findHomography(src, dst, cv2.USAC_MAGSAC, 3.0, maxIters=4000, confidence=0.999)
        if H is None:
            return None, 0
        n = int(inl.sum())
        if n < MIN_INLIERS:
            return None, 0
        vh, vw = view.shape[:2]
        q = cv2.perspectiveTransform(self.corners, H)[0]
        if not np.isfinite(q).all() or not cv2.isContourConvex(q):
            return None, 0
        area = cv2.contourArea(q)
        if not (0.015 * vw * vh < area < 6.0 * vw * vh):
            return None, 0
        # About the photo's own shape: opposite sides alike, and its width to height within 2.5× of the photo's.
        side = [float(np.linalg.norm(q[i] - q[(i + 1) % 4])) for i in range(4)]
        if min(side) < 8 or max(side[0], side[2]) > 2.2 * min(side[0], side[2]) or max(side[1], side[3]) > 2.2 * min(side[1], side[3]):
            return None, 0
        ratio = ((side[0] + side[2]) / (side[1] + side[3])) / (self.mw / self.mh)
        if not (1 / 2.5 < ratio < 2.5):
            return None, 0
        # The agreeing points are spread over the photo (a bunch in one corner is a look-alike label).
        p = src[inl.ravel() > 0].reshape(-1, 2)
        if (np.ptp(p[:, 0]) / self.mw) * (np.ptp(p[:, 1]) / self.mh) < 0.06:
            return None, 0
        return q, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--master", required=True)
    ap.add_argument("--video", required=True)
    ap.add_argument("--projection", choices=["flat", "equirect"], required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--step", type=float, default=1.0)
    ap.add_argument("--threads", type=int, default=2)
    a = ap.parse_args()
    cv2.setNumThreads(max(1, a.threads))
    out = run(a)
    with open(a.out, "w") as fh:
        json.dump(out, fh)
    print(json.dumps({k: v for k, v in out.items() if k != "frames"} | {"steps": len(out.get("frames", []))}))


def run(a):
    master = cv2.imread(a.master, cv2.IMREAD_COLOR)
    if master is None:
        return {"ok": False, "found": False, "note": "The shelf's stitched photo could not be opened."}
    cap = cv2.VideoCapture(a.video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    seconds = (cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0) / fps
    if seconds <= 0:
        return {"ok": False, "found": False, "note": "The walk's video could not be read."}
    finder = Finder(master)
    flat = a.projection == "flat"

    def frame_at(t):
        cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t) * 1000.0)
        ok, f = cap.read()
        return f if ok else None

    def to_units(q, f, aim):
        """The outline in the walk's units: fractions of a flat frame, or directions on a 360° one."""
        if flat:
            h, w = f.shape[:2]
            return [(float(x) / w, float(y) / h) for x, y in q]
        lon0, lat0, fov = aim
        lon, lat = view_dirs(lon0, lat0, fov, VIEW_N, q[:, 0].astype(np.float64), q[:, 1].astype(np.float64))
        return [(float(lo), float(la)) for lo, la in zip(lon, lat)]

    def look(t, aim):
        f = frame_at(t)
        if f is None:
            return None, 0, None
        view = f if flat else cut_view(f, *aim)
        q, n = finder.match(view)
        return (to_units(q, f, aim) if q is not None else None), n, f

    def centre(c):
        if flat:
            return sum(p[0] for p in c) / 4, sum(p[1] for p in c) / 4
        # The middle direction: the mean of the corners as vectors.
        v = np.sum([[math.cos(la) * math.sin(lo), math.sin(la), math.cos(la) * math.cos(lo)] for lo, la in c], axis=0)
        return math.atan2(v[0], v[2]), math.asin(v[1] / np.linalg.norm(v))

    def aim_at(c):
        """A view on the shelf: at its middle, wide enough to hold it with room round it."""
        if flat:
            return None
        lo, la = centre(c)
        ext = max(math.acos(max(-1, min(1, math.cos(la) * math.cos(p[1]) * math.cos(lo - p[0]) + math.sin(la) * math.sin(p[1])))) for p in c)
        return lo, max(-1.1, min(1.1, la)), max(math.radians(50), min(math.radians(125), 2.6 * ext))

    # 1. The scan.
    aims = [None] if flat else [(k * math.pi / 3, 0.0, SCAN_FOV) for k in range(6)]
    best = (0, None, None)
    t = 0.0
    while t < seconds - 0.05:
        for aim in aims:
            c, n, _ = look(t, aim)
            if c is not None and n > best[0]:
                best = (n, t, c)
        t += a.step
    if best[1] is None:
        return {"ok": True, "found": False, "note": "This shelf was not seen anywhere in the walk."}
    log(f"best at {best[1]:.1f} s with {best[0]} agreeing points")

    # 3. The follow, both ways from the best moment.
    def moved_far(c0, c1):
        a0, a1 = centre(c0), centre(c1)
        if flat:
            return math.hypot(a0[0] - a1[0], a0[1] - a1[1]) > 0.3
        d = math.acos(max(-1, min(1, math.cos(a0[1]) * math.cos(a1[1]) * math.cos(a0[0] - a1[0]) + math.sin(a0[1]) * math.sin(a1[1]))))
        return d > math.radians(25)

    frames = {round(best[1], 3): best[2]}
    scores = [best[0]]
    for sign in (1, -1):
        last, misses, t = best[2], 0, best[1]
        while misses < MISSES and len(frames) < 400:
            t += sign * STEP_FOLLOW
            if t < 0 or t > seconds - 0.05:
                break
            c, n, _ = look(t, aim_at(last))
            if c is None or moved_far(last, c):
                misses += 1
                continue
            misses = 0
            last = c
            frames[round(t, 3)] = c
            scores.append(n)
    if len(frames) < MIN_TRACK:
        return {"ok": True, "found": False, "note": "Something like this shelf was seen for a moment, but it could not be followed: not taken as the shelf."}

    # 4. Smoothed over time (each corner's own wobble out; on a 360° walk the yaw is unwrapped first).
    ts = sorted(frames)
    arr = np.array([[v for p in frames[t] for v in p] for t in ts], dtype=np.float64)  # (steps, 8)
    if not flat:
        for k in (0, 2, 4, 6):
            arr[:, k] = np.unwrap(arr[:, k])
    if len(ts) >= 5:
        pad = np.pad(arr, ((2, 2), (0, 0)), mode="edge")
        arr = np.median(np.stack([pad[i:i + len(ts)] for i in range(5)]), axis=0)
        pad = np.pad(arr, ((1, 1), (0, 0)), mode="edge")
        arr = (pad[:-2] + pad[1:-1] + pad[2:]) / 3
    if not flat:
        for k in (0, 2, 4, 6):
            arr[:, k] = (arr[:, k] + math.pi) % (2 * math.pi) - math.pi
    out = [{"t": float(t), "c": [round(float(v), 4) for v in row]} for t, row in zip(ts, arr)]
    return {
        "ok": True, "found": True, "from": ts[0], "to": ts[-1], "points": int(np.median(scores)), "frames": out,
        "note": f"Seen in the walk from {ts[0]:.1f} s to {ts[-1]:.1f} s ({len(ts)} steps, about {int(np.median(scores))} points agreeing at each).",
    }


if __name__ == "__main__":
    main()
