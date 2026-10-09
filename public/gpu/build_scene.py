#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAREKOOCHE — A WALKABLE GAUSSIAN-SPLAT SCENE FROM ONE 360° WALK VIDEO.

Run by build-scene.sh on a rented GPU pod (RunPod, template «Runpod Pytorch 2.8.0»:
Ubuntu 24.04, Python 3.12, CUDA 12.8; 1× A40 / L40S / A100):

    curl -fsSL https://sarekooche.com/gpu/build-scene.sh | bash -s /workspace/plaza.mp4 plaza1

Stages, in order. Each one is skipped when its result is already on disk, so
running the same command again carries on where it stopped:

  1. FRAMES. ffmpeg decodes the equirectangular MP4 once; of every ~1/fps
     seconds (`--fps`, default 2) the sharpest of `--candidates` frames is kept
     (Laplacian variance on the horizon band). Windows whose best frame is
     still blurry are dropped, and so are frames where the camera stood still
     (optical flow, after taking out a pure turn, below `--still-px`).
  2. VIEWS. Every kept 360° frame is cut into a FIXED RIG of pinhole views
     (default 16: 8 around at the horizon, 4 tilted down 35°, 4 tilted up 35°;
     90° field of view, 1600×1600). The cone under the camera (the operator
     and the stick, `--nadir-mask` degrees) and over it (`--zenith-mask`) is
     masked: no features there, and no training on those pixels.
  3. COLMAP (pycolmap 4.2.1, BSD-3-Clause; GLOMAP's global mapper is part of
     COLMAP since 3.13): SIFT on the GPU, the rig written as a COLMAP
     rig_config.json and applied to the database (the views share one centre
     and their rotations are known exactly, so they are never refined),
     sequential matching in video order with loop detection (vocabulary tree)
     and rig-aware geometric verification, then the global mapper (or the
     incremental one when the global result covers less than 70% of the walk).
     When the walk comes out in pieces, the largest piece is used and the
     coverage is reported. The views are exact pinhole crops, so the sparse
     model is already a PINHOLE (undistorted) dataset.
  4. UPRIGHT AND METRIC. The world is turned so that «down» is the average
     down of the (levelled) 360° frames, the origin is the first camera
     position and +z is the first steps' walking direction; it is scaled to
     metres from the camera's height above the ground (`--camera-height`,
     default 2.0 m: held above head height). The result is y-DOWN, like a
     Splatica/COLMAP reconstruction: in the tour leave «flip upright» TICKED.
  5. SPLATS. Brush (Apache-2.0, release v0.3.0) trains headless on the pod's
     GPU through Vulkan when the pod exposes Vulkan; otherwise — or if Brush
     fails or would take too long — our own trainer on gsplat 1.5.3
     (Apache-2.0; MCMC densification, the same library and recipe as gsplat's
     simple_trainer --strategy mcmc). 30,000 steps, at most 7 million splats.
  6. RESULT in /workspace/build/<name>/:
       <name>.ply               the scene (binary little-endian 3DGS PLY, SH degree 3)
       <name>-cameras.json      the cameraman's route (cameras.json shape)
       <name>-preview.jpg       photo | splats, side by side, at 6 places
       summary.txt              frames, registration, timings, splat count, cost

`--dry-run --cpu` makes a small synthetic 360° video (a textured plaza with an
«operator» under the camera, a pause and a blurry second), and runs every
stage on the CPU: real ffmpeg, real pycolmap SfM, a mock Brush binary, and the
gsplat trainer's own loop on a tiny pure-PyTorch rasteriser. It checks the
frame selection, the masks, the rig config (read back by COLMAP's own parser),
the registration, the upright/metric alignment against the known truth, and
the PLY files.

Licences of everything this runs: COLMAP/pycolmap BSD-3-Clause, Brush
Apache-2.0, gsplat Apache-2.0, PyTorch BSD-3-Clause, OpenCV Apache-2.0, NumPy
and SciPy BSD-3-Clause, Pillow MIT-CMU, FFmpeg (Ubuntu's package, used as a
separate program). No token, password or account is ever used.
"""

import argparse
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import threading
import time
import urllib.request

import numpy as np

VERSION = "2026-10-09.1"
SITE = "https://sarekooche.com"
SH_C0 = 0.28209479177387814
SCENE_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$")

# Approximate on-demand RunPod prices (USD per GPU-hour, 2026). Only for the
# printed estimate; the RunPod bill is the truth.
GPU_PRICES = [
    ("L40S", 0.79), ("L40", 0.69), ("RTX 6000 Ada", 0.74), ("A6000", 0.49), ("A5000", 0.27),
    ("A4500", 0.25), ("4090", 0.59), ("5090", 0.89), ("3090", 0.43), ("A40", 0.49),
    ("A100", 1.59), ("H100", 1.99), ("H200", 3.59), ("B200", 5.99),
]

# COLMAP's own default vocabulary tree for SIFT loop detection (BSD; from
# src/colmap/retrieval/resources.h in COLMAP 4.2.1): url, file name, sha256.
VOCAB_URL = "https://github.com/colmap/colmap/releases/download/3.11.1/vocab_tree_faiss_flickr100K_words256K.bin"
VOCAB_NAME = "vocab_tree_faiss_flickr100K_words256K.bin"
VOCAB_SHA256 = "96ca8ec8ea60b1f73465aaf2c401fd3b3ca75cdba2d3c50d6a2f6f760f275ddc"

T0 = time.time()
TIMINGS = []
LOG_PATH = None


# ─── Talking to the founder ──────────────────────────────────────────────────

def say(msg=""):
    print(msg, flush=True)


def banner(title):
    say("")
    say("━" * 72)
    say("  " + title)
    say("━" * 72)


class Stage:
    """`with Stage("Frames"):` — prints the step and keeps its timing."""

    def __init__(self, title):
        self.title = title

    def __enter__(self):
        banner(self.title)
        self.t = time.time()
        return self

    def __exit__(self, *exc):
        dt = time.time() - self.t
        TIMINGS.append((self.title, dt))
        if exc[0] is None:
            say("  ✓ done in %s" % human_time(dt))
        return False


def human_time(s):
    s = int(round(s))
    if s < 60:
        return "%d s" % s
    if s < 3600:
        return "%d min %02d s" % (s // 60, s % 60)
    return "%d h %02d min" % (s // 3600, (s % 3600) // 60)


class Fail(Exception):
    """An error explained in plain words; printed without a traceback."""


def log_raw(text):
    """Append to the log file only (not the terminal)."""
    if not LOG_PATH:
        return
    with open(LOG_PATH, "a", encoding="utf-8", errors="replace") as f:
        f.write(text if text.endswith("\n") else text + "\n")


def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, path)


def read_json(path):
    with open(path) as f:
        return json.load(f)


def link_or_copy(src, dst):
    if os.path.exists(dst):
        return
    try:
        os.link(src, dst)
    except OSError:
        shutil.copyfile(src, dst)


def free_gb(path):
    st = os.statvfs(path)
    return st.f_bavail * st.f_frsize / 1e9


def gpu_price(name):
    return next((p for k, p in GPU_PRICES if k.lower() in (name or "").lower()), 0.79)


# ─── Running a long tool quietly (its chatter goes to the log) ───────────────

PROGRESS_RE = re.compile(r"\[(\d+)\s*/\s*(\d+)\]")


def run_quiet(cmd, what, env=None, on_line=None, heartbeat=45, timeout=None, cwd=None):
    """Run `cmd`; every line goes to the log, and every `heartbeat` seconds one
    plain line says it is still working (with «x of y» when the tool prints
    [x/y]). `on_line(line)` may return a string to print, or "STOP" to kill the
    run. Returns (exit code, seconds)."""
    t0 = time.time()
    log_raw("\n$ %s\n" % " ".join(str(c) for c in cmd))
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         env=env, cwd=cwd)
    state = {"last": None, "stop": False}

    def pump():
        f = open(LOG_PATH, "ab") if LOG_PATH else None
        try:
            for raw in p.stdout:
                if f:
                    f.write(raw)
                    f.flush()
                line = raw.decode("utf-8", "replace").rstrip()
                m = PROGRESS_RE.search(line)
                if m:
                    state["last"] = "%s of %s" % (m.group(1), m.group(2))
                if on_line:
                    r = on_line(line)
                    if r == "STOP":
                        state["stop"] = True
                    elif r:
                        say(r)
        finally:
            if f:
                f.close()

    th = threading.Thread(target=pump, daemon=True)
    th.start()
    last_beat = time.time()
    while p.poll() is None:
        time.sleep(1)
        if state["stop"] or (timeout and time.time() - t0 > timeout):
            p.kill()  # our own child, by its PID
            break
        if heartbeat and time.time() - last_beat > heartbeat:
            last_beat = time.time()
            extra = (" — %s" % state["last"]) if state["last"] else ""
            say("  … %s, %s so far%s" % (what, human_time(time.time() - t0), extra))
    p.wait()
    th.join(timeout=10)
    code = p.returncode
    if state["stop"]:
        code = -999
    return code, time.time() - t0


# ─── The video ───────────────────────────────────────────────────────────────

def probe_video(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,codec_name,avg_frame_rate,r_frame_rate,nb_frames:format=duration,size",
         "-of", "json", path], capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if out.returncode != 0:
        raise Fail("This file is not a video ffmpeg can read: %s\n  (%s)" % (path, out.stderr.strip()[:300]))
    d = json.loads(out.stdout)
    if not d.get("streams"):
        raise Fail("No video picture in %s." % path)
    s = d["streams"][0]

    def rate(x):
        try:
            a, b = x.split("/")
            return float(a) / float(b) if float(b) else 0.0
        except Exception:  # noqa: BLE001
            return 0.0

    fps = rate(s.get("avg_frame_rate", "0/1")) or rate(s.get("r_frame_rate", "0/1"))
    dur = float((d.get("format") or {}).get("duration") or 0)
    return {"width": int(s["width"]), "height": int(s["height"]), "codec": s.get("codec_name"),
            "fps": fps, "duration": dur, "size": int((d.get("format") or {}).get("size") or os.path.getsize(path))}


def equirect_band(h, lo_deg, hi_deg):
    """Rows of an equirectangular image between elevations lo..hi (degrees)."""
    r0 = int(round(h * (90 - hi_deg) / 180))
    r1 = int(round(h * (90 - lo_deg) / 180))
    return max(0, r0), min(h, r1)


def sharpness(gray_small):
    import cv2  # noqa: WPS433
    h = gray_small.shape[0]
    a, b = equirect_band(h, -50, 60)
    return float(cv2.Laplacian(gray_small[a:b], cv2.CV_64F).var())


def residual_motion(prev_small, cur_small):
    """Median optical-flow length on the horizon band after taking out a pure
    turn (a turn moves the whole equirectangular band sideways). Pixels at
    the small size (512 wide)."""
    import cv2  # noqa: WPS433
    h = prev_small.shape[0]
    a, b = equirect_band(h, -45, 45)
    p, c = prev_small[a:b], cur_small[a:b]
    flow = cv2.calcOpticalFlowFarneback(p, c, None, 0.5, 3, 15, 3, 5, 1.2, 0)
    fx = flow[..., 0] - np.median(flow[..., 0])
    fy = flow[..., 1] - np.median(flow[..., 1])
    return float(np.median(np.hypot(fx, fy)))


def extract_frames(args, video, info, fdir):
    """One decoding pass. Returns the frames.json record."""
    import cv2  # noqa: WPS433
    W, H = info["width"], info["height"]
    if abs(W - 2 * H) > 2:
        raise Fail("The video is %d×%d, not a 360° equirectangular picture (twice as wide as high).\n"
                   "  In Insta360 Studio export it as «360°» video (not reframed / not «flat»)." % (W, H))
    fps = args.fps
    if info["duration"] > 0 and info["duration"] * fps > args.max_frames:
        fps = args.max_frames / info["duration"]
        say("  (a long video: taking %.2f frames a second so it stays under %d frames)" % (fps, args.max_frames))
    cand = fps * args.candidates
    if info["fps"]:
        cand = min(cand, info["fps"])
    per_window = max(1, int(round(cand / fps)))
    # Very large panoramas are reduced once here so every later step is cheaper.
    outW = W if not args.pano_width or W <= args.pano_width else args.pano_width
    outH = outW // 2
    vf = "fps=%.6f" % cand + ("" if outW == W else ",scale=%d:%d:flags=area" % (outW, outH))
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-threads", "0", "-i", video, "-vf", vf,
           "-pix_fmt", "bgr24", "-f", "rawvideo", "-"]
    log_raw("$ " + " ".join(cmd))
    tmp = fdir + ".partial"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    say("  decoding %d×%d %s at %.1f candidate frames a second; keeping the sharpest of each %d"
        % (W, H, info["codec"], cand, per_window))
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stdin=subprocess.DEVNULL, bufsize=0)
    nbytes = outW * outH * 3
    windows = []  # (window index, t, sharpness, path, small gray)
    best = None
    idx = 0
    last = time.time()

    def flush(b):
        if b is None:
            return
        w, t, sh, img, small = b
        path = os.path.join(tmp, "w%05d.jpg" % w)
        cv2.imwrite(path, img, [cv2.IMWRITE_JPEG_QUALITY, args.frame_quality])
        windows.append({"w": w, "t": round(t, 3), "sharp": round(sh, 2), "path": path, "small": small})

    buf = bytearray(nbytes)
    view = memoryview(buf)
    while True:
        got = 0
        while got < nbytes:
            n = p.stdout.readinto(view[got:])
            if not n:
                break
            got += n
        if got < nbytes:
            break
        img = np.frombuffer(buf, np.uint8).reshape(outH, outW, 3)
        t = idx / cand
        w = idx // per_window
        small = cv2.cvtColor(cv2.resize(img, (512, 256), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
        g = cv2.cvtColor(cv2.resize(img, (2048, 1024), interpolation=cv2.INTER_AREA) if outW > 2048 else img,
                         cv2.COLOR_BGR2GRAY)
        sh = sharpness(g)
        if best is not None and best[0] != w:
            flush(best)
            best = None
        if best is None or sh > best[2]:
            best = (w, t, sh, img.copy(), small)
        idx += 1
        if time.time() - last > 15:
            last = time.time()
            say("  … read %s of %s of video, %d frames picked so far" % (
                human_time(t), human_time(info["duration"]) if info["duration"] else "?", len(windows)))
    flush(best)
    p.wait()
    if p.returncode not in (0, None) and not windows:
        raise Fail("ffmpeg could not decode the video (see the log).")
    if len(windows) < 5:
        raise Fail("Only %d frames came out of the video — is it at least 10 seconds long?" % len(windows))
    # Blurry windows: well below the typical sharpness.
    med = float(np.median([x["sharp"] for x in windows]))
    kept, blurry, still = [], [], []
    for x in windows:
        if x["sharp"] < args.blur_ratio * med:
            blurry.append(x)
            continue
        if kept:
            m = residual_motion(kept[-1]["small"], x["small"])
            x["motion"] = round(m, 3)
            if m < args.still_px:
                still.append(x)
                continue
        kept.append(x)
    for x in blurry + still:
        os.remove(x["path"])
    frames = []
    for i, x in enumerate(kept, 1):
        name = "f%05d.jpg" % i
        os.replace(x["path"], os.path.join(tmp, name))
        frames.append({"name": name, "t": x["t"], "sharp": x["sharp"], "motion": x.get("motion")})
    rec = {"version": VERSION, "video": os.path.abspath(video), "video_info": info, "fps": fps,
           "candidates_per_window": per_window, "windows": len(windows), "frames": frames,
           "dropped_blurry": [x["t"] for x in blurry], "dropped_still": [x["t"] for x in still],
           "pano_width": outW, "pano_height": outH}
    shutil.rmtree(fdir, ignore_errors=True)
    os.replace(tmp, fdir)
    write_json(os.path.join(fdir, "frames.json"), rec)
    return rec


# ─── The rig: fixed pinhole views cut from each 360° frame ───────────────────
# Panorama axes (OpenCV-like): x right, y DOWN, z forward = the centre column of
# the equirectangular picture. A view looks at yaw ψ (+ turns right) and pitch θ
# (+ looks up).

def view_rotation(yaw_deg, pitch_deg):
    """pano_from_cam (3×3): its columns are the view's right, down and forward."""
    y, p = math.radians(yaw_deg), math.radians(pitch_deg)
    f = np.array([math.sin(y) * math.cos(p), -math.sin(p), math.cos(y) * math.cos(p)])
    r = np.array([math.cos(y), 0.0, -math.sin(y)])
    d = np.cross(f, r)
    return np.stack([r, d, f], 1)


def rig_views(args):
    views = []
    for k in range(args.around):
        views.append((360.0 * k / args.around, 0.0))
    for k in range(args.down):
        views.append((360.0 * k / max(1, args.down), -args.tilt))
    for k in range(args.up):
        views.append((360.0 * (k + 0.5) / max(1, args.up), args.tilt))
    out = []
    for i, (yaw, pitch) in enumerate(views):
        out.append({"index": i, "prefix": "cam%02d/" % i, "yaw": round(yaw, 4), "pitch": pitch,
                    "pano_from_cam": view_rotation(yaw, pitch)})
    return out


def intrinsics(args):
    f = (args.view_size / 2.0) / math.tan(math.radians(args.fov) / 2)
    c = args.view_size / 2.0
    return f, c


def ray_grid(args):
    """Unit rays (H·W, 3) through pixel centres of a view, in camera axes."""
    f, c = intrinsics(args)
    s = args.view_size
    xs = (np.arange(s, dtype=np.float64) + 0.5 - c) / f
    X, Y = np.meshgrid(xs, xs)
    r = np.stack([X, Y, np.ones_like(X)], -1).reshape(-1, 3)
    return r / np.linalg.norm(r, axis=1, keepdims=True)


def pano_uv(rays_pano, pw, ph):
    """Equirectangular pixel coordinates (continuous, pixel centres at +0.5)."""
    x, y, z = rays_pano[:, 0], rays_pano[:, 1], rays_pano[:, 2]
    lon = np.arctan2(x, z)
    lat = -np.arctan2(y, np.hypot(x, z))
    u = (lon / (2 * math.pi) + 0.5) * pw
    v = (0.5 - lat / math.pi) * ph
    return u, v, lat


def rig_maps(args, views, pw, ph):
    """Per view: remap maps, the training mask (no nadir/zenith) and COLMAP's
    feature mask (also: each panorama pixel belongs to ONE view, as in
    pycolmap.panorama, so the same feature is never extracted twice)."""
    rays = ray_grid(args)
    s = args.view_size
    centres = np.stack([v["pano_from_cam"][:, 2] for v in views])  # forward of each view, pano axes
    lo = math.radians(-(90 - args.nadir_mask))
    hi = math.radians(90 - args.zenith_mask)
    out = []
    for v in views:
        rp = rays @ v["pano_from_cam"].T
        u, vv, lat = pano_uv(rp, pw, ph)
        mx = (u - 0.5).astype(np.float32).reshape(s, s)
        my = np.clip(vv - 0.5, 0, ph - 1).astype(np.float32).reshape(s, s)
        train = ((lat > lo) & (lat < hi)).reshape(s, s)
        own = (np.argmax(rp @ centres.T, 1) == v["index"]).reshape(s, s)
        out.append({"mx": mx, "my": my, "train": train, "colmap": train & own})
    return out


def write_rig_config(path, args, views):
    """COLMAP's rig_config.json (doc/rigs.rst): one rig; view 0 is the reference
    sensor; every other view's cam_from_rig is its exact rotation (w, x, y, z)
    and a zero translation (all views share the 360° camera's centre)."""
    f, c = intrinsics(args)
    R0 = views[0]["pano_from_cam"]
    cams = []
    for v in views:
        e = {"image_prefix": v["prefix"], "camera_model_name": "PINHOLE", "camera_params": [f, f, c, c]}
        if v["index"] == 0:
            e["ref_sensor"] = True
        else:
            # cam_from_rig = cam_from_pano · pano_from_ref
            R = v["pano_from_cam"].T @ R0
            e["cam_from_rig_rotation"] = [float(x) for x in rot_to_quat(R)]
            e["cam_from_rig_translation"] = [0.0, 0.0, 0.0]
        cams.append(e)
    write_json(path, [{"cameras": cams}])


def rot_to_quat(R):
    """3×3 rotation → (w, x, y, z), w ≥ 0."""
    R = np.asarray(R, np.float64)
    t = np.trace(R)
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        q = [0.25 * s, (R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s]
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = math.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2]) * 2
        q = [(R[2, 1] - R[1, 2]) / s, 0.25 * s, (R[0, 1] + R[1, 0]) / s, (R[0, 2] + R[2, 0]) / s]
    elif R[1, 1] > R[2, 2]:
        s = math.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2]) * 2
        q = [(R[0, 2] - R[2, 0]) / s, (R[0, 1] + R[1, 0]) / s, 0.25 * s, (R[1, 2] + R[2, 1]) / s]
    else:
        s = math.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1]) * 2
        q = [(R[1, 0] - R[0, 1]) / s, (R[0, 2] + R[2, 0]) / s, (R[1, 2] + R[2, 1]) / s, 0.25 * s]
    q = np.array(q)
    q /= np.linalg.norm(q)
    return q if q[0] >= 0 else -q


def quat_to_rot_np(q):
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]])


def cut_views(args, frames_rec, fdir, vdir, views):
    """images/camNN/fNNNNN.jpg for every frame and view; one mask PNG per view
    (COLMAP's per-image masks are hard links to it)."""
    import cv2  # noqa: WPS433
    from concurrent.futures import ThreadPoolExecutor  # noqa: WPS433
    pw, ph = frames_rec["pano_width"], frames_rec["pano_height"]
    # Resample the panorama once to about the views' own pixel density, so the
    # cut is not aliased (an 8K frame has ~21 px per degree, a 1600 px / 90° view ~18).
    f, _ = intrinsics(args)
    view_ppd = f * math.radians(1.0)
    pano_ppd = pw / 360.0
    scale = 1.0 if pano_ppd < 1.25 * view_ppd else (view_ppd * 1.1) / pano_ppd
    rw = int(round(pw * scale / 2)) * 2
    rh = rw // 2
    maps = rig_maps(args, views, rw, rh)
    img_dir = os.path.join(vdir, "images")
    cmask_dir = os.path.join(vdir, "colmap_masks")
    tmask_dir = os.path.join(vdir, "train_masks")
    for d in (img_dir, cmask_dir, tmask_dir):
        os.makedirs(d, exist_ok=True)
    for v, m in zip(views, maps):
        os.makedirs(os.path.join(img_dir, v["prefix"]), exist_ok=True)
        os.makedirs(os.path.join(cmask_dir, v["prefix"]), exist_ok=True)
        cv2.imwrite(os.path.join(tmask_dir, "cam%02d.png" % v["index"]), m["train"].astype(np.uint8) * 255)
        cv2.imwrite(os.path.join(tmask_dir, "cam%02d-colmap.png" % v["index"]), m["colmap"].astype(np.uint8) * 255)
    names = [fr["name"] for fr in frames_rec["frames"]]
    todo = [n for n in names if not os.path.exists(os.path.join(img_dir, views[-1]["prefix"], n))]
    say("  %d frames × %d views = %d pictures of %d×%d (%d frames already done)" % (
        len(names), len(views), len(names) * len(views), args.view_size, args.view_size, len(names) - len(todo)))
    if scale != 1.0:
        say("  (each %d×%d frame is first resampled to %d×%d, the views' own sharpness)" % (pw, ph, rw, rh))

    def one(n):
        img = cv2.imread(os.path.join(fdir, n), cv2.IMREAD_COLOR)
        if img is None:
            raise Fail("Could not read frame %s" % n)
        if img.shape[1] != rw:
            img = cv2.resize(img, (rw, rh), interpolation=cv2.INTER_AREA)
        for v, m in zip(views, maps):
            out = cv2.remap(img, m["mx"], m["my"], cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
            path = os.path.join(img_dir, v["prefix"], n)
            tmp = path + ".tmp.jpg"
            cv2.imwrite(tmp, out, [cv2.IMWRITE_JPEG_QUALITY, args.view_quality])
            os.replace(tmp, path)
        return n

    last = time.time()
    done = 0
    workers = max(1, min(8, (os.cpu_count() or 2)))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for _ in ex.map(one, todo):
            done += 1
            if time.time() - last > 15:
                last = time.time()
                say("  … %d of %d frames cut" % (done, len(todo)))
    # COLMAP masks: <mask_path>/<image name>.png, one hard link per picture.
    for v in views:
        src = os.path.join(tmask_dir, "cam%02d-colmap.png" % v["index"])
        for n in names:
            link_or_copy(src, os.path.join(cmask_dir, v["prefix"], n + ".png"))
    write_rig_config(os.path.join(vdir, "rig_config.json"), args, views)
    rec = {"version": VERSION, "views": [{k: v[k] for k in ("index", "prefix", "yaw", "pitch")} for v in views],
           "view_size": args.view_size, "fov": args.fov, "frames": names,
           "masked_share": [round(1 - float(m["train"].mean()), 3) for m in maps],
           "nadir_mask": args.nadir_mask, "zenith_mask": args.zenith_mask}
    write_json(os.path.join(vdir, "views.json"), rec)
    return rec


# ─── COLMAP (pycolmap, BSD-3-Clause) — each step in its own process ──────────

def fetch_vocab(tools_dir):
    import hashlib  # noqa: WPS433
    os.makedirs(tools_dir, exist_ok=True)
    path = os.path.join(tools_dir, VOCAB_NAME)
    if os.path.exists(path):
        return path
    tmp = path + ".part"
    try:
        with urllib.request.urlopen(urllib.request.Request(VOCAB_URL, headers={"User-Agent": "sarekooche-build"}),
                                    timeout=120) as r, open(tmp, "wb") as f:
            h = hashlib.sha256()
            while True:
                b = r.read(8 << 20)
                if not b:
                    break
                h.update(b)
                f.write(b)
        if h.hexdigest() != VOCAB_SHA256:
            raise ValueError("checksum differs")
        os.replace(tmp, path)
        return path
    except Exception as e:  # noqa: BLE001
        log_raw("vocabulary tree download failed: %s" % e)
        try:
            os.remove(tmp)
        except OSError:
            pass
        return None


def internal_step(step, payload):
    """Runs in a child process (so COLMAP's chatter and any crash stay out of
    the main run)."""
    import pycolmap  # noqa: WPS433
    pycolmap.logging.logtostderr = True
    pycolmap.logging.minloglevel = 0
    gpu = bool(payload.get("gpu"))
    dev = pycolmap.Device.cuda if gpu else pycolmap.Device.cpu
    print("pycolmap %s (CUDA %s), step %s" % (pycolmap.__version__, getattr(pycolmap, "has_cuda", "?"), step), flush=True)
    db = payload["database"]
    if step == "features":
        if os.path.exists(db):
            os.remove(db)
        reader = pycolmap.ImageReaderOptions(camera_model="PINHOLE", camera_params=payload["camera_params"],
                                             mask_path=payload["mask_path"])
        ext = pycolmap.FeatureExtractionOptions()
        ext.use_gpu = gpu
        ext.num_threads = -1
        ext.max_image_size = int(payload["max_image_size"])
        ext.sift.max_num_features = int(payload["max_features"])
        pycolmap.extract_features(db, payload["image_path"], camera_mode=pycolmap.CameraMode.PER_FOLDER,
                                  reader_options=reader, extraction_options=ext, device=dev)
        configs = pycolmap.read_rig_config(payload["rig_config"])
        with pycolmap.Database.open(db) as d:
            pycolmap.apply_rig_config(configs, d)
            try:
                print("RIGS %d FRAMES %d IMAGES %d" % (d.num_rigs(), d.num_frames(), d.num_images()), flush=True)
            except Exception:  # noqa: BLE001
                pass
    elif step == "match":
        mo = pycolmap.FeatureMatchingOptions()
        mo.use_gpu = gpu
        mo.num_threads = -1
        # Exact cam_from_rig: verify pairs with the rig's constraint, and never
        # match two views of one frame (their masks share no pixel).
        mo.rig_verification = True
        mo.skip_image_pairs_in_same_frame = True
        po = pycolmap.SequentialPairingOptions()
        po.overlap = int(payload["overlap"])
        po.quadratic_overlap = False
        po.expand_rig_images = True
        if payload.get("vocab"):
            po.loop_detection = True
            po.vocab_tree_path = payload["vocab"]
            po.loop_detection_period = int(payload.get("loop_period", 10))
            po.loop_detection_num_images = int(payload.get("loop_images", 30))
        pycolmap.match_sequential(db, matching_options=mo, pairing_options=po, device=dev)
    elif step in ("global", "incremental"):
        out = payload["output"]
        shutil.rmtree(out, ignore_errors=True)
        os.makedirs(out)
        if step == "global":
            o = pycolmap.GlobalPipelineOptions()
            o.random_seed = 0
            o.mapper.refine_sensor_from_rig = False
            o.mapper.random_seed = 0
            for sub in ("rotation_averaging", "global_positioning"):
                try:
                    setattr(getattr(o.mapper, sub), "refine_sensor_from_rig", False)
                except Exception:  # noqa: BLE001
                    pass
            o.mapper.bundle_adjustment.refine_focal_length = False
            o.mapper.bundle_adjustment.refine_principal_point = False
            o.mapper.bundle_adjustment.refine_extra_params = False
            o.mapper.bundle_adjustment.refine_sensor_from_rig = False
            try:
                o.mapper.global_positioning.use_gpu = gpu
                o.mapper.bundle_adjustment.ceres.use_gpu = gpu
            except Exception:  # noqa: BLE001
                pass
            recs = pycolmap.global_mapping(db, payload["image_path"], out, o)
        else:
            o = pycolmap.IncrementalPipelineOptions()
            o.random_seed = 0
            o.ba_refine_sensor_from_rig = False
            o.ba_refine_focal_length = False
            o.ba_refine_principal_point = False
            o.ba_refine_extra_params = False
            recs = pycolmap.incremental_mapping(db, payload["image_path"], out, o)
        models = []
        for idx, rec in recs.items():
            path = os.path.join(out, str(idx))
            os.makedirs(path, exist_ok=True)
            rec.write(path)
            models.append({"path": path, "images": rec.num_reg_images(), "frames": rec.num_reg_frames(),
                           "points": rec.num_points3D()})
        write_json(os.path.join(out, "models.json"), models)
        print("MODELS %s" % json.dumps(models), flush=True)
    else:
        raise SystemExit("unknown step " + step)


def run_step(args, step, payload, what):
    pj = os.path.join(args.sfm_dir, "step-%s.json" % step)
    write_json(pj, payload)
    env = dict(os.environ)
    env.setdefault("GLOG_logtostderr", "1")
    code, dt = run_quiet([sys.executable, "-u", os.path.abspath(__file__), "--internal", step, pj], what, env=env)
    if code != 0:
        raise Fail("COLMAP stopped while %s (exit %s). The details are at the end of the log.\n"
                   "  Run the same command again to retry this step." % (what, code))
    return dt


def run_sfm(args, vrec, vdir, sfm_dir, tools_dir):
    args.sfm_dir = sfm_dir
    os.makedirs(sfm_dir, exist_ok=True)
    db = os.path.join(sfm_dir, "database.db")
    f, c = intrinsics(args)
    image_path = os.path.join(vdir, "images")
    feat_mark = os.path.join(sfm_dir, "features.done")
    match_mark = os.path.join(sfm_dir, "matches.done")
    n_img = len(vrec["frames"]) * len(vrec["views"])
    if not os.path.exists(feat_mark):
        for m in (match_mark,):
            if os.path.exists(m):
                os.remove(m)
        say("  finding features (SIFT%s) in %d pictures…" % (" on the GPU" if args.gpu else ", on the CPU", n_img))
        run_step(args, "features", {
            "database": db, "image_path": image_path, "mask_path": os.path.join(vdir, "colmap_masks"),
            "camera_params": "%r,%r,%r,%r" % (f, f, c, c), "max_image_size": args.view_size,
            "max_features": args.sift_features, "rig_config": os.path.join(vdir, "rig_config.json"),
            "gpu": args.gpu}, "finding features")
        open(feat_mark, "w").close()
    else:
        say("  features: already found.")
    if not os.path.exists(match_mark):
        vocab = None
        if args.loops:
            vocab = fetch_vocab(tools_dir)
            if not vocab:
                say("  (could not download COLMAP's vocabulary tree: matching without loop detection)")
        say("  matching pictures in walking order (each frame with the next %d)%s…" % (
            args.overlap, ", with loop detection" if vocab else ""))
        run_step(args, "match", {"database": db, "overlap": args.overlap, "vocab": vocab, "gpu": args.gpu},
                 "matching pictures")
        open(match_mark, "w").close()
    else:
        say("  matching: already done.")

    n_frames = len(vrec["frames"])

    def best_of(out):
        mj = os.path.join(out, "models.json")
        if not os.path.exists(mj):
            return None, []
        models = read_json(mj)
        if not models:
            return None, models
        return max(models, key=lambda m: (m["frames"], m["images"])), models

    tried = []
    order = {"auto": ["global", "incremental"], "global": ["global"], "incremental": ["incremental"]}[args.mapper]
    best = None
    for mapper in order:
        out = os.path.join(sfm_dir, "sparse-" + mapper)
        b, models = best_of(out)
        if b is None:
            say("  building the 3D camera path (%s mapper)…" % ("global, GLOMAP" if mapper == "global" else "incremental"))
            try:
                run_step(args, mapper, {"database": db, "image_path": image_path, "output": out, "gpu": args.gpu},
                         "building the camera path")
            except Fail as e:
                say("  ✗ the %s mapper failed: %s" % (mapper, str(e).splitlines()[0]))
                tried.append({"mapper": mapper, "failed": True})
                continue
            b, models = best_of(out)
        else:
            say("  %s mapper: already done." % mapper)
        if b is None:
            tried.append({"mapper": mapper, "models": 0})
            continue
        cov = b["frames"] / max(1, n_frames)
        tried.append({"mapper": mapper, "models": len(models), "best": b, "coverage": round(cov, 3)})
        say("  %s mapper: %d piece%s; the largest holds %d of %d frames (%.0f%%), %d pictures, %s points" % (
            mapper, len(models), "" if len(models) == 1 else "s", b["frames"], n_frames, 100 * cov,
            b["images"], f"{b['points']:,}"))
        if best is None or b["frames"] > best[1]["frames"]:
            best = (mapper, b)
        if cov >= args.min_coverage:
            break
        if mapper != order[-1]:
            say("  that covers less than %.0f%% of the walk: trying the other mapper too." % (100 * args.min_coverage))
    if best is None:
        raise Fail("COLMAP could not work out where the camera was. Usually: too little texture, too fast\n"
                   "  a walk, or a video that is not a clean 360° equirectangular export. See the log.")
    mapper, b = best
    rec = {"version": VERSION, "mapper": mapper, "model": b["path"], "frames_registered": b["frames"],
           "frames_total": n_frames, "images_registered": b["images"], "images_total": n_img,
           "points": b["points"], "tried": tried}
    write_json(os.path.join(sfm_dir, "sfm.json"), rec)
    return rec


# ─── COLMAP binary model files (read and write) ──────────────────────────────

def write_colmap_bin(sparse_dir, cam, images, points, colors):
    """cam = (width, height, fx, fy, cx, cy) as one PINHOLE camera (id 1).
    images = [(image_id, name, R_cw 3×3, t_cw 3)], points (N,3), colors (N,3) uint8."""
    os.makedirs(sparse_dir, exist_ok=True)
    w, h, fx, fy, cx, cy = cam
    with open(os.path.join(sparse_dir, "cameras.bin"), "wb") as f:
        f.write(struct.pack("<Q", 1))
        f.write(struct.pack("<iiQQ", 1, 1, int(w), int(h)))  # model 1 = PINHOLE
        f.write(struct.pack("<4d", fx, fy, cx, cy))
    with open(os.path.join(sparse_dir, "images.bin"), "wb") as f:
        f.write(struct.pack("<Q", len(images)))
        for iid, name, R, t in images:
            q = rot_to_quat(R)
            f.write(struct.pack("<i4d3di", iid, *q, *[float(x) for x in t], 1))
            f.write(name.encode() + b"\x00")
            f.write(struct.pack("<Q", 0))
    with open(os.path.join(sparse_dir, "points3D.bin"), "wb") as f:
        n = len(points)
        f.write(struct.pack("<Q", n))
        rec = np.zeros(n, dtype=np.dtype([("id", "<u8"), ("xyz", "<f8", 3), ("rgb", "u1", 3), ("err", "<f8"),
                                          ("tl", "<u8")]))
        rec["id"] = np.arange(1, n + 1)
        rec["xyz"] = points
        rec["rgb"] = colors
        rec["err"] = 1.0
        rec["tl"] = 0
        f.write(rec.tobytes())


def read_colmap_bin(sparse_dir):
    """Reads what write_colmap_bin writes (and plain COLMAP models with one
    PINHOLE/SIMPLE_PINHOLE camera). → cam dict, images list, points, colors."""
    cams = {}
    with open(os.path.join(sparse_dir, "cameras.bin"), "rb") as f:
        (n,) = struct.unpack("<Q", f.read(8))
        for _ in range(n):
            cid, model, w, h = struct.unpack("<iiQQ", f.read(24))
            npar = {0: 3, 1: 4}.get(model)
            if npar is None:
                raise Fail("Unexpected camera model %d in %s" % (model, sparse_dir))
            p = struct.unpack("<%dd" % npar, f.read(8 * npar))
            fx, fy, cx, cy = (p[0], p[0], p[1], p[2]) if model == 0 else p
            cams[cid] = {"w": w, "h": h, "fx": fx, "fy": fy, "cx": cx, "cy": cy}
    images = []
    with open(os.path.join(sparse_dir, "images.bin"), "rb") as f:
        (n,) = struct.unpack("<Q", f.read(8))
        for _ in range(n):
            iid, qw, qx, qy, qz, tx, ty, tz, cid = struct.unpack("<i4d3di", f.read(64))
            name = b""
            while True:
                ch = f.read(1)
                if ch == b"\x00" or not ch:
                    break
                name += ch
            (np2,) = struct.unpack("<Q", f.read(8))
            f.seek(24 * np2, 1)
            images.append({"id": iid, "name": name.decode(), "R": quat_to_rot_np((qw, qx, qy, qz)),
                           "t": np.array([tx, ty, tz]), "cam": cid})
    pts, cols = [], []
    with open(os.path.join(sparse_dir, "points3D.bin"), "rb") as f:
        (n,) = struct.unpack("<Q", f.read(8))
        for _ in range(n):
            _pid, x, y, z, r, g, b, _err, tl = struct.unpack("<Q3d3BdQ", f.read(51))
            f.seek(8 * tl, 1)
            pts.append((x, y, z))
            cols.append((r, g, b))
    return cams, images, np.array(pts, np.float64).reshape(-1, 3), np.array(cols, np.uint8).reshape(-1, 3)


# ─── Upright, metric, and the training dataset ───────────────────────────────

def estimate_ground(C, P):
    """Camera height above the ground, in the model's units (y is down).
    Points seen 20–70° below the horizon from their nearest camera are mostly
    ground; the most common drop below that camera is the ground."""
    if len(P) < 50 or len(C) < 2:
        return None, "too few points"
    rng = np.random.default_rng(0)
    if len(P) > 300_000:
        P = P[rng.choice(len(P), 300_000, replace=False)]
    hs = []
    Cxz = C[:, [0, 2]]
    for a in range(0, len(P), 20_000):
        p = P[a:a + 20_000]
        d = np.linalg.norm(p[:, None, [0, 2]] - Cxz[None], axis=2)
        j = np.argmin(d, 1)
        dh = d[np.arange(len(p)), j]
        h = p[:, 1] - C[j, 1]
        ang = np.degrees(np.arctan2(h, dh))
        ok = (h > 0) & (ang > 20) & (ang < 70)
        hs.append(h[ok])
    h = np.concatenate(hs) if hs else np.zeros(0)
    if len(h) < 100:
        return None, "only %d ground-like points" % len(h)
    top = np.quantile(h, 0.95)
    hist, edges = np.histogram(h, bins=60, range=(0, top))
    k = np.convolve(hist, [1, 2, 3, 2, 1], "same")
    peak = 0.5 * (edges[np.argmax(k)] + edges[np.argmax(k) + 1])
    near = h[np.abs(h - peak) < 0.15 * peak]
    if len(near) < 0.12 * len(h) or len(near) < 50:
        return None, "no clear ground (peak holds %d of %d points)" % (len(near), len(h))
    return float(np.median(near)), "%d of %d points" % (len(near), len(h))


def build_dataset(args, vrec, srec, vdir, ddir, frames_rec):
    import pycolmap  # noqa: WPS433
    rec = pycolmap.Reconstruction(srec["model"])
    views = {v["prefix"]: v for v in vrec["views"]}
    pfc = {v["prefix"]: view_rotation(v["yaw"], v["pitch"]) for v in vrec["views"]}
    times = {fr["name"]: fr["t"] for fr in frames_rec["frames"]}
    per_frame = {}
    imgs = []
    for im in rec.images.values():
        if not im.has_pose:
            continue
        prefix, frame = im.name.split("/", 1)
        prefix += "/"
        M = np.asarray(im.cam_from_world().matrix(), np.float64)
        R, t = M[:, :3], M[:, 3]
        C = -R.T @ t
        imgs.append((frame, views[prefix]["index"], im.name, R, C))
        if frame not in per_frame:
            # pano_from_world = pano_from_cam · cam_from_world
            per_frame[frame] = {"C": C, "R_pw": pfc[prefix] @ R}
    if len(per_frame) < 3:
        raise Fail("Too few frames were placed in 3D (%d)." % len(per_frame))
    order = sorted(per_frame)
    C = np.stack([per_frame[k]["C"] for k in order])
    down = np.mean([per_frame[k]["R_pw"][1, :] for k in order], 0)
    down /= np.linalg.norm(down)
    tilt = [math.degrees(math.acos(np.clip(per_frame[k]["R_pw"][1, :] @ down, -1, 1))) for k in order]
    # forward: the first steps' walking direction, flattened
    C0 = C[0]
    path = np.cumsum(np.r_[0, np.linalg.norm(np.diff(C, axis=0), axis=1)])
    j = int(np.searchsorted(path, 0.08 * path[-1])) if path[-1] > 0 else 0
    j = min(max(j, 1), len(C) - 1)
    fwd = C[j] - C0
    fwd -= (fwd @ down) * down
    how = "first steps"
    if np.linalg.norm(fwd) < 1e-9:
        fwd = per_frame[order[0]]["R_pw"][2, :]
        fwd -= (fwd @ down) * down
        how = "camera front"
    fwd /= np.linalg.norm(fwd)
    right = np.cross(down, fwd)
    Rn = np.stack([right, down, fwd])  # rows: new x, y, z in old coordinates
    pts = np.array([p.xyz for p in rec.points3D.values()], np.float64).reshape(-1, 3)
    cols = np.array([p.color for p in rec.points3D.values()], np.uint8).reshape(-1, 3)
    Pn = (pts - C0) @ Rn.T
    Cn = (C - C0) @ Rn.T
    gh, why = estimate_ground(Cn, Pn)
    dts = np.diff([times.get(k, 0.0) for k in order])
    steps = np.linalg.norm(np.diff(Cn, axis=0), axis=1)
    okdt = dts > 0
    raw_speed = float(np.median(steps[okdt] / dts[okdt])) if okdt.any() else 0.0
    method = None
    if gh:
        s = args.camera_height / gh
        speed = raw_speed * s
        if 0.25 <= speed <= 3.0 or raw_speed == 0:
            method = "camera height %.2f m above the ground (%s)" % (args.camera_height, why)
        else:
            say("  ! the ground estimate gives a walking speed of %.2f m/s — not believable; using the pace instead" % speed)
    if method is None:
        if raw_speed > 0:
            s = args.walk_speed / raw_speed
            method = "walking pace %.1f m/s (no clear ground: %s)" % (args.walk_speed, why)
        else:
            s = 1.0
            method = "unscaled (no ground and no timing)"
    Pn *= s
    Cn *= s
    speed = raw_speed * s
    say("  upright: down = the frames' average down (frames tilt %.1f° on average); forward = the %s" % (
        float(np.mean(tilt)), how))
    say("  scale: %s → walking speed %.2f m/s, walk length %.0f m" % (method, speed, path[-1] * s))
    # Drop wild points (far beyond the walk) so they do not seed splats in the sky.
    ext = np.max(np.linalg.norm(Cn - Cn.mean(0), axis=1)) + 1.0
    keep = np.linalg.norm(Pn - Cn.mean(0), axis=1) < max(60.0, 6 * ext)
    Pn, cols = Pn[keep], cols[keep]
    if len(Pn) > args.init_points:
        sel = np.random.default_rng(0).choice(len(Pn), args.init_points, replace=False)
        Pn, cols = Pn[sel], cols[sel]
    # The dataset: flat names (Brush looks masks up by file stem) and hard links.
    shutil.rmtree(ddir, ignore_errors=True)
    img_out = os.path.join(ddir, "images")
    msk_out = os.path.join(ddir, "masks")
    os.makedirs(img_out)
    os.makedirs(msk_out)
    fpx, cpx = intrinsics(args)
    masked = {v["index"]: share > 0.0005 for v, share in zip(vrec["views"], vrec["masked_share"])}
    entries = []
    for i, (frame, vi, name, R, Cw) in enumerate(sorted(imgs, key=lambda x: (x[0], x[1])), 1):
        stem = "%s_c%02d" % (os.path.splitext(frame)[0], vi)
        link_or_copy(os.path.join(vdir, "images", name), os.path.join(img_out, stem + ".jpg"))
        if masked[vi]:
            link_or_copy(os.path.join(vdir, "train_masks", "cam%02d.png" % vi), os.path.join(msk_out, stem + ".png"))
        Rn_cw = R @ Rn.T
        Cn_w = s * (Rn @ (Cw - C0))
        entries.append((i, stem + ".jpg", Rn_cw, -Rn_cw @ Cn_w))
    write_colmap_bin(os.path.join(ddir, "sparse", "0"), (args.view_size, args.view_size, fpx, fpx, cpx, cpx),
                     entries, Pn, cols)
    route = []
    for k, c in zip(order, Cn):
        Rpw = per_frame[k]["R_pw"] @ Rn.T  # pano_from_new-world
        route.append({"img_name": os.path.splitext(k)[0], "position": [round(float(x), 4) for x in c],
                      "rotation": [[round(float(x), 6) for x in row] for row in Rpw.T],
                      "t": times.get(k)})
    drec = {"version": VERSION, "images": len(entries), "frames": len(order), "points": int(len(Pn)),
            "scale": s, "scale_method": method, "walking_speed": speed, "walk_length_m": float(path[-1] * s),
            "mean_tilt_deg": float(np.mean(tilt)), "forward_from": how, "camera_height": args.camera_height,
            "R_new_from_old": Rn.tolist(), "origin_old": C0.tolist(), "y_down": True, "route": route}
    write_json(os.path.join(ddir, "dataset.json"), drec)
    return drec


# ─── PLY (3DGS, binary little-endian) ────────────────────────────────────────

PLY_TYPES = {"char": "i1", "uchar": "u1", "short": "i2", "ushort": "u2", "int": "i4", "uint": "u4",
             "float": "f4", "double": "f8", "int8": "i1", "uint8": "u1", "int16": "i2", "uint16": "u2",
             "int32": "i4", "uint32": "u4", "float32": "f4", "float64": "f8"}


def read_splat_ply(path):
    """Any 3DGS PLY (properties in any order) → dict of float32 arrays."""
    with open(path, "rb") as f:
        header = b""
        while not header.endswith(b"end_header\n"):
            line = f.readline()
            if not line:
                raise Fail("%s is not a PLY file." % path)
            header += line
        off = f.tell()
    lines = header.decode("latin-1").splitlines()
    fmt, count, props, in_vertex = None, 0, [], False
    for ln in lines:
        p = ln.split()
        if not p:
            continue
        if p[0] == "format":
            fmt = p[1]
        elif p[0] == "element":
            in_vertex = p[1] == "vertex"
            if in_vertex:
                count = int(p[2])
        elif p[0] == "property" and in_vertex:
            props.append((p[2], "<" + PLY_TYPES[p[1]]))
    if fmt != "binary_little_endian":
        raise Fail("%s: expected a binary little-endian PLY." % path)
    raw = np.fromfile(path, dtype=np.dtype(props), count=count, offset=off)
    names = raw.dtype.names
    n_rest = 0
    while "f_rest_%d" % n_rest in names:
        n_rest += 1
    k = n_rest // 3
    g = lambda *ks: np.stack([raw[x].astype(np.float32) for x in ks], 1)  # noqa: E731
    out = {"means": g("x", "y", "z"), "sh0": g("f_dc_0", "f_dc_1", "f_dc_2"),
           "opacity": raw["opacity"].astype(np.float32), "scales": g("scale_0", "scale_1", "scale_2"),
           "quats": g("rot_0", "rot_1", "rot_2", "rot_3")}
    if k:
        out["shN"] = g(*["f_rest_%d" % i for i in range(n_rest)]).reshape(-1, 3, k).transpose(0, 2, 1).copy()
    else:
        out["shN"] = np.zeros((count, 0, 3), np.float32)
    return out


def write_splat_ply(path, s, comments=()):
    """The INRIA 3DGS layout: x y z, f_dc_0..2, f_rest_0..(3K-1) (channel-major),
    opacity (logit), scale_0..2 (log), rot_0..3 (w x y z)."""
    n = s["means"].shape[0]
    k = s["shN"].shape[1]
    fields = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2"] + ["f_rest_%d" % i for i in range(3 * k)] + \
        ["opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]
    q = s["quats"] / np.linalg.norm(s["quats"], axis=1, keepdims=True).clip(1e-12)
    cols = [s["means"], s["sh0"], s["shN"].transpose(0, 2, 1).reshape(n, 3 * k), s["opacity"][:, None],
            s["scales"], q]
    data = np.ascontiguousarray(np.concatenate([c.astype(np.float32).reshape(n, -1) for c in cols], 1))
    head = ["ply", "format binary_little_endian 1.0"] + ["comment " + c for c in comments] + \
        ["element vertex %d" % n] + ["property float %s" % x for x in fields] + ["end_header"]
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(("\n".join(head) + "\n").encode())
        f.write(data.tobytes())
    os.replace(tmp, path)


def tidy_splats(s, cap):
    """Drop broken splats; keep at most `cap`, the ones that matter most
    (opacity × projected size)."""
    ok = np.isfinite(s["means"]).all(1) & np.isfinite(s["scales"]).all(1) & np.isfinite(s["opacity"]) & \
        np.isfinite(s["sh0"]).all(1) & np.isfinite(s["quats"]).all(1) & (np.abs(s["quats"]).sum(1) > 0)
    ok &= np.isfinite(s["shN"].reshape(len(ok), -1)).all(1)
    s = {k: v[ok] for k, v in s.items()}
    dropped = int((~ok).sum())
    n = s["means"].shape[0]
    if n > cap:
        a = 1 / (1 + np.exp(-s["opacity"]))
        imp = a * np.exp(np.sort(s["scales"], 1)[:, 1:].sum(1))
        keep = np.sort(np.argpartition(-imp, cap - 1)[:cap])
        s = {k: v[keep] for k, v in s.items()}
    return s, dropped, n


# ─── Training: Brush (Vulkan) ────────────────────────────────────────────────

def brush_usable(args):
    if args.dry_run:
        return True, "dry run (%s)" % ("mock Brush" if args.brush_bin.endswith("mock-brush") else args.brush_bin)
    if not args.brush_bin or not os.path.exists(args.brush_bin):
        return False, "the Brush program could not be downloaded"
    try:
        out = subprocess.run(["vulkaninfo", "--summary"], capture_output=True, text=True, timeout=60,
                             stdin=subprocess.DEVNULL)
        txt = out.stdout + out.stderr
        log_raw(txt)
    except Exception as e:  # noqa: BLE001
        return False, "Vulkan cannot be checked (%s)" % e
    if "NVIDIA" not in txt.upper() or "deviceName" not in txt:
        return False, "this pod gives programs no Vulkan access to the GPU"
    return True, "Vulkan sees the NVIDIA GPU"


def brush_cmd(args, ddir, out_dir, steps, name, extra=()):
    return [args.brush_bin, ddir, "--total-steps", str(steps), "--max-splats", str(args.max_splats),
            "--max-resolution", str(args.view_size), "--sh-degree", "3", "--export-every", str(steps),
            "--export-path", out_dir, "--export-name", name, "--eval-every", str(10 * steps), "--seed", "42",
            *extra]


def train_brush(args, ddir, tdir):
    out_dir = os.path.join(tdir, "brush")
    final = os.path.join(out_dir, "brush_final.ply")
    if os.path.exists(final):
        say("  already trained.")
        return final
    os.makedirs(out_dir, exist_ok=True)
    # Brush's own progress lines (brush_cli, brush_process, brush_dataset); the
    # GPU libraries' chatter only when it is a warning.
    env = dict(os.environ, NO_COLOR="1",
               RUST_LOG="warn,brush_cli=info,brush_process=info,brush_dataset=info,wgpu_hal=error")
    # A short test first: does Brush start on this GPU at all?
    smoke = os.path.join(out_dir, "smoke")
    shutil.rmtree(smoke, ignore_errors=True)
    os.makedirs(smoke)
    say("  a 30-step test run first…")
    code, dt = run_quiet(brush_cmd(args, ddir, smoke, 30, "smoke.ply", ("--max-frames", "16")), "Brush test",
                         env=env, timeout=900)
    if code != 0 or not os.path.exists(os.path.join(smoke, "smoke.ply")):
        raise Fail("Brush did not run on this pod (exit %s)." % code)
    say("  ✓ Brush runs on this GPU (%s)" % human_time(dt))
    steps = args.steps
    t0 = time.time()
    st = {"iter": 0, "splats": 0, "last": 0.0}
    check_after = args.brush_check_minutes * 60

    def on_line(line):
        m = re.search(r"Refine iter (\d+), (\d+) splats", line)
        if m:
            st["iter"], st["splats"] = int(m.group(1)), int(m.group(2))
        if re.search(r"(panicked|ERROR|❌)", line):
            return "  Brush: " + line.strip()[:200]
        el = time.time() - t0
        if st["iter"] and el > check_after:
            eta = el / st["iter"] * (steps - st["iter"])
            if (el + eta) / 3600 > args.max_train_hours:
                say("  ! Brush would need about %s in all — more than %.1f h. Stopping it." % (
                    human_time(el + eta), args.max_train_hours))
                return "STOP"
        if st["iter"] and time.time() - st["last"] > 60:
            st["last"] = time.time()
            eta = el / st["iter"] * (steps - st["iter"])
            return "  training: step %s of %s · %s splats · about %s left" % (
                f"{st['iter']:,}", f"{steps:,}", f"{st['splats']:,}", human_time(eta))
        return None

    say("  training %s steps, at most %s splats (Brush)…" % (f"{steps:,}", f"{args.max_splats:,}"))
    code, dt = run_quiet(brush_cmd(args, ddir, out_dir, steps, "brush_{iter}.ply"), "training (Brush)", env=env,
                         on_line=on_line, heartbeat=300)
    got = os.path.join(out_dir, "brush_%d.ply" % steps)
    if code != 0 or not os.path.exists(got):
        raise Fail("Brush stopped before the end (exit %s)." % code)
    os.replace(got, final)
    write_json(os.path.join(out_dir, "train.json"), {"trainer": "Brush %s" % args.brush_version, "steps": steps,
                                                     "seconds": dt})
    return final


# ─── Training: gsplat (CUDA) — our trainer, gsplat's MCMC recipe ─────────────

def torch_mod():
    import torch  # noqa: WPS433
    return torch


def quat_to_rot_t(q):
    torch = torch_mod()
    q = q / q.norm(dim=-1, keepdim=True).clamp_min(1e-12)
    w, x, y, z = q.unbind(-1)
    return torch.stack([
        1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
        2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
        2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)], -1).reshape(-1, 3, 3)


def torch_rasterize(means, quats, scales, opac, colors, w2c, K, W, H, deg):
    """Reference EWA splatting in plain PyTorch, differentiable (the CPU dry run
    only; degree-0 colour). Returns (H, W, 3)."""
    torch = torch_mod()
    dev = means.device
    R, t = w2c[:3, :3], w2c[:3, 3]
    pc = means @ R.T + t
    keep = pc[:, 2] > 0.05
    pc, quats, scales, opac, colors = pc[keep], quats[keep], scales[keep], opac[keep], colors[keep]
    if pc.shape[0] == 0:
        return torch.zeros(H, W, 3, device=dev)
    M = quat_to_rot_t(quats) * scales[:, None, :]
    cov = R @ (M @ M.transpose(1, 2)) @ R.T
    fx, fy, cx, cy = K[0, 0], K[1, 1], K[0, 2], K[1, 2]
    x, y, z = pc.unbind(-1)
    zero = torch.zeros_like(z)
    J = torch.stack([torch.stack([fx / z, zero, -fx * x / (z * z)], -1),
                     torch.stack([zero, fy / z, -fy * y / (z * z)], -1)], 1)
    c2 = J @ cov @ J.transpose(1, 2) + 0.3 * torch.eye(2, device=dev)
    det = c2[:, 0, 0] * c2[:, 1, 1] - c2[:, 0, 1] ** 2
    ca, cb, cc = c2[:, 1, 1] / det, -c2[:, 0, 1] / det, c2[:, 0, 0] / det
    u, v = fx * x / z + cx, fy * y / z + cy
    col = (SH_C0 * colors[:, 0, :] + 0.5).clamp_min(0)
    order = torch.argsort(z)
    u, v, ca, cb, cc, op, col = (a[order] for a in (u, v, ca, cb, cc, opac, col))
    ys, xs = torch.meshgrid(torch.arange(H, device=dev) + 0.5, torch.arange(W, device=dev) + 0.5, indexing="ij")
    px, py = xs.reshape(-1, 1), ys.reshape(-1, 1)
    out = []
    for a in range(0, px.shape[0], 2048):
        dx, dy = px[a:a + 2048] - u, py[a:a + 2048] - v
        power = -0.5 * (ca * dx * dx + 2 * cb * dx * dy + cc * dy * dy)
        al = (op * torch.exp(power.clamp_max(0))).clamp_max(0.99)
        al = torch.where(al < 1.0 / 255, torch.zeros_like(al), al)
        T = torch.cumprod(torch.cat([torch.ones_like(al[:, :1]), 1 - al[:, :-1]], 1), 1)
        out.append((al * T) @ col)
    return torch.cat(out).reshape(H, W, 3)


def ssim_masked(a, b, m):
    """SSIM (11×11 Gaussian window) of (H,W,3) images, averaged over mask m (H,W)."""
    torch = torch_mod()
    F = torch.nn.functional
    g = torch.exp(-((torch.arange(11, device=a.device) - 5.0) ** 2) / (2 * 1.5 ** 2))
    g = (g / g.sum())
    win = (g[:, None] @ g[None, :]).expand(3, 1, 11, 11).contiguous()
    x, y = a.permute(2, 0, 1)[None], b.permute(2, 0, 1)[None]
    mu_x, mu_y = F.conv2d(x, win, padding=5, groups=3), F.conv2d(y, win, padding=5, groups=3)
    sxx = F.conv2d(x * x, win, padding=5, groups=3) - mu_x ** 2
    syy = F.conv2d(y * y, win, padding=5, groups=3) - mu_y ** 2
    sxy = F.conv2d(x * y, win, padding=5, groups=3) - mu_x * mu_y
    C1, C2 = 0.01 ** 2, 0.03 ** 2
    s = ((2 * mu_x * mu_y + C1) * (2 * sxy + C2)) / ((mu_x ** 2 + mu_y ** 2 + C1) * (sxx + syy + C2))
    s = s.mean(1)[0]
    return (s * m).sum() / m.sum().clamp_min(1)


class Views:
    """The dataset's pictures, for training (a torch Dataset)."""

    def __init__(self, ddir, size):
        cams, images, pts, cols = read_colmap_bin(os.path.join(ddir, "sparse", "0"))
        cam = cams[1]
        self.size = size
        k = size / cam["w"]
        self.K = np.array([[cam["fx"] * k, 0, cam["cx"] * k], [0, cam["fy"] * k, cam["cy"] * k], [0, 0, 1]],
                          np.float32)
        self.items = []
        for im in images:
            stem = os.path.splitext(im["name"])[0]
            mp = os.path.join(ddir, "masks", stem + ".png")
            w2c = np.eye(4, dtype=np.float32)
            w2c[:3, :3], w2c[:3, 3] = im["R"], im["t"]
            self.items.append((os.path.join(ddir, "images", im["name"]), mp if os.path.exists(mp) else None, w2c))
        self.points, self.colors = pts, cols
        self.centres = np.stack([-it[2][:3, :3].T @ it[2][:3, 3] for it in self.items])

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        import cv2  # noqa: WPS433
        path, mp, w2c = self.items[i]
        img = cv2.cvtColor(cv2.imread(path, cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
        if img.shape[0] != self.size:
            img = cv2.resize(img, (self.size, self.size), interpolation=cv2.INTER_AREA)
        if mp:
            m = cv2.imread(mp, cv2.IMREAD_GRAYSCALE)
            if m.shape[0] != self.size:
                m = cv2.resize(m, (self.size, self.size), interpolation=cv2.INTER_NEAREST)
        else:
            m = np.full(img.shape[:2], 255, np.uint8)
        return img, m, w2c, i


def init_splats(V, args, device):
    """From COLMAP's points: colour, size from the 3 nearest neighbours, half
    opaque (gsplat's MCMC defaults: init_opa 0.5, init_scale 0.1)."""
    torch = torch_mod()
    pts = V.points.astype(np.float32)
    cols = V.colors.astype(np.float32) / 255.0
    if len(pts) < 1000:
        # Too few points: add random ones around the cameras.
        rng = np.random.default_rng(0)
        c = V.centres
        ext = max(1.0, float(np.max(np.linalg.norm(c - c.mean(0), axis=1))))
        extra = (c.mean(0) + rng.uniform(-1, 1, (5000, 3)) * ext * 1.5).astype(np.float32)
        pts = np.concatenate([pts, extra])
        cols = np.concatenate([cols, np.full((5000, 3), 0.5, np.float32)])
    try:
        from scipy.spatial import cKDTree  # noqa: WPS433
        d, _ = cKDTree(pts).query(pts, k=4)
        dist = np.sqrt((d[:, 1:] ** 2).mean(1))
    except Exception:  # noqa: BLE001
        dist = np.full(len(pts), 0.05, np.float32)
    dist = np.clip(dist, 1e-4, None)
    n = len(pts)
    shK = (args.sh_degree + 1) ** 2 - 1
    g = torch.Generator().manual_seed(0)
    params = {
        "means": torch.from_numpy(pts),
        "scales": torch.log(torch.from_numpy(dist * args.init_scale).float())[:, None].repeat(1, 3),
        "quats": torch.nn.functional.normalize(torch.randn(n, 4, generator=g), dim=1),
        "opacities": torch.logit(torch.full((n,), args.init_opacity)),
        "sh0": torch.from_numpy((cols - 0.5) / SH_C0)[:, None, :].float(),
        "shN": torch.zeros(n, shK, 3),
    }
    return torch.nn.ParameterDict({k: torch.nn.Parameter(v.to(device)) for k, v in params.items()})


def make_optimizers(params, scene_scale, args):
    torch = torch_mod()
    lrs = {"means": 1.6e-4 * scene_scale, "scales": 5e-3, "quats": 1e-3, "opacities": 5e-2,
           "sh0": 2.5e-3, "shN": 2.5e-3 / 20}
    return {k: torch.optim.Adam([{"params": params[k], "lr": lrs[k], "name": k}], eps=1e-15) for k in lrs}


def train_gsplat(args, ddir, tdir, device):
    torch = torch_mod()
    out_dir = os.path.join(tdir, "gsplat")
    final = os.path.join(out_dir, "gsplat_final.ply")
    if os.path.exists(final):
        say("  already trained.")
        return final
    os.makedirs(out_dir, exist_ok=True)
    cpu = device.type == "cpu"
    size = args.train_size or args.view_size
    V = Views(ddir, size)
    centre = V.centres.mean(0)
    scene_scale = 1.1 * float(np.max(np.linalg.norm(V.centres - centre, axis=1)))
    scene_scale = max(scene_scale, 1.0)
    steps = args.steps
    ckpt = os.path.join(out_dir, "checkpoint.pt")
    if cpu:
        strategy, rasterize = None, None
    else:
        from gsplat import rasterization  # noqa: WPS433
        from gsplat.strategy import MCMCStrategy  # noqa: WPS433
        rasterize = rasterization
        strategy = MCMCStrategy(cap_max=args.max_splats, refine_start_iter=500,
                                refine_stop_iter=min(25_000, int(0.85 * steps)), refine_every=100,
                                noise_lr=5e5, min_opacity=0.005)
    start = 0
    if os.path.exists(ckpt):
        ck = torch.load(ckpt, map_location=device, weights_only=False)
        params = torch.nn.ParameterDict({k: torch.nn.Parameter(v.to(device)) for k, v in ck["params"].items()})
        opts = make_optimizers(params, scene_scale, args)
        for k, o in opts.items():
            o.load_state_dict(ck["opt"][k])
        start = int(ck["step"])
        say("  carrying on from step %s (checkpoint)" % f"{start:,}")
    else:
        params = init_splats(V, args, device)
        opts = make_optimizers(params, scene_scale, args)
    sched = torch.optim.lr_scheduler.ExponentialLR(opts["means"], gamma=0.01 ** (1.0 / steps))
    for _ in range(start):
        sched.step()
    state = strategy.initialize_state() if strategy else None
    if strategy:
        strategy.check_sanity(params, opts)
    loader = torch.utils.data.DataLoader(V, batch_size=None, shuffle=True, num_workers=0 if cpu else min(8, os.cpu_count() or 2),
                                         persistent_workers=not cpu, generator=torch.Generator().manual_seed(start))
    K = torch.from_numpy(V.K).to(device)
    say("  training %s steps on %d pictures at %d×%d, at most %s splats (gsplat, MCMC)…" % (
        f"{steps:,}", len(V), size, size, f"{args.max_splats:,}"))
    t0 = time.time()
    last = time.time()
    step = start
    losses = []
    it = iter(loader)
    while step < steps:
        try:
            img, m, w2c, _ = next(it)
        except StopIteration:
            it = iter(loader)
            continue
        gt = torch.as_tensor(img, device=device).float() / 255.0
        mask = (torch.as_tensor(m, device=device).float() / 255.0)
        viewmat = torch.as_tensor(w2c, device=device)
        deg = min(step // 1000, args.sh_degree)
        colors = torch.cat([params["sh0"], params["shN"]], 1)
        if rasterize:
            out, _, info = rasterize(params["means"], params["quats"], torch.exp(params["scales"]),
                                     torch.sigmoid(params["opacities"]), colors, viewmat[None], K[None],
                                     size, size, sh_degree=deg, packed=False, near_plane=0.01,
                                     rasterize_mode="classic")
            render = out[0]
        else:
            info = {}
            render = torch_rasterize(params["means"], params["quats"], torch.exp(params["scales"]),
                                     torch.sigmoid(params["opacities"]), colors, viewmat, K, size, size, 0)
        l1 = ((render - gt).abs().mean(-1) * mask).sum() / mask.sum().clamp_min(1)
        ssim = ssim_masked(render, gt, mask)
        loss = 0.8 * l1 + 0.2 * (1 - ssim)
        loss = loss + 0.01 * torch.sigmoid(params["opacities"]).mean() + 0.01 * torch.exp(params["scales"]).mean()
        if step < start + 20 or step >= steps - 20:  # (.item() waits for the GPU: not every step)
            losses.append(loss.item())
        loss.backward()
        for o in opts.values():
            o.step()
            o.zero_grad(set_to_none=True)
        sched.step()
        if strategy:
            strategy.step_post_backward(params, opts, state, step, info, lr=sched.get_last_lr()[0])
        step += 1
        if time.time() - last > 60 or step == steps:
            last = time.time()
            el = time.time() - t0
            eta = el / max(1, step - start) * (steps - step)
            say("  training: step %s of %s · %s splats · loss %.4f · about %s left" % (
                f"{step:,}", f"{steps:,}", f"{params['means'].shape[0]:,}", loss.item(), human_time(eta)))
        if step % 5000 == 0 and step < steps:
            torch.save({"step": step, "params": {k: v.detach() for k, v in params.items()},
                        "opt": {k: o.state_dict() for k, o in opts.items()}}, ckpt + ".tmp")
            os.replace(ckpt + ".tmp", ckpt)
    s = {"means": params["means"].detach().cpu().numpy(), "scales": params["scales"].detach().cpu().numpy(),
         "quats": params["quats"].detach().cpu().numpy(), "opacity": params["opacities"].detach().cpu().numpy(),
         "sh0": params["sh0"].detach().cpu().numpy()[:, 0, :], "shN": params["shN"].detach().cpu().numpy()}
    write_splat_ply(final, s, comments=("sarekooche build_scene.py %s gsplat trainer" % VERSION,))
    write_json(os.path.join(out_dir, "train.json"), {"trainer": "gsplat %s (MCMC)" % gsplat_version(), "steps": steps,
                                                     "seconds": time.time() - t0,
                                                     "loss_first": float(np.mean(losses[:20])) if losses else None,
                                                     "loss_last": float(np.mean(losses[-20:])) if losses else None})
    if os.path.exists(ckpt):
        os.remove(ckpt)
    return final


def gsplat_version():
    try:
        import gsplat  # noqa: WPS433
        return gsplat.__version__
    except Exception:  # noqa: BLE001
        return "(not installed)"


# ─── Previews ────────────────────────────────────────────────────────────────

def render_views(s, V, idxs, size, device):
    torch = torch_mod()
    k = size / V.size
    K = torch.tensor(V.K * np.array([[k, 1, k], [1, k, k], [1, 1, 1]], np.float32), device=device)
    means = torch.from_numpy(s["means"]).to(device)
    quats = torch.from_numpy(s["quats"]).to(device)
    scales = torch.exp(torch.from_numpy(s["scales"]).to(device))
    opac = torch.sigmoid(torch.from_numpy(s["opacity"]).to(device))
    colors = torch.from_numpy(np.concatenate([s["sh0"][:, None, :], s["shN"]], 1)).to(device)
    deg = int(round(math.sqrt(colors.shape[1]))) - 1
    outs = []
    with torch.no_grad():
        for i in idxs:
            w2c = torch.from_numpy(V.items[i][2]).to(device)
            if device.type == "cuda":
                from gsplat import rasterization  # noqa: WPS433
                out, _, _ = rasterization(means, quats, scales, opac, colors, w2c[None], K[None], size, size,
                                          sh_degree=deg, packed=True, near_plane=0.01)
                img = out[0]
            else:
                img = torch_rasterize(means, quats, scales, opac, colors, w2c, K, size, size, 0)
            outs.append((img.clamp(0, 1) * 255 + 0.5).byte().cpu().numpy())
    return outs


def make_preview(path, s, ddir, device, size):
    """Photo | splats, at 6 places along the walk (forward views)."""
    import cv2  # noqa: WPS433
    V = Views(ddir, size)
    fwd = [i for i, it in enumerate(V.items) if it[0].endswith("_c00.jpg")] or list(range(len(V.items)))
    pick = [fwd[int(round(j * (len(fwd) - 1) / 5))] for j in range(min(6, len(fwd)))]
    pick = sorted(set(pick))
    renders = render_views(s, V, pick, size, device)
    rows = []
    for i, r in zip(pick, renders):
        photo = cv2.cvtColor(cv2.imread(V.items[i][0]), cv2.COLOR_BGR2RGB)
        photo = cv2.resize(photo, (size, size), interpolation=cv2.INTER_AREA)
        rows.append(np.concatenate([photo, np.full((size, 8, 3), 255, np.uint8), r], 1))
    sheet = np.concatenate([np.concatenate([r, np.full((8, r.shape[1], 3), 255, np.uint8)], 0) for r in rows], 0)
    cv2.imwrite(path, cv2.cvtColor(sheet, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 88])
    for j, (i, r) in enumerate(zip(pick, renders), 1):
        cv2.imwrite(os.path.join(os.path.dirname(path), "previews", "view-%d.jpg" % j),
                    cv2.cvtColor(r, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 90])
    return len(pick)


# ─── The dry run's synthetic 360° walk ───────────────────────────────────────

def synthetic_texture(rng, n=512):
    import cv2  # noqa: WPS433
    t = np.zeros((n, n, 3), np.float32)
    for sc, amp in ((4, 0.5), (16, 0.3), (64, 0.25)):
        z = rng.random((sc, sc, 3)).astype(np.float32)
        t += amp * cv2.resize(z, (n, n), interpolation=cv2.INTER_CUBIC)
    for _ in range(140):  # «posters»: sharp-edged patches, good features
        x, y, w, h = rng.integers(0, n - 60), rng.integers(0, n - 60), rng.integers(8, 60), rng.integers(8, 60)
        t[y:y + h, x:x + w] = rng.random(3) * 1.2
    t -= t.min()
    t /= t.max()
    return (t * 230 + 15).astype(np.uint8)


def synthetic_pose(t):
    """World y-UP: walk +z at 1 m/s for 4 s, stand 2 s, then walk on, turning."""
    if t < 4:
        z = -8 + t
        x = 0.0
        head = 0.0
    elif t < 6:
        z, x, head = -4.0, 0.0, 0.0
    else:
        u = t - 6
        z = -4 + u * math.cos(0.08 * u)
        x = 0.6 * math.sin(0.25 * u)
        head = 0.08 * u
    return np.array([x, 1.8, z]), head


def make_synthetic_video(path, W=1536, fps=8, seconds=12.0):
    import cv2  # noqa: WPS433
    rng = np.random.default_rng(3)
    tex = [synthetic_texture(rng) for _ in range(6)]
    box = (-6.0, 6.0, 0.0, 5.0, -14.0, 14.0)  # x0 x1 y0 y1 z0 z1 (y up)
    H = W // 2
    vv, uu = np.meshgrid(np.arange(H) + 0.5, np.arange(W) + 0.5, indexing="ij")
    lon = uu / W * 2 * math.pi - math.pi
    lat = math.pi / 2 - vv / H * math.pi
    ray = np.stack([np.cos(lat) * np.sin(lon), -np.sin(lat), np.cos(lat) * np.cos(lon)], -1).reshape(-1, 3)
    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", "%dx%d" % (W, H),
           "-r", str(fps), "-i", "-", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", path]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    n = int(seconds * fps)
    for k in range(n):
        t = k / fps
        o, head = synthetic_pose(t)
        fw = np.array([math.sin(head), 0, math.cos(head)])
        rt = np.array([math.cos(head), 0, -math.sin(head)])
        d = ray[:, 0:1] * rt + (-ray[:, 1:2]) * np.array([0, 1.0, 0]) + ray[:, 2:3] * fw
        tt = np.full(len(d), np.inf)
        face = np.zeros(len(d), int)
        for ax, (lo, hi) in enumerate(((box[0], box[1]), (box[2], box[3]), (box[4], box[5]))):
            with np.errstate(divide="ignore", invalid="ignore"):
                tp = np.where(d[:, ax] > 0, (hi - o[ax]) / d[:, ax], np.where(d[:, ax] < 0, (lo - o[ax]) / d[:, ax], np.inf))
            better = tp < tt
            tt[better] = tp[better]
            face[better] = ax * 2 + (d[better, ax] > 0)
        hit = o + d * tt[:, None]
        img = np.zeros((len(d), 3), np.uint8)
        for fc in range(6):
            sel = face == fc
            ax = fc // 2
            a, b = [i for i in range(3) if i != ax]
            ua = ((hit[sel, a] * 40).astype(int)) % 512
            ub = ((hit[sel, b] * 40).astype(int)) % 512
            img[sel] = tex[fc][ub, ua]
        img = img.reshape(H, W, 3)
        # the «operator»: a magenta blob under the camera that walks along with it
        img[int(H * (90 + 62) / 180):] = (255, 0, 255)
        if 9.0 <= t < 9.5:
            img = cv2.GaussianBlur(img, (0, 0), 7)
        p.stdin.write(img.tobytes())
    p.stdin.close()
    if p.wait() != 0:
        raise Fail("ffmpeg could not make the test video")
    return path


MOCK_BRUSH = r'''#!PYTHON
# A stand-in for Brush's command line (dry run only): parses the same flags,
# prints Brush's own log lines, and exports a PLY with Brush's property order
# (alphabetical, as its serializer writes it) made from the COLMAP points.
import argparse, os, struct, sys, time
import numpy as np
ap = argparse.ArgumentParser()
ap.add_argument("source")
for k in ("total-steps", "max-splats", "max-resolution", "sh-degree", "export-every", "eval-every", "seed", "max-frames"):
    ap.add_argument("--" + k, type=int)
ap.add_argument("--export-path"); ap.add_argument("--export-name")
a = ap.parse_args()
p = os.path.join(a.source, "sparse", "0", "points3D.bin")
with open(p, "rb") as f:
    n = struct.unpack("<Q", f.read(8))[0]
    rec = np.frombuffer(f.read(51 * n), dtype=np.dtype([("id", "<u8"), ("xyz", "<f8", 3), ("rgb", "u1", 3), ("err", "<f8"), ("tl", "<u8")]))
print("[INFO] Loaded dataset", flush=True)
for it in range(200, a.total_steps + 1, 200):
    print("[INFO  brush_cli] Refine iter %d, %d splats." % (it, n), flush=True)
    time.sleep(0.01)
names = ["f_dc_0", "f_dc_1", "f_dc_2"] + sorted(["f_rest_%d" % i for i in range(45)]) + ["opacity", "rot_0", "rot_1", "rot_2", "rot_3", "scale_0", "scale_1", "scale_2", "x", "y", "z"]
cols = {k: np.zeros(n, np.float32) for k in names}
for i, k in enumerate("xyz"): cols[k] = rec["xyz"][:, i].astype(np.float32)
for i in range(3): cols["f_dc_%d" % i] = ((rec["rgb"][:, i] / 255.0 - 0.5) / 0.28209479177387814).astype(np.float32); cols["scale_%d" % i] += np.log(0.05)
cols["rot_0"] += 1; cols["opacity"] += 2
data = np.stack([cols[k] for k in names], 1).astype("<f4")
out = os.path.join(a.export_path, a.export_name.replace("{iter}", str(a.total_steps)))
with open(out, "wb") as f:
    f.write(("ply\nformat binary_little_endian 1.0\nelement vertex %d\n" % n + "".join("property float %s\n" % k for k in names) + "end_header\n").encode())
    f.write(data.tobytes())
print("Training took 1s", flush=True)
'''


def write_mock_brush(path):
    with open(path, "w") as f:
        f.write(MOCK_BRUSH.replace("#!PYTHON", "#!" + sys.executable))
    os.chmod(path, 0o755)
    return path


# ─── The pipeline ────────────────────────────────────────────────────────────

def pipeline(args, video, name, build, device):
    work = os.path.join(build, "work")
    for d in ("frames", "views", "sfm", "dataset", "train", "tools"):
        os.makedirs(os.path.join(work, d), exist_ok=True)
    fdir, vdir, sfm_dir = os.path.join(work, "frames"), os.path.join(work, "views"), os.path.join(work, "sfm")
    ddir, tdir, tools = os.path.join(work, "dataset"), os.path.join(work, "train"), os.path.join(work, "tools")

    with Stage("1/6  Picking sharp frames from the video"):
        info = probe_video(video)
        say("  %s: %d×%d %s, %s, %.1f frames a second, %.1f GB" % (
            os.path.basename(video), info["width"], info["height"], info["codec"], human_time(info["duration"]),
            info["fps"], info["size"] / 1e9))
        n_est = max(1, int(info["duration"] * args.fps))
        need = n_est * (len(rig_views(args)) * (args.view_size / 1600) ** 2 * 2.3 + 8.0 * info["width"] / 7680) / 1000 + 6
        have = free_gb(build)
        say("  disk: about %.0f GB will be needed here, %.0f GB is free" % (need, have))
        if have < need and not os.path.exists(os.path.join(fdir, "frames.json")):
            raise Fail("Not enough disk space: about %.0f GB is needed and %.0f GB is free.\n"
                       "  Make a new pod with a bigger «Container Disk» (see BUILD-README.txt)." % (need, have))
        fj = os.path.join(fdir, "frames.json")
        if os.path.exists(fj):
            frec = read_json(fj)
            say("  already done.")
        else:
            frec = extract_frames(args, video, info, fdir)
        say("  %d frames kept (of %d moments: %d too blurry, %d where the camera stood still)" % (
            len(frec["frames"]), frec["windows"], len(frec["dropped_blurry"]), len(frec["dropped_still"])))

    views = rig_views(args)
    with Stage("2/6  Cutting each 360° frame into %d camera views" % len(views)):
        vj = os.path.join(vdir, "views.json")
        if os.path.exists(vj) and read_json(vj)["frames"] == [f["name"] for f in frec["frames"]]:
            vrec = read_json(vj)
            say("  already done.")
        else:
            vrec = cut_views(args, frec, fdir, vdir, views)
        say("  %d views at the horizon, %d tilted down, %d tilted up; %d×%d, %.0f° wide" % (
            args.around, args.down, args.up, args.view_size, args.view_size, args.fov))
        say("  masked under the camera (%d° cone) and over it (%d° cone)" % (args.nadir_mask, args.zenith_mask))

    with Stage("3/6  Working out where the camera was (COLMAP)"):
        sj = os.path.join(sfm_dir, "sfm.json")
        if os.path.exists(sj):
            srec = read_json(sj)
            say("  already done.")
        else:
            srec = run_sfm(args, vrec, vdir, sfm_dir, tools)
        cov = srec["frames_registered"] / max(1, srec["frames_total"])
        say("  %d of %d frames placed (%.0f%%), %d of %d pictures, %s 3D points, %s mapper" % (
            srec["frames_registered"], srec["frames_total"], 100 * cov, srec["images_registered"],
            srec["images_total"], f"{srec['points']:,}", srec["mapper"]))
        if cov < 0.5:
            say("  ! less than half of the walk was placed: the scene will only cover that part.")

    with Stage("4/6  Turning it upright, in metres, and preparing the training pictures"):
        dj = os.path.join(ddir, "dataset.json")
        if os.path.exists(dj) and read_json(dj).get("model") == srec["model"]:
            drec = read_json(dj)
            say("  already done.")
        else:
            drec = build_dataset(args, vrec, srec, vdir, ddir, frec)
            drec["model"] = srec["model"]
            write_json(dj, drec)
        say("  %d training pictures, %s starting points, walk %.0f m" % (
            drec["images"], f"{drec['points']:,}", drec["walk_length_m"]))

    trainer_used = None
    with Stage("5/6  Training the Gaussian splats (the long part)"):
        final = None
        reason = None
        gs_dir = os.path.join(tdir, "gsplat")
        gsplat_started = any(os.path.exists(os.path.join(gs_dir, f)) for f in ("gsplat_final.ply", "checkpoint.pt"))
        if args.trainer == "auto" and gsplat_started:
            say("  (an earlier run trains with gsplat here: carrying on with it)")
        if args.trainer == "brush" or (args.trainer == "auto" and not gsplat_started):
            ok, why = brush_usable(args)
            if ok:
                say("  Brush %s: %s" % (args.brush_version, why))
                try:
                    final = train_brush(args, ddir, tdir)
                    trainer_used = "Brush %s (Apache-2.0)" % args.brush_version
                except Fail as e:
                    reason = str(e)
            else:
                reason = why
            if final is None:
                if args.trainer == "brush":
                    raise Fail("Brush cannot train here: %s." % reason.rstrip("."))
                say("  Brush is not used: %s." % reason.rstrip("."))
                say("  → training with gsplat %s instead (same kind of result)." % gsplat_version())
        if final is None:
            final = train_gsplat(args, ddir, tdir, device)
            trainer_used = ("gsplat %s (Apache-2.0), MCMC" % gsplat_version() if device.type == "cuda" else
                            "the gsplat trainer's loop on a CPU stand-in rasteriser (dry run)")
        tj = os.path.join(os.path.dirname(final), "train.json")
        trec = read_json(tj) if os.path.exists(tj) else {}

    with Stage("6/6  Writing the scene, the route and the preview"):
        s = read_splat_ply(final)
        s, dropped, before = tidy_splats(s, args.max_splats)
        n = s["means"].shape[0]
        # Sanity: the splats must sit where the cameras walked (same frame).
        cams = np.array([r["position"] for r in drec["route"]])
        med = np.median(s["means"], 0)
        off = float(np.linalg.norm(med - np.median(cams, 0)))
        span = float(np.max(np.linalg.norm(cams - cams.mean(0), axis=1))) + 5
        if off > 4 * span:
            say("  ! the splats' centre is %.0f m from the walk — the trainer may have moved the scene." % off)
        out_ply = os.path.join(build, "%s.ply" % name)
        write_splat_ply(out_ply, s, comments=(
            "sarekooche build_scene.py %s: %s; y down (tour: flip upright ON); metres" % (VERSION, trainer_used),))
        cams_json = os.path.join(build, "%s-cameras.json" % name)
        write_json(cams_json, [{"img_name": r["img_name"], "position": r["position"], "rotation": r["rotation"]}
                               for r in drec["route"]])
        os.makedirs(os.path.join(build, "previews"), exist_ok=True)
        preview = os.path.join(build, "%s-preview.jpg" % name)
        try:
            make_preview(preview, s, ddir, device, 96 if device.type == "cpu" else 800)
        except Exception as e:  # noqa: BLE001
            say("  (no preview pictures: %s)" % e)
            preview = None
        say("  %s splats%s · %.0f MB" % (f"{n:,}", " (cut from %s)" % f"{before:,}" if before > n else "",
                                          os.path.getsize(out_ply) / 1e6))
        if dropped:
            say("  (%d broken splats left out)" % dropped)
    return {"ply": out_ply, "cameras": cams_json, "preview": preview, "splats": n, "frec": frec, "vrec": vrec,
            "srec": srec, "drec": drec, "trainer": trainer_used, "trec": trec}


def summary(args, name, build, res, gpu_name, price):
    total = time.time() - T0
    fr, sr, dr = res["frec"], res["srec"], res["drec"]
    lines = [
        "Sarekooche scene build %s — «%s»" % (VERSION, name),
        "",
        "Video        %s (%d×%d %s, %s)" % (os.path.basename(fr["video"]), fr["video_info"]["width"],
                                           fr["video_info"]["height"], fr["video_info"]["codec"],
                                           human_time(fr["video_info"]["duration"])),
        "Frames       %d used of %d moments at %.2f/s (%d blurry, %d standing still)" % (
            len(fr["frames"]), fr["windows"], fr["fps"], len(fr["dropped_blurry"]), len(fr["dropped_still"])),
        "Views        %d per frame, %d×%d, %.0f° field of view" % (len(res["vrec"]["views"]), args.view_size,
                                                                  args.view_size, args.fov),
        "Registered   %d of %d frames (%.0f%%), %d of %d pictures (%.0f%%), %s points, %s mapper" % (
            sr["frames_registered"], sr["frames_total"], 100 * sr["frames_registered"] / max(1, sr["frames_total"]),
            sr["images_registered"], sr["images_total"], 100 * sr["images_registered"] / max(1, sr["images_total"]),
            f"{sr['points']:,}", sr["mapper"]),
        "Scale        %s; walk %.0f m at %.2f m/s" % (dr["scale_method"], dr["walk_length_m"], dr["walking_speed"]),
        "Orientation  y DOWN, metres, origin = first camera, +z = first walking direction",
        "             → in the tour leave «flip upright» TICKED (the default)",
        "Training     %s, %s steps%s" % (res["trainer"], f"{args.steps:,}",
                                         ", %s" % human_time(res["trec"]["seconds"]) if res["trec"].get("seconds") else ""),
        "Splats       %s" % f"{res['splats']:,}",
        "",
        "Time (this run):",
    ]
    for title, dt in TIMINGS:
        lines.append("  %-58s %s" % (title[:58], human_time(dt)))
    lines.append("  %-58s %s" % ("Total", human_time(total)))
    lines.append("")
    h = total / 3600
    lines.append("Cost of this run (GPU time only): about $%.2f on %s at $%.2f/h" % (price * h, gpu_name, price))
    lines.append("  the same time on an L40S ($0.79/h): $%.2f · on an A100 ($1.59/h): $%.2f · on an A40 ($0.49/h): $%.2f"
                 % (0.79 * h, 1.59 * h, 0.49 * h))
    text = "\n".join(lines) + "\n"
    with open(os.path.join(build, "summary.txt"), "w") as f:
        f.write(text)
    return text


def main():
    global LOG_PATH  # noqa: PLW0603
    if len(sys.argv) >= 2 and sys.argv[1] == "--internal":
        internal_step(sys.argv[2], read_json(sys.argv[3]))
        return
    ap = argparse.ArgumentParser(description="A walkable Gaussian-splat scene from a 360° walk video.")
    ap.add_argument("video", nargs="?", help="the equirectangular 360° MP4")
    ap.add_argument("name", nargs="?", help="scene name (lowercase letters, digits, hyphens)")
    ap.add_argument("--root", default="/workspace/build", help="results go to <root>/<name>/")
    ap.add_argument("--log", help="log file (the shell script passes it)")
    ap.add_argument("--site", default=SITE)
    g = ap.add_argument_group("frames")
    g.add_argument("--fps", type=float, default=2.0, help="frames kept per second of video")
    g.add_argument("--candidates", type=int, default=3, help="frames looked at per kept frame (the sharpest wins)")
    g.add_argument("--blur-ratio", type=float, default=0.4, help="drop a moment sharper than this × the median")
    g.add_argument("--still-px", type=float, default=0.5, help="drop a frame that moved less than this (px at 512 wide)")
    g.add_argument("--max-frames", type=int, default=600)
    g.add_argument("--pano-width", type=int, default=7680, help="larger panoramas are reduced to this width")
    g.add_argument("--frame-quality", type=int, default=95)
    r = ap.add_argument_group("views (the rig)")
    r.add_argument("--around", type=int, default=8, help="views around the horizon")
    r.add_argument("--down", type=int, default=4, help="views tilted down")
    r.add_argument("--up", type=int, default=4, help="views tilted up")
    r.add_argument("--tilt", type=float, default=35.0, help="tilt of the up/down views, degrees")
    r.add_argument("--fov", type=float, default=90.0)
    r.add_argument("--view-size", type=int, default=1600)
    r.add_argument("--view-quality", type=int, default=95)
    r.add_argument("--nadir-mask", type=float, default=35.0, help="masked cone under the camera (operator), degrees")
    r.add_argument("--zenith-mask", type=float, default=20.0, help="masked cone over the camera, degrees")
    c = ap.add_argument_group("COLMAP")
    c.add_argument("--sift-features", type=int, default=4096)
    c.add_argument("--overlap", type=int, default=4, help="each frame is matched with the next N")
    c.add_argument("--no-loops", dest="loops", action="store_false", help="no loop detection")
    c.add_argument("--mapper", choices=["auto", "global", "incremental"], default="auto")
    c.add_argument("--min-coverage", type=float, default=0.7)
    c.add_argument("--camera-height", type=float, default=2.0, help="camera height above the ground, metres")
    c.add_argument("--walk-speed", type=float, default=1.0, help="fallback scale: walking pace, m/s")
    c.add_argument("--init-points", type=int, default=1_500_000)
    t = ap.add_argument_group("training")
    t.add_argument("--trainer", choices=["auto", "brush", "gsplat"], default="auto")
    t.add_argument("--steps", type=int, default=30_000)
    t.add_argument("--max-splats", type=int, default=7_000_000)
    t.add_argument("--sh-degree", type=int, default=3)
    t.add_argument("--train-size", type=int, default=0, help="gsplat: train at this size (0 = view size)")
    t.add_argument("--init-scale", type=float, default=0.1)
    t.add_argument("--init-opacity", type=float, default=0.5)
    t.add_argument("--brush-bin", help="the Brush program (the shell script passes it)")
    t.add_argument("--brush-version", default="v0.3.0")
    t.add_argument("--brush-check-minutes", type=float, default=20)
    t.add_argument("--max-train-hours", type=float, default=3.0)
    ap.add_argument("--price-per-hour", type=float, default=0.0)
    ap.add_argument("--dry-run", action="store_true", help="a synthetic 360° walk, small sizes")
    ap.add_argument("--cpu", action="store_true", help="no GPU (dry run)")
    args = ap.parse_args()
    LOG_PATH = args.log

    torch = torch_mod()
    say("Sarekooche scene builder %s" % VERSION)
    say("Python %s · PyTorch %s · CUDA %s" % (sys.version.split()[0], torch.__version__, torch.version.cuda))
    if args.cpu or not torch.cuda.is_available():
        if not args.dry_run:
            raise Fail("No GPU found. On RunPod choose a GPU pod with the «Runpod Pytorch 2.8.0» template.")
        device = torch.device("cpu")
        gpu_name, price = "CPU (dry run)", 0.0
    else:
        device = torch.device("cuda")
        gpu_name = torch.cuda.get_device_name(0)
        price = gpu_price(gpu_name)
    if args.price_per_hour:
        price = args.price_per_hour
    try:
        import pycolmap  # noqa: WPS433
        args.gpu = bool(getattr(pycolmap, "has_cuda", False)) and device.type == "cuda"
        say("pycolmap %s (COLMAP %s), %s" % (pycolmap.__version__, getattr(pycolmap, "COLMAP_version", "?"),
                                             "GPU" if args.gpu else "CPU"))
    except ImportError:
        raise Fail("pycolmap is not installed (the shell script installs it).")

    if args.dry_run:
        args.root = os.path.join(args.root, "dryrun")
        os.makedirs(args.root, exist_ok=True)
        args.name = args.name or "dryrun"
        build = os.path.join(args.root, args.name)
        os.makedirs(build, exist_ok=True)
        LOG_PATH = LOG_PATH or os.path.join(build, "log.txt")
        if args.view_size == 1600:
            args.view_size = 320
        args.pano_width = 0
        args.camera_height = 1.8
        args.steps = min(args.steps, 300) if args.trainer != "gsplat" else min(args.steps, 150)
        args.train_size = args.train_size or 48
        args.overlap = min(args.overlap, 3)
        args.loops = False
        if not args.brush_bin:  # a real Brush can be given (e.g. on a CPU Vulkan driver)
            args.brush_bin = write_mock_brush(os.path.join(build, "mock-brush"))
        video = os.path.join(args.root, "synthetic-360.mp4")
        if not os.path.exists(video):
            with Stage("Dry run: making a synthetic 360° walk video"):
                make_synthetic_video(video)
        name = args.name
    else:
        if not args.video:
            raise Fail("Give the video, e.g.  build_scene.py /workspace/plaza.mp4 plaza1")
        video = args.video
        if not os.path.isfile(video):
            raise Fail("No such file: %s" % video)
        name = args.name or re.sub(r"[^a-z0-9]+", "-", os.path.splitext(os.path.basename(video))[0].lower()).strip("-")[:40].strip("-")
        if not SCENE_RE.match(name or ""):
            raise Fail("«%s» cannot be a scene name: lowercase letters, digits and inner hyphens, e.g. plaza1." % name)
        build = os.path.join(args.root, name)
        os.makedirs(build, exist_ok=True)
        LOG_PATH = LOG_PATH or os.path.join(build, "log.txt")
    say("Device: %s · scene «%s» · results in %s" % (gpu_name, name, build))

    res = pipeline(args, video, name, build, device)
    text = summary(args, name, build, res, gpu_name, price)
    banner("FINISHED — %s" % name)
    say(text)

    if args.dry_run:
        dry_run_verdict(args, build, res)
        return
    site = args.site.rstrip("/")
    say("YOUR FILES (Jupyter → left panel → «workspace» → «build» → «%s»):" % name)
    say("  1. %s   ← look at this first (photo | splats)" % (res["preview"] or "(no preview)"))
    say("  2. %s   ← the scene: upload this" % res["ply"])
    say("  3. %s   ← the walk route (optional, upload after the scene)" % res["cameras"])
    say("")
    say("NEXT: %s/operator/splats → «1 · Upload scenes» → choose %s.ply" % (site, name))
    say("      → Scene id: %s · keep «convert to .spz here» ticked → Start." % name)
    say("      → then in «2 · Tour», under %s: keep «flip upright» TICKED and press «Make the streamed copy»." % name)
    say("THEN STOP AND TERMINATE THIS POD on runpod.io so billing stops (download the files first).")


def dry_run_verdict(args, build, res):
    import cv2  # noqa: WPS433
    banner("Dry-run checks")
    fr = res["frec"]
    ts = [f["t"] for f in fr["frames"]]
    assert fr["dropped_still"], "the 2 s pause was not dropped"
    assert any(4.0 <= t < 6.5 for t in fr["dropped_still"]), "the pause frames were not the ones dropped"
    assert any(9.0 <= t < 9.5 for t in fr["dropped_blurry"]), "the blurry second was not dropped: %s" % fr["dropped_blurry"]
    assert not any(9.0 <= t < 9.5 for t in ts), "a blurry frame was kept"
    say("  frames: %d kept; pause dropped at %s s; blur dropped at %s s" % (len(ts), fr["dropped_still"], fr["dropped_blurry"]))
    vdir = os.path.join(build, "work", "views")
    # masks: no feature and no training under the camera
    for v in res["vrec"]["views"]:
        m = cv2.imread(os.path.join(vdir, "train_masks", "cam%02d.png" % v["index"]), cv2.IMREAD_GRAYSCALE)
        img = cv2.imread(os.path.join(vdir, "images", v["prefix"], fr["frames"][0]["name"]))
        # the operator is pure magenta; the walls' textures never go below 15 in any channel
        magenta = (img[..., 2] > 225) & (img[..., 1] < 8) & (img[..., 0] > 225)
        seen = int((magenta & (m > 0)).sum())
        assert seen < 0.001 * m.size, "the operator is not masked in view %d (%d px)" % (v["index"], seen)
        if v["pitch"] < 0:
            assert magenta.sum() > 0.02 * m.size, "the test operator should be visible in down view %d" % v["index"]
    say("  masks: the «operator» under the camera is masked in every view")
    import pycolmap  # noqa: WPS433
    cfg = pycolmap.read_rig_config(os.path.join(vdir, "rig_config.json"))
    assert len(cfg) == 1 and len(cfg[0].cameras) == len(res["vrec"]["views"])
    assert sum(1 for c in cfg[0].cameras if c.ref_sensor) == 1
    R0 = view_rotation(0, 0)
    for v, c in zip(res["vrec"]["views"], cfg[0].cameras):
        if v["index"]:
            want = view_rotation(v["yaw"], v["pitch"]).T @ R0
            got = np.asarray(c.cam_from_rig.rotation.matrix())
            assert np.allclose(want, got, atol=1e-9), "rig rotation %d" % v["index"]
    say("  rig_config.json: read back by COLMAP's own parser, %d cameras, rotations exact" % len(cfg[0].cameras))
    sr = res["srec"]
    assert sr["frames_registered"] >= 0.8 * sr["frames_total"], "too few frames registered: %s" % sr
    say("  SfM: %d of %d frames registered (%s mapper)" % (sr["frames_registered"], sr["frames_total"], sr["mapper"]))
    # alignment against the truth: synthetic camera path (y up, metres)
    dr = res["drec"]
    route = np.array([r["position"] for r in dr["route"]])
    tt = [r["t"] for r in dr["route"]]
    truth = np.array([synthetic_pose(t)[0] for t in tt])
    truth_len = np.sum(np.linalg.norm(np.diff(truth, axis=0), axis=1))
    got_len = np.sum(np.linalg.norm(np.diff(route, axis=0), axis=1))
    say("  walk length: %.2f m recovered, %.2f m true (scale from: %s)" % (got_len, truth_len, dr["scale_method"]))
    assert abs(got_len / truth_len - 1) < 0.15, "scale is off"
    assert abs(np.ptp(route[:, 1])) < 0.15 * truth_len, "the walk is not level (y is not down)"
    first = route[min(3, len(route) - 1)] - route[0]
    assert first[2] > 0.7 * np.linalg.norm(first), "+z is not the first walking direction"
    # Same shape: compare to the truth turned into the file's axes (y down, +z = first steps)
    tr = truth - truth[0]
    # The synthetic renderer's world is the panorama's axes with y flipped to
    # up (x right, z forward), so in the file's axes only y changes sign.
    tr = tr * np.array([1.0, -1.0, 1.0])
    err = np.max(np.linalg.norm(tr - route, axis=1))
    say("  camera path matches the truth within %.2f m (y down, metres, +z forward)" % err)
    assert err < 0.12 * truth_len, "camera path differs from the truth"
    cams, images, pts, cols = read_colmap_bin(os.path.join(build, "work", "dataset", "sparse", "0"))
    assert len(images) == dr["images"] and cams[1]["w"] == args.view_size
    msk = os.listdir(os.path.join(build, "work", "dataset", "masks"))
    assert msk and all(m.endswith(".png") for m in msk)
    say("  dataset: PINHOLE camera, %d images, %d points, %d masks (Brush's layout)" % (len(images), len(pts), len(msk)))
    s = read_splat_ply(res["ply"])
    assert s["means"].shape[0] == res["splats"] and s["shN"].shape[1] in (0, 15)
    back = os.path.join(build, "roundtrip.ply")
    write_splat_ply(back, s)
    s2 = read_splat_ply(back)
    for k in s:
        assert np.allclose(s[k], s2[k], atol=1e-6), k
    say("  %s: %s splats, a valid 3DGS PLY (round trip exact)" % (os.path.basename(res["ply"]), f"{res['splats']:,}"))
    say("  trainer: %s" % res["trainer"])
    tr = res["trec"]
    if tr.get("loss_first") is not None:
        say("  training loss: %.4f over the first 20 steps → %.4f over the last 20" % (tr["loss_first"], tr["loss_last"]))
        assert tr["loss_last"] < tr["loss_first"], "the trainer did not learn"
    say("")
    say("DRY RUN OK.")


if __name__ == "__main__":
    try:
        main()
    except Fail as e:
        say("")
        say("✗ " + str(e))
        sys.exit(2)
    except KeyboardInterrupt:
        say("\nStopped. Run the same command again to carry on where it stopped.")
        sys.exit(130)
