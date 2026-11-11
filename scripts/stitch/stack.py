#!/usr/bin/env python3
"""
THE SHELF ZOOM PHOTO — the stitcher and its Deep Zoom tiles (owner, 2026-11-11: "take 3 Gigapan style photo of a
shelf and you need to stitch them together so user … zoom in and out and read labels"). Run by
`lib/stores/gigapan.ts`; needs python3, numpy and opencv-python-headless (the Dockerfile installs them).

    python3 stack.py --out <dir> [--tile 512] [--quality 85] [--max-mp 100] photo1 photo2 photo3

The photos are one shelf bay from one spot, the camera tilted between them (top, middle, bottom, about a third of
each shared with its neighbour). Any order: which is above which is found from the matches.

  1  Order     every pair is matched both ways on small copies; the stack with the most agreeing points wins.
  2  Match     SIFT points, ONLY in the bands that can overlap (the lower part of the upper photo, the upper part of
               the lower one: a shelf is rows of the same packaging, and a point matched outside the overlap is a
               look-alike on another row); Lowe's ratio test, then a homography by MAGSAC.
  3  Project   every photo onto the MIDDLE photo's plane (planar: the shelf's straight edges stay straight).
  4  Crop      the largest upright rectangle inside the photos' outlines, found before anything is drawn, so the
               canvas is only what will be kept.
  5  Exposure  each photo's colour channels scaled to its neighbour's in the part they share (brightness and white
               balance), so no band shows across the shelf.
  6  Seam      a path across the shared part where the two photos differ least (a jar that stands out from the
               shelf is not cut in two), blended in bands of detail (multi-band, OpenCV's blender) round that path
               only; everywhere else a photo's own pixels are kept as they are.
  7  Tiles     the master (JPEG) and a Deep Zoom (DZI) pyramid: `shelf.dzi`, `shelf_files/<level>/<col>_<row>.jpg`,
               progressive JPEG; `manifest.json` says the same in JSON; `thumb.jpg` for the mini-map.

The answer is `<out>/result.json`: { ok: true, w, h, … } or { ok: false, error: a sentence a person can act on }.
Memory: the canvas (3 bytes a pixel) plus one photo and its warped copy at a time; about 1 GB for 100 megapixels.
"""
import argparse
import itertools
import json
import math
import os
import sys
import time

import cv2
import numpy as np

BAND = 0.62          # the share of a photo (from its shared edge) where matches are looked for
ORDER_SIDE = 1100    # the long side of the copies the order is found on
MATCH_SIDE = 2400    # …and of the copies the final homographies come from
MIN_INLIERS = 14
PAD = 192            # rows blended each side of the seam's span
BANDS = 6


class Refused(Exception):
    pass


def load(path):
    img = cv2.imread(path, cv2.IMREAD_COLOR)  # upright: the phone's rotation tag is followed
    if img is None:
        raise Refused(f"«{os.path.basename(path)}» could not be opened as a photo.")
    return img


def shrink(img, side):
    h, w = img.shape[:2]
    s = min(1.0, side / max(h, w))
    if s >= 1.0:
        return img, 1.0
    return cv2.resize(img, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA), s


def points(gray, top, sift):
    """SIFT points in the photo's top band (`top`) or its bottom band."""
    h = gray.shape[0]
    mask = np.zeros(gray.shape, np.uint8)
    if top:
        mask[: int(h * BAND)] = 255
    else:
        mask[int(h * (1 - BAND)):] = 255
    kp, des = sift.detectAndCompute(gray, mask)
    return (np.float32([k.pt for k in kp]) if kp else np.zeros((0, 2), np.float32)), des


def pair(upper, lower):
    """The homography taking the LOWER photo's points into the UPPER photo, and how many matches agree with it."""
    (pu, du), (pl, dl) = upper, lower
    if du is None or dl is None or len(pu) < 8 or len(pl) < 8:
        return None, 0
    good = []
    for m in cv2.BFMatcher(cv2.NORM_L2).knnMatch(dl, du, k=2):
        if len(m) == 2 and m[0].distance < 0.75 * m[1].distance:
            good.append(m[0])
    if len(good) < 8:
        return None, 0
    src = np.float32([pl[m.queryIdx] for m in good]).reshape(-1, 1, 2)
    dst = np.float32([pu[m.trainIdx] for m in good]).reshape(-1, 1, 2)
    H, inl = cv2.findHomography(src, dst, cv2.USAC_MAGSAC, 3.0, maxIters=5000, confidence=0.999)
    if H is None:
        return None, 0
    return H, int(inl.sum())


def sane(H, wl, hl, wu, hu):
    """The lower photo must land below the upper one, about the same size, not folded over."""
    c = cv2.perspectiveTransform(np.float32([[[wl / 2, hl / 2]]]), H)[0][0]
    if not (c[1] > hu * 0.55 and -0.5 * wu < c[0] < 1.5 * wu):
        return False
    q = cv2.perspectiveTransform(np.float32([[[0, 0], [wl, 0], [wl, hl], [0, hl]]]), H)[0]
    if not cv2.isContourConvex(q.astype(np.float32)):
        return False
    area = cv2.contourArea(q.astype(np.float32))
    return 0.25 * wl * hl < area < 6 * wl * hl


def inscribed(mask):
    """The largest upright rectangle of set pixels: (x, y, w, h)."""
    h, w = mask.shape
    heights = np.zeros(w, np.int32)
    best = (0, 0, 0, 0, 0)
    for y in range(h):
        heights = np.where(mask[y] > 0, heights + 1, 0)
        stack = []
        for x in range(w + 1):
            cur = int(heights[x]) if x < w else 0
            start = x
            while stack and stack[-1][1] >= cur:
                sx, sh = stack.pop()
                area = sh * (x - sx)
                if area > best[0]:
                    best = (area, sx, y - sh + 1, x - sx, sh)
                start = sx
            stack.append((start, cur))
    return best[1:]


def seam_rows(a, b, both, new_above):
    """
    A path across the shared part, one row per column, where the two photos differ least. `a`, `b`: the two
    photos there (small, BGR); `both`: where both have pixels. Returns the row for each column.
    """
    h, w = both.shape
    diff = cv2.absdiff(a, b).astype(np.float32).sum(axis=2)
    diff = cv2.GaussianBlur(diff, (0, 0), 2.0)
    cost = np.where(both, diff, 1e6).astype(np.float32)
    # Kept toward the middle of the shared part: the blend needs both photos on both sides of the path.
    rows = np.arange(h, dtype=np.float32)[:, None]
    cnt = both.sum(axis=0).astype(np.float32)
    first = np.where(cnt > 0, both.argmax(axis=0), 0).astype(np.float32)
    mid = first + cnt / 2
    cost += 40.0 * (np.abs(rows - mid[None, :]) / np.maximum(1.0, cnt[None, :] / 2)) ** 2
    acc = cost[:, 0].copy()
    back = np.zeros((h, w), np.int8)
    for c in range(1, w):
        up = np.concatenate(([np.inf], acc[:-1]))
        dn = np.concatenate((acc[1:], [np.inf]))
        stackd = np.stack((up, acc, dn))
        k = stackd.argmin(axis=0)
        acc = cost[:, c] + stackd[k, np.arange(h)]
        back[:, c] = k - 1
    path = np.zeros(w, np.int32)
    r = int(acc.argmin())
    for c in range(w - 1, -1, -1):
        path[c] = r
        r = min(h - 1, max(0, r + int(back[r, c])))
    # Columns only one photo reaches: the path stays at the nearest column both reach.
    has = cnt > 0
    if has.any() and not has.all():
        idx = np.arange(w)
        path = np.interp(idx, idx[has], path[has]).astype(np.int32)
    return path


def lut_gain(img, gains):
    table = np.zeros((256, 1, 3), np.uint8)
    for ch in range(3):
        table[:, 0, ch] = np.clip(np.arange(256) * gains[ch], 0, 255).astype(np.uint8)
    return cv2.LUT(img, table)


def stitch(paths, max_mp, log):
    sift = cv2.SIFT_create(nfeatures=8000, contrastThreshold=0.03)
    n = len(paths)
    sizes = []
    # 1. The order, on small copies (one photo in memory at a time).
    feats = []
    for p in paths:
        img = load(p)
        sizes.append((img.shape[1], img.shape[0]))
        g, s = shrink(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), ORDER_SIDE)
        feats.append({"s": s, "w": g.shape[1], "h": g.shape[0], "top": points(g, True, sift), "bot": points(g, False, sift)})
        del img
    score = {}
    for u, l in itertools.permutations(range(n), 2):
        H, k = pair(feats[u]["bot"], feats[l]["top"])
        if H is not None and not sane(H, feats[l]["w"], feats[l]["h"], feats[u]["w"], feats[u]["h"]):
            k = 0
        score[(u, l)] = k
    best, order = (-1, -1), None
    for perm in itertools.permutations(range(n)):
        ks = [score[(perm[i], perm[i + 1])] for i in range(n - 1)]
        val = (min(ks), sum(ks))
        if val > best:
            best, order = val, list(perm)
    names = [os.path.basename(p) for p in paths]
    if best[0] < MIN_INLIERS:
        weakest = min(range(n - 1), key=lambda i: score[(order[i], order[i + 1])])
        raise Refused(
            f"These photos do not join: «{names[order[weakest]]}» and «{names[order[weakest + 1]]}» share too little "
            f"(only {score[(order[weakest], order[weakest + 1])]} points agree). Take them again from one spot, tilting "
            "the camera up and down only, with about a third of each photo shared with the next."
        )
    log(f"order (top to bottom): {[names[i] for i in order]}; agreeing points on the small copies: {[score[(order[i], order[i + 1])] for i in range(n - 1)]}")

    # 2. The homographies, on larger copies, each lower photo into the one above it.
    big = []
    for i in order:
        img = load(paths[i])
        g, s = shrink(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), MATCH_SIDE)
        big.append({"s": s, "top": points(g, True, sift), "bot": points(g, False, sift)})
        del img, g
    up_from_low = []  # H taking photo k+1 (full size) into photo k (full size), in stack order
    inliers = []
    for k in range(n - 1):
        H, cnt = pair(big[k]["bot"], big[k + 1]["top"])
        wl, hl = sizes[order[k + 1]]
        wu, hu = sizes[order[k]]
        if H is not None:
            H = np.diag([1 / big[k]["s"], 1 / big[k]["s"], 1.0]) @ H @ np.diag([big[k + 1]["s"], big[k + 1]["s"], 1.0])
        if H is None or cnt < MIN_INLIERS or not sane(H, wl, hl, wu, hu):
            raise Refused(f"«{names[order[k]]}» and «{names[order[k + 1]]}» could not be lined up exactly ({cnt} points agree). Take them again with more of each shared.")
        up_from_low.append(H)
        inliers.append(cnt)
    del big, feats

    # 3. Every photo onto the middle photo's plane.
    ref = n // 2
    M = [None] * n
    M[ref] = np.eye(3)
    for k in range(ref - 1, -1, -1):      # above the middle
        M[k] = M[k + 1] @ np.linalg.inv(up_from_low[k])
    for k in range(ref + 1, n):           # below it
        M[k] = M[k - 1] @ up_from_low[k - 1]
    quads = []
    for k in range(n):
        w, h = sizes[order[k]]
        quads.append(cv2.perspectiveTransform(np.float32([[[0, 0], [w, 0], [w, h], [0, h]]]), M[k])[0])
    allq = np.concatenate(quads)
    x0, y0 = allq.min(axis=0)
    x1, y1 = allq.max(axis=0)

    # 4. The crop, before anything is drawn.
    f = 900.0 / max(x1 - x0, y1 - y0)
    sm = np.zeros((int(math.ceil((y1 - y0) * f)) + 1, int(math.ceil((x1 - x0) * f)) + 1), np.uint8)
    for q in quads:
        cv2.fillConvexPoly(sm, np.round((q - [x0, y0]) * f).astype(np.int32), 255)
    sm = cv2.erode(sm, np.ones((3, 3), np.uint8))
    rx, ry, rw, rh = inscribed(sm)
    if rw < 20 or rh < 20:
        raise Refused("The photos join, but leave no clean rectangle of the shelf. Take them again, square on to the shelf.")
    cx0, cy0 = x0 + (rx + 1) / f, y0 + (ry + 1) / f
    cw, ch = (rw - 2) / f, (rh - 2) / f
    g = min(1.0, math.sqrt(max_mp * 1e6 / (cw * ch)))
    W, Hh = int(cw * g), int(ch * g)
    place = np.diag([g, g, 1.0]) @ np.array([[1, 0, -cx0], [0, 1, -cy0], [0, 0, 1.0]])
    log(f"canvas {W}x{Hh} ({W * Hh / 1e6:.1f} MP), scale {g:.3f}")

    canvas = np.zeros((Hh, W, 3), np.uint8)
    valid = np.zeros((Hh, W), np.uint8)
    gains_out = {}
    todo = [ref] + [k for d in range(1, n) for k in (ref - d, ref + d) if 0 <= k < n]
    for k in todo:
        img = load(paths[order[k]])
        A = place @ M[k]
        if g < 0.8:  # shrunk first, with area averaging, so a much smaller canvas does not shimmer
            img = cv2.resize(img, None, fx=g, fy=g, interpolation=cv2.INTER_AREA)
            A = A @ np.diag([1 / g, 1 / g, 1.0])
        ih, iw = img.shape[:2]
        q = cv2.perspectiveTransform(np.float32([[[0, 0], [iw, 0], [iw, ih], [0, ih]]]), A)[0]
        bx0, by0 = max(0, int(math.floor(q[:, 0].min()))), max(0, int(math.floor(q[:, 1].min())))
        bx1, by1 = min(W, int(math.ceil(q[:, 0].max()))), min(Hh, int(math.ceil(q[:, 1].max())))
        if bx1 - bx0 < 2 or by1 - by0 < 2:
            continue
        R = np.array([[1, 0, -bx0], [0, 1, -by0], [0, 0, 1.0]]) @ A
        size = (bx1 - bx0, by1 - by0)
        warped = cv2.warpPerspective(img, R, size, flags=cv2.INTER_CUBIC)
        mask = cv2.warpPerspective(np.full((ih, iw), 255, np.uint8), R, size, flags=cv2.INTER_NEAREST)
        mask = cv2.erode(mask, np.ones((5, 5), np.uint8))
        del img
        croi = canvas[by0:by1, bx0:bx1]
        vroi = valid[by0:by1, bx0:bx1]
        both = (vroi > 0) & (mask > 0)
        if not vroi.any():
            cv2.copyTo(warped, mask, croi)
            vroi |= mask
            gains_out[names[order[k]]] = [1.0, 1.0, 1.0]
            continue
        if int(both.sum()) < 0.02 * size[0] * size[1]:
            raise Refused(f"«{names[order[k]]}» shares almost nothing with the photo next to it once lined up.")
        # 5. Exposure: this photo's channels to its neighbour's, over what they share (burnt-out and black left out).
        ys, xs = np.nonzero(both[::8, ::8])
        a = croi[::8, ::8][ys, xs].astype(np.float32)
        b = warped[::8, ::8][ys, xs].astype(np.float32)
        ok = (a.max(axis=1) < 245) & (b.max(axis=1) < 245) & (a.min(axis=1) > 8) & (b.min(axis=1) > 8)
        gains = np.clip(a[ok].mean(axis=0) / np.maximum(1.0, b[ok].mean(axis=0)), 0.6, 1.7) if ok.sum() > 200 else np.ones(3)
        warped = lut_gain(warped, gains)
        gains_out[names[order[k]]] = [round(float(v), 3) for v in gains]
        # 6. The seam, found small, and the two sides of it.
        rows_any = np.nonzero(both.any(axis=1))[0]
        oy0, oy1 = int(rows_any[0]), int(rows_any[-1]) + 1
        fs = min(1.0, 700.0 / size[0])
        sw, sh = max(8, int(size[0] * fs)), max(8, int((oy1 - oy0) * fs))
        sa = cv2.resize(croi[oy0:oy1], (sw, sh), interpolation=cv2.INTER_AREA)
        sb = cv2.resize(warped[oy0:oy1], (sw, sh), interpolation=cv2.INTER_AREA)
        sboth = cv2.resize(both[oy0:oy1].astype(np.uint8), (sw, sh), interpolation=cv2.INTER_NEAREST) > 0
        new_above = k < ref
        path = seam_rows(sa, sb, sboth, new_above).astype(np.float32)
        path = cv2.blur(path.reshape(1, -1), (9, 1)).ravel()
        seam = oy0 + np.interp(np.linspace(0, sw - 1, size[0]), np.arange(sw), path) * ((oy1 - oy0) / sh)
        above = np.arange(size[1], dtype=np.float32)[:, None] < seam[None, :]
        new_side = above if new_above else ~above
        new_own = (mask > 0) & (new_side | (vroi == 0))
        old_own = (vroi > 0) & ~new_own
        del above, new_side
        # Round the seam: blended in bands of detail. Elsewhere: each photo's own pixels.
        b0, b1 = max(0, int(seam.min()) - PAD), min(size[1], int(seam.max()) + PAD + 1)
        blender = cv2.detail_MultiBandBlender(0, BANDS)
        blender.prepare((0, 0, size[0], b1 - b0))
        blender.feed(croi[b0:b1].astype(np.int16), old_own[b0:b1].astype(np.uint8) * 255, (0, 0))
        blender.feed(warped[b0:b1].astype(np.int16), new_own[b0:b1].astype(np.uint8) * 255, (0, 0))
        res, res_mask = blender.blend(None, None)
        res = np.clip(res, 0, 255).astype(np.uint8)
        cv2.copyTo(warped, new_own.astype(np.uint8) * 255, croi)
        # Only where BOTH photos have pixels: at an edge one photo does not reach, the blend would fade to black.
        inner = cv2.erode(both[b0:b1].astype(np.uint8) * 255, np.ones((3, 3), np.uint8))
        cv2.copyTo(res, cv2.bitwise_and(inner, res_mask), croi[b0:b1])
        vroi |= mask
        del warped, mask, both, new_own, old_own, res
    # The edges trimmed to whole rows and columns of pixels (the crop was found on a small copy).
    t, b, l, r = 0, Hh, 0, W
    for _ in range(200):
        moved = False
        if valid[t, l:r].min() == 0: t += 1; moved = True
        if valid[b - 1, l:r].min() == 0: b -= 1; moved = True
        if valid[t:b, l].min() == 0: l += 1; moved = True
        if valid[t:b, r - 1].min() == 0: r -= 1; moved = True
        if not moved or b - t < 16 or r - l < 16:
            break
    master = np.ascontiguousarray(canvas[t:b, l:r])
    return master, {"order": [names[i] for i in order], "inliers": inliers, "gains": gains_out}


def tiles(master, out, tile, quality):
    """The Deep Zoom pyramid: level `max` is the master, each level below half of it, down to one pixel."""
    h, w = master.shape[:2]
    top = int(math.ceil(math.log2(max(w, h))))
    params = [cv2.IMWRITE_JPEG_QUALITY, quality, cv2.IMWRITE_JPEG_PROGRESSIVE, 1, cv2.IMWRITE_JPEG_OPTIMIZE, 1]
    img, count = master, 0
    thumb = None
    for level in range(top, -1, -1):
        lh, lw = img.shape[:2]
        d = os.path.join(out, "shelf_files", str(level))
        os.makedirs(d, exist_ok=True)
        for row in range(0, lh, tile):
            for col in range(0, lw, tile):
                cv2.imwrite(os.path.join(d, f"{col // tile}_{row // tile}.jpg"), img[row:row + tile, col:col + tile], params)
                count += 1
        if thumb is None and max(lw, lh) <= 640:
            thumb = img
        if level > 0:
            img = cv2.resize(img, (max(1, (lw + 1) // 2), max(1, (lh + 1) // 2)), interpolation=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(out, "thumb.jpg"), thumb if thumb is not None else img, [cv2.IMWRITE_JPEG_QUALITY, 82])
    with open(os.path.join(out, "shelf.dzi"), "w") as fh:
        fh.write(f'<?xml version="1.0" encoding="UTF-8"?>\n<Image xmlns="http://schemas.microsoft.com/deepzoom/2008" Format="jpg" Overlap="0" TileSize="{tile}"><Size Width="{w}" Height="{h}"/></Image>\n')
    manifest = {"type": "dzi", "w": w, "h": h, "tile": tile, "overlap": 0, "format": "jpg", "maxLevel": top, "files": "shelf_files", "thumb": "thumb.jpg"}
    with open(os.path.join(out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh)
    return manifest, count


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--tile", type=int, default=512)
    ap.add_argument("--quality", type=int, default=85)
    ap.add_argument("--max-mp", type=float, default=100.0)
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("photos", nargs="+")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    cv2.setNumThreads(max(1, a.threads))
    started = time.time()
    log = lambda m: print(f"[stack] {m}", file=sys.stderr, flush=True)
    result_path = os.path.join(a.out, "result.json")
    try:
        if len(a.photos) > 5:
            raise Refused("At most 5 photos a shelf.")
        if len(a.photos) == 1:  # one photo: nothing to join, only its tiles
            master, info = load(a.photos[0]), {"order": [os.path.basename(a.photos[0])], "inliers": [], "gains": {}}
            mp = master.shape[0] * master.shape[1] / 1e6
            if mp > a.max_mp:
                s = math.sqrt(a.max_mp / mp)
                master = cv2.resize(master, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        else:
            master, info = stitch(a.photos, a.max_mp, log)
        cv2.imwrite(os.path.join(a.out, "master.jpg"), master, [cv2.IMWRITE_JPEG_QUALITY, 92])
        manifest, count = tiles(master, a.out, a.tile, a.quality)
        out = {"ok": True, **manifest, "tiles": count, "mp": round(manifest["w"] * manifest["h"] / 1e6, 1), "seconds": round(time.time() - started, 1), **info}
    except Refused as e:
        out = {"ok": False, "error": str(e)}
    with open(result_path, "w") as fh:
        json.dump(out, fh)
    print(json.dumps(out))


if __name__ == "__main__":
    main()
