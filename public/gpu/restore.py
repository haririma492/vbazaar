#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAREKOOCHE SPLAT RESTORATION — colour only, geometry frozen.

Run by restore.sh on a rented GPU pod (RunPod, template "PyTorch 2.8.0": 1× A100 80 GB,
CUDA 12.8, Ubuntu 24.04, Python 3.12):

    curl -fsSL https://sarekooche.com/gpu/restore.sh | bash -s iranianplaza1

Stages, in order. Each can be switched off and each is cached under --work,
so running it again resumes where it stopped:

  0. Reads the tour (/api/splats/tour) and the public bucket address
     (/api/splats/config), finds the scene, downloads its splats: the master
     .ply when one is publicly reachable, else the web copy (fileHQ ?? file,
     .spz). `--source <url-or-path>` overrides.
     Cameras go along the scene's recorded route (every ~0.5 m, 360°, a
     little up and down, a few raised views; an orbit when there is no
     route), and every view of the ORIGINAL splats is rendered (gsplat).
  1. VEHICLES OUT (--no-cars to skip): Grounding DINO + SAM 2.1 masks on every
     view; each splat's centre is projected into every view that sees it
     (depth-tested) and splats called «vehicle» by most of those views are
     deleted, with everything else inside that vehicle's 3D box above the
     road. The road is fitted (RANSAC plane) around each vehicle and new flat
     splats are laid where it stood, coloured from the road around it.
     THE ONLY STAGE THAT CHANGES GEOMETRY.
  2. CLEAN EVERY VIEW: NVIDIA Fixer repair (--fixer off to skip; best effort
     in its own environment) and one gentle, identical clean-up for every
     view (white balance, denoise, stain/grime lift, local contrast).
  3. «AS NEW» (--no-renovate to skip): Qwen-Image-Edit-2511 renovates key
     views (walls, road, doors and shutters) in route order, each with its
     renovated neighbour as a reference picture. Signboards/text (Grounding
     DINO + SAM 2.1) and the sky are put back from the original pixels, so
     signs are never redrawn. Each view gets a trust weight (how much the
     model re-drew it) and each pixel too.
  4. COLOURS ONLY onto the now-frozen geometry: first to the cleaned views
     (pulled toward the original colours), then to the renovated key views
     (pulled toward the cleaned colours, so disagreeing edits average out).
  5. Writes /workspace/out/<scene>-restored.ply (binary little-endian 3DGS;
     every kept splat's geometry bit-identical, in order; new road splats at
     the end) and /workspace/out/<scene>-before-after.jpg (before / the AI's
     picture / after), and prints timings, the GPU and an estimated cost.

Never used: non-commercial weights (Difix, ArtiFixer, SUPIR, GaussianEditor),
Ultralytics YOLO (AGPL), anything that needs a Hugging Face token, or a model
that draws signs: those are done by hand in the viewer.

`--dry-run --cpu` runs every stage on a tiny synthetic street on the CPU (no
network, no gsplat: a small pure-PyTorch rasteriser; the models are replaced
by tiny stand-ins) and checks: file round trips, cameras, the vehicle vote and
road fill, signs put back after the edit, and geometry frozen by the fit.
"""

import argparse
import gzip
import hashlib
import io
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
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np

VERSION = "2026-10-08.2"
SITE = "https://sarekooche.com"
SH_C0 = 0.28209479177387814
SH_C1 = 0.4886025119029199

# Approximate on-demand RunPod prices (USD per GPU-hour, 2026). Only for the
# printed estimate; the RunPod bill is the truth.
GPU_PRICES = [
    ("L40S", 0.79), ("L40", 0.69), ("RTX 6000 Ada", 0.74), ("A6000", 0.49), ("A5000", 0.27),
    ("A4500", 0.25), ("4090", 0.59), ("5090", 0.89), ("3090", 0.43), ("A40", 0.49),
    ("A100", 1.59), ("H100", 1.99), ("H200", 3.59), ("B200", 5.99),
]

FIXER_COMMIT = "b39dfcaf4eeec90dc943b057ff368c16252c6c6e"  # github.com/nv-tlabs/Fixer, 2026-07-30
FIXER_HF_REPO = "nvidia/Fixer"
FIXER_NOTICE = (
    "NVIDIA Fixer — code: Apache-2.0 (github.com/nv-tlabs/Fixer @ %s). Weights: NVIDIA Open Model\n"
    "License (huggingface.co/nvidia/Fixer; its model card says commercial use is allowed), on the\n"
    "NVIDIA Cosmos-Predict2 0.6B base (also NVIDIA Open Model License). Have counsel confirm before\n"
    "launch (docs/research/splat-restoration.md §6). It repairs reconstruction artefacts only; it\n"
    "does not invent or redraw content." % FIXER_COMMIT[:12]
)

T0 = time.time()
TIMINGS = []


# ─── Talking to the founder ──────────────────────────────────────────────────

def say(msg=""):
    print(msg, flush=True)


def banner(title):
    say("")
    say("━" * 72)
    say("  " + title)
    say("━" * 72)


class Stage:
    """`with Stage("Rendering"):` — prints the step and keeps its timing."""

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


# ─── Network ─────────────────────────────────────────────────────────────────

UA = {"User-Agent": "sarekooche-restore/%s" % VERSION}


def http_json(url, tries=4):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise Fail("Could not read %s (%s)." % (url, last))


def http_exists(url):
    try:
        req = urllib.request.Request(url, headers=UA, method="HEAD")
        with urllib.request.urlopen(req, timeout=30) as r:
            return 200 <= r.status < 300
    except Exception:  # noqa: BLE001
        return False


def download(url, dest):
    """Download to `dest`, resuming a partial file; prints progress."""
    if os.path.exists(dest):
        say("  already downloaded: %s (%.0f MB)" % (dest, os.path.getsize(dest) / 1e6))
        return dest
    part = dest + ".part"
    for attempt in range(1, 9):
        have = os.path.getsize(part) if os.path.exists(part) else 0
        headers = dict(UA)
        if have:
            headers["Range"] = "bytes=%d-" % have
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120) as r:
                if have and r.status != 206:
                    have = 0  # server ignored the range: start again
                total = r.headers.get("Content-Length")
                total = int(total) + have if total else None
                mode = "ab" if have else "wb"
                done, last = have, 0.0
                with open(part, mode) as f:
                    while True:
                        chunk = r.read(8 << 20)
                        if not chunk:
                            break
                        f.write(chunk)
                        done += len(chunk)
                        if time.time() - last > 5:
                            last = time.time()
                            if total:
                                say("  downloading… %.0f of %.0f MB (%.0f%%)" % (done / 1e6, total / 1e6, 100 * done / total))
                            else:
                                say("  downloading… %.0f MB" % (done / 1e6))
            os.replace(part, dest)
            say("  downloaded %s (%.0f MB)" % (os.path.basename(dest), os.path.getsize(dest) / 1e6))
            return dest
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                raise Fail("The file is not there or not public (%s): %s" % (e.code, url))
            say("  connection problem (%s), retrying (%d)…" % (e, attempt))
        except Exception as e:  # noqa: BLE001
            say("  connection problem (%s), retrying (%d)…" % (e, attempt))
        time.sleep(min(30, 3 * attempt))
    raise Fail("Could not download %s" % url)


# ─── Splats in memory ────────────────────────────────────────────────────────
# A Splats holds float32 arrays in the FILE's own coordinates:
#   means (N,3), quats (N,4) as w,x,y,z (= PLY rot_0..3), log_scales (N,3),
#   opacity_logits (N,), sh0 (N,3) (= f_dc), shrest (N,K-1,3), sh_degree.
# `raw` keeps the PLY's own records (when read from a PLY) so writing copies
# every geometry byte exactly.

class Splats:
    def __init__(self, means, quats, log_scales, opacity_logits, sh0, shrest, sh_degree,
                 raw=None, ply_comments=None, antialiased=False, source_kind="ply"):
        self.means = means
        self.quats = quats
        self.log_scales = log_scales
        self.opacity_logits = opacity_logits
        self.sh0 = sh0
        self.shrest = shrest
        self.sh_degree = sh_degree
        self.raw = raw
        self.ply_comments = ply_comments or []
        self.antialiased = antialiased
        self.source_kind = source_kind

    @property
    def n(self):
        return self.means.shape[0]

    def edited(self, keep, add=None):
        """A new scene: the splats where `keep` is True (order kept), then the
        splats in `add` (dict of arrays like this class's) appended. The ONLY
        place geometry changes (the car-removal stage)."""
        add = add or {}
        m = int(add["means"].shape[0]) if add else 0

        def cat(a, b):
            return np.concatenate([a[keep], b.astype(a.dtype)], 0) if m else a[keep].copy()

        raw = None
        if self.raw is not None:
            new = np.zeros(m, dtype=self.raw.dtype)
            if m:
                for i, k in enumerate("xyz"):
                    new[k] = add["means"][:, i]
                for i in range(4):
                    new["rot_%d" % i] = add["quats"][:, i]
                for i in range(3):
                    new["scale_%d" % i] = add["log_scales"][:, i]
                    new["f_dc_%d" % i] = add["sh0"][:, i]
                new["opacity"] = add["opacity_logits"]
            raw = np.concatenate([self.raw[keep], new]) if m else self.raw[keep].copy()
        kr = self.shrest.shape[1]
        return Splats(
            means=cat(self.means, add.get("means", np.zeros((0, 3)))),
            quats=cat(self.quats, add.get("quats", np.zeros((0, 4)))),
            log_scales=cat(self.log_scales, add.get("log_scales", np.zeros((0, 3)))),
            opacity_logits=cat(self.opacity_logits, add.get("opacity_logits", np.zeros(0))),
            sh0=cat(self.sh0, add.get("sh0", np.zeros((0, 3)))),
            shrest=cat(self.shrest, np.zeros((m, kr, 3))),
            sh_degree=self.sh_degree, raw=raw, ply_comments=self.ply_comments,
            antialiased=self.antialiased, source_kind=self.source_kind)

    def geometry_bytes(self):
        """A fingerprint of everything that must never change."""
        h = hashlib.sha256()
        for a in (self.means, self.quats, self.log_scales, self.opacity_logits):
            h.update(np.ascontiguousarray(a).tobytes())
        return h.hexdigest()


PLY_TYPES = {
    "char": "i1", "int8": "i1", "uchar": "u1", "uint8": "u1", "short": "i2", "int16": "i2",
    "ushort": "u2", "uint16": "u2", "int": "i4", "int32": "i4", "uint": "u4", "uint32": "u4",
    "float": "f4", "float32": "f4", "double": "f8", "float64": "f8",
}
PLY_NAMES = {"i1": "char", "u1": "uchar", "i2": "short", "u2": "ushort", "i4": "int", "u4": "uint",
             "f4": "float", "f8": "double"}


def sh_degree_for(rest_coeffs):
    k = rest_coeffs + 1
    d = int(round(math.sqrt(k))) - 1
    if (d + 1) ** 2 != k:
        raise Fail("Unusual number of SH coefficients (%d) in this file." % rest_coeffs)
    return d


def read_ply(path):
    with open(path, "rb") as f:
        header = b""
        while not header.endswith(b"end_header\n"):
            line = f.readline()
            if not line:
                raise Fail("%s is not a PLY file (no end_header)." % path)
            header += line
            if len(header) > 1 << 20:
                raise Fail("%s: PLY header too long." % path)
        offset = f.tell()
    lines = header.decode("latin-1").splitlines()
    if lines[0].strip() != "ply":
        raise Fail("%s is not a PLY file." % path)
    fmt, elements, comments, cur = None, [], [], None
    for ln in lines[1:]:
        p = ln.split()
        if not p:
            continue
        if p[0] == "format":
            fmt = p[1]
        elif p[0] == "comment":
            comments.append(ln[len("comment "):])
        elif p[0] == "element":
            cur = {"name": p[1], "count": int(p[2]), "props": []}
            elements.append(cur)
        elif p[0] == "property":
            if p[1] == "list":
                raise Fail("%s: list properties are not a 3DGS splat file." % path)
            if p[1] not in PLY_TYPES:
                raise Fail("%s: unknown PLY type %s." % (path, p[1]))
            cur["props"].append((p[2], PLY_TYPES[p[1]]))
    if fmt != "binary_little_endian":
        raise Fail("%s: only binary little-endian PLY is supported (this is %s)." % (path, fmt))
    if not elements or elements[0]["name"] != "vertex":
        names = [e["name"] for e in elements]
        if "chunk" in names:
            raise Fail("%s is a SuperSplat *compressed* PLY; export an uncompressed PLY." % path)
        raise Fail("%s: the first element is not 'vertex'." % path)
    vert = elements[0]
    if len(elements) > 1:
        say("  note: ignoring extra PLY elements %s" % [e["name"] for e in elements[1:]])
    dtype = np.dtype([(name, "<" + t) for name, t in vert["props"]])
    raw = np.fromfile(path, dtype=dtype, count=vert["count"], offset=offset)
    if raw.shape[0] != vert["count"]:
        raise Fail("%s is truncated (%d of %d splats)." % (path, raw.shape[0], vert["count"]))
    names = dtype.names
    need = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2",
            "rot_0", "rot_1", "rot_2", "rot_3"]
    missing = [k for k in need if k not in names]
    if missing:
        raise Fail("%s is not a 3D Gaussian-splat PLY (missing %s)." % (path, ", ".join(missing)))
    n_rest = 0
    while "f_rest_%d" % n_rest in names:
        n_rest += 1
    if n_rest % 3:
        raise Fail("%s: f_rest count %d is not a multiple of 3." % (path, n_rest))
    deg = sh_degree_for(n_rest // 3)

    def col(*ks):
        return np.stack([raw[k].astype(np.float32) for k in ks], axis=1)

    kr = n_rest // 3
    if kr:
        rest = col(*["f_rest_%d" % i for i in range(n_rest)])  # (N, 3*kr), channel-major
        shrest = rest.reshape(-1, 3, kr).transpose(0, 2, 1).copy()  # (N, kr, 3)
    else:
        shrest = np.zeros((raw.shape[0], 0, 3), np.float32)
    return Splats(
        means=col("x", "y", "z"), quats=col("rot_0", "rot_1", "rot_2", "rot_3"),
        log_scales=col("scale_0", "scale_1", "scale_2"), opacity_logits=raw["opacity"].astype(np.float32),
        sh0=col("f_dc_0", "f_dc_1", "f_dc_2"), shrest=shrest, sh_degree=deg, raw=raw,
        ply_comments=comments, source_kind="ply",
    )


def write_ply(path, s, sh0, shrest, extra_comments=()):
    """Write the scene with new colours. Geometry is copied byte for byte."""
    n = s.n
    assert sh0.shape == (n, 3) and shrest.shape == s.shrest.shape
    if s.raw is not None:
        out = s.raw.copy()  # every column, every byte, in the original order
        dt = out.dtype
        for c in range(3):
            out["f_dc_%d" % c] = sh0[:, c].astype(dt["f_dc_%d" % c])
        kr = shrest.shape[1]
        for c in range(3):
            for k in range(kr):
                name = "f_rest_%d" % (c * kr + k)
                out[name] = shrest[:, k, c].astype(dt[name])
        comments = list(s.ply_comments)
    else:
        kr = shrest.shape[1]
        fields = [("x", "f4"), ("y", "f4"), ("z", "f4"), ("f_dc_0", "f4"), ("f_dc_1", "f4"), ("f_dc_2", "f4")]
        fields += [("f_rest_%d" % i, "f4") for i in range(3 * kr)]
        fields += [("opacity", "f4"), ("scale_0", "f4"), ("scale_1", "f4"), ("scale_2", "f4"),
                   ("rot_0", "f4"), ("rot_1", "f4"), ("rot_2", "f4"), ("rot_3", "f4")]
        dt = np.dtype([(k, "<" + t) for k, t in fields])
        out = np.empty(n, dtype=dt)
        for i, k in enumerate("xyz"):
            out[k] = s.means[:, i]
        for c in range(3):
            out["f_dc_%d" % c] = sh0[:, c]
            for k in range(kr):
                out["f_rest_%d" % (c * kr + k)] = shrest[:, k, c]
        out["opacity"] = s.opacity_logits
        for i in range(3):
            out["scale_%d" % i] = s.log_scales[:, i]
        for i in range(4):
            out["rot_%d" % i] = s.quats[:, i]
        comments = []
    lines = ["ply", "format binary_little_endian 1.0"]
    lines += ["comment " + c for c in comments]
    lines += ["comment " + c for c in extra_comments]
    lines.append("element vertex %d" % n)
    for name in out.dtype.names:
        lines.append("property %s %s" % (PLY_NAMES[out.dtype[name].str[1:]], name))
    lines.append("end_header")
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(("\n".join(lines) + "\n").encode("latin-1"))
        out.astype(out.dtype.newbyteorder("<"), copy=False).tofile(f)
    os.replace(tmp, path)


# ─── SPZ (Niantic, MIT): gzip of a 16-byte header + quantised arrays ─────────
# Versions 2 and 3 (Spark 2.3 writes v3). Layout, from nianticlabs/spz
# load-spz.cc: positions (24-bit fixed point), alphas, colors, scales,
# rotations (v2: 3 bytes x,y,z; v3: 4 bytes "smallest three"), SH (per point,
# coefficient-major with the colour channel innermost). Coordinates are kept
# exactly as stored (Spark reads them raw, like a PLY).

SPZ_MAGIC = 0x5053474E
SPZ_COLOR_SCALE = 0.15


def read_spz(path):
    raw = open(path, "rb").read()
    try:
        data = gzip.decompress(raw)
    except OSError:
        if raw[:4] == b"NGSP":
            raise Fail("%s is an SPZ v4 (zstd) file; this tool reads v2/v3 (what Spark 2.3 writes)." % path)
        raise Fail("%s is not an SPZ file." % path)
    magic, version, n, deg, fbits, flags, _ = struct.unpack_from("<IIIBBBB", data, 0)
    if magic != SPZ_MAGIC:
        raise Fail("%s is not an SPZ file (bad magic)." % path)
    if version not in (2, 3):
        raise Fail("%s: SPZ version %d not supported (2 or 3)." % (path, version))
    if deg > 3:
        raise Fail("%s: SH degree %d not supported." % (path, deg))
    kr = (deg + 1) ** 2 - 1
    o = 16

    def take(count):
        nonlocal o
        a = np.frombuffer(data, dtype=np.uint8, count=count, offset=o)
        o += count
        return a

    pos = take(n * 9).reshape(n, 3, 3).astype(np.int32)
    fixed = pos[:, :, 0] | (pos[:, :, 1] << 8) | (pos[:, :, 2] << 16)
    fixed = np.where(fixed & 0x800000, fixed - (1 << 24), fixed)
    means = (fixed.astype(np.float32) * np.float32(1.0 / (1 << fbits))).astype(np.float32)
    alpha = take(n).astype(np.float32) / 255.0
    alpha = np.clip(alpha, 1e-6, 1 - 1e-6)
    opacity = np.log(alpha / (1 - alpha)).astype(np.float32)
    colors = take(n * 3).reshape(n, 3).astype(np.float32)
    sh0 = ((colors / 255.0 - 0.5) / SPZ_COLOR_SCALE).astype(np.float32)
    log_scales = (take(n * 3).reshape(n, 3).astype(np.float32) / 16.0 - 10.0).astype(np.float32)
    if version >= 3:
        r = take(n * 4).reshape(n, 4).astype(np.uint32)
        comp = r[:, 0] | (r[:, 1] << 8) | (r[:, 2] << 16) | (r[:, 3] << 24)
        largest = (comp >> 30).astype(np.int64)
        q = np.zeros((n, 4), np.float32)  # x, y, z, w
        mask = np.uint32((1 << 9) - 1)
        sumsq = np.zeros(n, np.float32)
        for i in (3, 2, 1, 0):
            active = largest != i
            mag = (comp & mask).astype(np.float32)
            neg = ((comp >> 9) & 1).astype(bool)
            val = np.float32(math.sqrt(0.5)) * mag / np.float32(511.0)
            val = np.where(neg, -val, val)
            q[:, i] = np.where(active, val, 0.0)
            sumsq += np.where(active, val * val, 0.0)
            comp = np.where(active, comp >> 10, comp)
        q[np.arange(n), largest] = np.sqrt(np.maximum(0.0, 1.0 - sumsq))
    else:
        r = take(n * 3).reshape(n, 3).astype(np.float32)
        xyz = r / 127.5 - 1.0
        w = np.sqrt(np.maximum(0.0, 1.0 - (xyz * xyz).sum(1)))
        q = np.concatenate([xyz, w[:, None]], 1).astype(np.float32)
    quats = q[:, [3, 0, 1, 2]].copy()  # → w, x, y, z
    sh = take(n * kr * 3).reshape(n, kr, 3).astype(np.float32)
    shrest = ((sh - 128.0) / 128.0).astype(np.float32)
    return Splats(means=means, quats=quats, log_scales=log_scales, opacity_logits=opacity, sh0=sh0,
                  shrest=shrest, sh_degree=deg, raw=None, antialiased=bool(flags & 1), source_kind="spz")


def write_spz(path, s, version=3, fbits=12):
    """SPZ v2/v3 writer — used by the dry run's round-trip check."""
    n, deg = s.n, s.sh_degree
    head = struct.pack("<IIIBBBB", SPZ_MAGIC, version, n, deg, fbits, 1 if s.antialiased else 0, 0)
    fixed = np.round(s.means.astype(np.float64) * (1 << fbits)).astype(np.int64) & 0xFFFFFF
    pos = np.stack([fixed & 0xFF, (fixed >> 8) & 0xFF, (fixed >> 16) & 0xFF], -1).astype(np.uint8)
    alpha = np.clip(np.round(255.0 / (1.0 + np.exp(-s.opacity_logits.astype(np.float64)))), 0, 255).astype(np.uint8)
    colors = np.clip(np.round(s.sh0 * (SPZ_COLOR_SCALE * 255.0) + 127.5), 0, 255).astype(np.uint8)
    scales = np.clip(np.round((s.log_scales + 10.0) * 16.0), 0, 255).astype(np.uint8)
    q = s.quats[:, [1, 2, 3, 0]].astype(np.float64)  # x, y, z, w
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    if version >= 3:
        largest = np.argmax(np.abs(q), 1)
        negate = q[np.arange(n), largest] < 0
        comp = largest.astype(np.uint64)
        for i in range(4):
            active = largest != i
            negbit = ((q[:, i] < 0) ^ negate).astype(np.uint64)
            mag = np.floor(511.0 * (np.abs(q[:, i]) / math.sqrt(0.5)) + 0.5).astype(np.uint64)
            comp = np.where(active, (comp << np.uint64(10)) | (negbit << np.uint64(9)) | mag, comp)
        comp = comp.astype(np.uint32)
        rot = np.stack([(comp >> s_) & 0xFF for s_ in (0, 8, 16, 24)], -1).astype(np.uint8)
    else:
        q = np.where(q[:, 3:4] < 0, -q, q)
        rot = np.clip(np.round(q[:, :3] * 127.5 + 127.5), 0, 255).astype(np.uint8)
    sh = np.clip(np.round(s.shrest * 128.0 + 128.0), 0, 255).astype(np.uint8)
    body = b"".join(a.tobytes() for a in (pos, alpha, colors, scales, rot, sh))
    with open(path, "wb") as f:
        f.write(gzip.compress(head + body, 6))


def read_splats(path):
    low = path.lower()
    if low.endswith(".ply"):
        return read_ply(path)
    if low.endswith(".spz"):
        return read_spz(path)
    with open(path, "rb") as f:
        head = f.read(4)
    if head == b"ply\n":
        return read_ply(path)
    if head[:2] == b"\x1f\x8b":
        return read_spz(path)
    raise Fail("%s: only .ply and .spz scenes are supported." % path)


# ─── Tour and source ─────────────────────────────────────────────────────────

SCENE_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$")


def find_scene(tour, scene_id):
    for s in tour.get("scenes") or []:
        if s.get("id") == scene_id:
            return s
    ids = ", ".join(s.get("id", "?") for s in tour.get("scenes") or [])
    raise Fail("There is no scene «%s» in the tour. Scenes: %s" % (scene_id, ids or "(none)"))


def resolve_source(args, scene, base):
    """(url_or_path, file_name). Master .ply when public, else fileHQ ?? file."""
    if args.source:
        src = args.source
        if os.path.exists(src):
            return src, os.path.basename(src)
        name = os.path.basename(urllib.parse.urlparse(src).path) or "source.ply"
        return src, name
    sid = scene["id"]
    if base:
        for guess in ("masters/%s/%s.ply" % (sid, sid),):
            url = "%s/%s" % (base, guess)
            if http_exists(url):
                say("  using the MASTER .ply (public): %s" % url)
                return url, os.path.basename(guess)
        say("  the master .ply is not public (private bucket, as it should be): using the web copy.")
        say("  (to use the master instead: on /operator/splats press «Copy 24 h download link» next to")
        say("   it and run again with:  --source \"<that link>\")")
    key = scene.get("fileHQ") or scene.get("file")
    if not key:
        raise Fail("Scene «%s» has no file." % sid)
    if not re.search(r"\.(spz|ply)$", key, re.I):
        raise Fail("The scene's file is %s; this tool reads .spz or .ply. Use --source with a .ply." % key)
    if not base:
        raise Fail("The site has no public bucket address (NEXT_PUBLIC_SPLAT_BASE_URL); use --source.")
    say("  using the web copy%s: %s" % (" (sharper computer copy)" if scene.get("fileHQ") else "", key))
    return "%s/%s" % (base, key), os.path.basename(key)


# ─── Coordinates and cameras ─────────────────────────────────────────────────
# The tour's route is in the scene's own coordinates AS THE VIEWER SHOWS THEM
# (three.js, y up, yaw 0 looks along −z, + turns right). With `flip`, the
# viewer turns the file 180° about x: (x, y, z)_viewer = (x, −y, −z)_file.

FLIP = np.diag([1.0, -1.0, -1.0])


def to_local(place, v):
    """lib/splats/place.ts toLocal: a world point → the scene's own (viewer) coordinates."""
    if not place:
        return np.asarray(v, float)
    yaw, sc = place.get("yaw", 0.0), place.get("scale", 1.0) or 1.0
    off = place.get("offset", [0, 0, 0])
    c, s = math.cos(yaw), math.sin(yaw)
    x, y, z = v[0] - off[0], v[1] - off[1], v[2] - off[2]
    return np.array([(x * c - z * s) / sc, y / sc, (x * s + z * c) / sc])


def look_c2w(pos, yaw, pitch):
    """Camera-to-world (OpenCV axes: x right, y down, z forward) in viewer coordinates."""
    f = np.array([math.sin(yaw) * math.cos(pitch), math.sin(pitch), -math.cos(yaw) * math.cos(pitch)])
    r = np.cross(f, [0.0, 1.0, 0.0])
    r /= np.linalg.norm(r)
    d = np.cross(f, r)
    m = np.eye(4)
    m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = r, d, f, pos
    return m


def resample(route, step):
    pts = [np.asarray(p, float) for p in route]
    out = [pts[0]]
    carry = 0.0
    for a, b in zip(pts[:-1], pts[1:]):
        seg = np.linalg.norm(b - a)
        if seg < 1e-9:
            continue
        t = step - carry
        while t <= seg:
            out.append(a + (b - a) * (t / seg))
            t += step
        carry = seg - (t - step)
    if np.linalg.norm(out[-1] - pts[-1]) > step * 0.3:
        out.append(pts[-1])
    return out


def heading_at(pts, i):
    a, b = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]
    dx, dz = b[0] - a[0], b[2] - a[2]
    if abs(dx) + abs(dz) < 1e-9:
        return 0.0
    return math.atan2(dx, -dz)


def route_views(route, step):
    """Viewer-coordinate cameras along a route: list of (c2w, group, kind)."""
    pts = resample(route, step)
    views = []
    d = math.radians
    for i, p in enumerate(pts):
        h = heading_at(pts, i)
        offsets = (0, 90, 180, 270) if i % 2 == 0 else (45, 135, 225, 315)
        for k, off in enumerate(offsets):
            # straight ahead slightly down; the others alternate ground and façades
            pitch = -8 if off == 0 else (-25 if (i + k) % 2 == 0 else 5)
            views.append((look_c2w(p, h + d(off), d(pitch)), i, "fwd" if off == 0 else "around"))
        if i % 3 == 0:  # up at signs and upper façades
            views.append((look_c2w(p, h + d((i * 37) % 360), d(30)), i, "up"))
        if i % 10 == 5:  # raised a little, looking down the street both ways
            q = p + np.array([0.0, 1.5, 0.0])
            views.append((look_c2w(q, h, d(-30)), i, "raised"))
            views.append((look_c2w(q, h + math.pi, d(-30)), i, "raised"))
    return views


def orbit_views(centre, eye_y, extent):
    views = []
    g = 0
    d = math.radians
    for rf in (0.15, 0.35):
        r = max(0.5, extent * rf)
        for j in range(24):
            a = 2 * math.pi * j / 24
            p = np.array([centre[0] + r * math.sin(a), eye_y, centre[2] - r * math.cos(a)])
            toward = math.atan2(centre[0] - p[0], -(centre[2] - p[2]))
            for k, off in enumerate((0, 90, 180, 270)):
                views.append((look_c2w(p, toward + d(off), d(-20 if k % 2 == 0 else 5)), g, "fwd" if off == 0 else "around"))
            if j % 4 == 0:
                q = p + np.array([0.0, 1.5, 0.0])
                views.append((look_c2w(q, toward, d(-35)), g, "raised"))
            g += 1
    return views


def make_cameras(scene, splats, args):
    """Cameras in FILE coordinates: list of dicts {c2w, w2c, group, kind}."""
    flip = scene.get("flip", True) is not False
    route = scene.get("route") or []
    rng = np.random.default_rng(0)
    sample = splats.means[rng.choice(splats.n, size=min(splats.n, 400_000), replace=False)].astype(np.float64)
    if len(route) >= 2:
        step = args.step
        while True:
            views = route_views(route, step)
            if len(views) <= args.max_views:
                break
            step *= len(views) / args.max_views * 1.02
        say("  %d views along the recorded route (%d points, a camera spot every %.2f units)" % (len(views), len(route), step))
    else:
        local = sample @ FLIP.T if flip else sample.copy()
        centre = np.median(local, 0)
        horiz = np.linalg.norm((local - centre)[:, [0, 2]], axis=1)
        extent = float(np.percentile(horiz, 80))
        start = (scene.get("start") or {}).get("position") or [0, 0, 0]
        if any(abs(v) > 1e-6 for v in start):
            sp = to_local(scene.get("place"), start)
            eye_y = float(sp[1])
            centre = np.array([sp[0], eye_y, sp[2]])
        else:
            near = local[horiz < max(1.0, extent * 0.3)]
            ground = float(np.percentile(near[:, 1], 5)) if len(near) else float(centre[1])
            eye_y = ground + 1.6
        views = orbit_views(centre, eye_y, extent)
        say("  the scene has no recorded route: %d views orbiting its centre at standing height" % len(views))

    # Which way round is the file? The tour's flip says (x,−y,−z); check it
    # against the splats: the cameras must stand INSIDE the scene.
    def density(T):
        pos = np.array([T @ v[0][:3, 3] for v in views[:: max(1, len(views) // 64)]])
        cnt = []
        for p in pos:
            dist = np.linalg.norm(sample - p, axis=1)
            cnt.append(np.count_nonzero(dist < 3.0))
        return float(np.median(cnt))

    T_tour = FLIP if flip else np.eye(3)
    T_other = np.eye(3) if flip else FLIP
    d_tour, d_other = density(T_tour), density(T_other)
    T = T_tour
    if d_other > 2.0 * max(d_tour, 1.0):
        T = T_other
        say("  note: the cameras fit the splats better the other way up than the tour's flip says; using that.")
    if max(d_tour, d_other) < 5:
        say("  ⚠ few splats near the cameras — the route may not match this file. Check the before/after sheet.")
    cams = []
    M = np.eye(4)
    M[:3, :3] = T
    for c2w_local, group, kind in views:
        c2w = M @ c2w_local
        cams.append({"c2w": c2w, "w2c": np.linalg.inv(c2w), "group": int(group), "kind": kind})
    return cams, T


def intrinsics(args):
    fx = (args.width / 2) / math.tan(math.radians(args.hfov) / 2)
    return np.array([[fx, 0, args.width / 2], [0, fx, args.height / 2], [0, 0, 1]], float)


# ─── Rendering (gsplat on the GPU; a small pure-PyTorch rasteriser for --cpu) ─

def torch_mod():
    import torch  # noqa: WPS433
    return torch


class SceneGPU:
    """The scene's frozen geometry on the device, plus colour tensors."""

    def __init__(self, s, device, max_deg):
        torch = torch_mod()
        self.device = device
        self.deg = min(s.sh_degree, max_deg)
        self.means = torch.from_numpy(s.means).to(device)
        q = torch.from_numpy(s.quats).to(device)
        self.quats = q / q.norm(dim=1, keepdim=True).clamp_min(1e-12)
        self.scales = torch.exp(torch.from_numpy(s.log_scales).to(device))
        self.opac = torch.sigmoid(torch.from_numpy(s.opacity_logits).to(device))
        self.radius = 3.0 * self.scales.max(dim=1).values
        k1 = (self.deg + 1) ** 2 - 1
        self.sh0 = torch.from_numpy(s.sh0).to(device)
        self.sh1 = torch.from_numpy(np.ascontiguousarray(s.shrest[:, :k1])).to(device)

    def visible(self, w2c, K, W, H, near=0.05):
        """Indices of splats that can touch this view (frustum, with their size)."""
        torch = torch_mod()
        R = torch.as_tensor(w2c[:3, :3], dtype=torch.float32, device=self.device)
        t = torch.as_tensor(w2c[:3, 3], dtype=torch.float32, device=self.device)
        out = []
        chunk = 4_000_000
        tx = (W / 2) / K[0, 0] * 1.15
        ty = (H / 2) / K[1, 1] * 1.15
        for a in range(0, self.means.shape[0], chunk):
            p = self.means[a:a + chunk] @ R.T + t
            z = p[:, 2]
            r = self.radius[a:a + chunk]
            ok = (z + r > near)
            zc = z.clamp_min(near)
            ok &= p[:, 0].abs() <= tx * zc + r
            ok &= p[:, 1].abs() <= ty * zc + r
            out.append(torch.nonzero(ok).squeeze(1) + a)
        return torch.cat(out)


def eval_sh(sh0, sh1, dirs, deg):
    """Colour from SH, as gsplat/3DGS: C0·dc (+ degree 1) + 0.5, clamped ≥ 0."""
    c = SH_C0 * sh0
    if deg >= 1 and sh1.shape[1] >= 3:
        d = dirs / dirs.norm(dim=-1, keepdim=True).clamp_min(1e-12)
        x, y, z = d[..., 0:1], d[..., 1:2], d[..., 2:3]
        c = c + SH_C1 * (-y * sh1[:, 0] + z * sh1[:, 1] - x * sh1[:, 2])
    return (c + 0.5).clamp_min(0.0)


def quat_to_rot(q):
    torch = torch_mod()
    w, x, y, z = q.unbind(-1)
    return torch.stack([
        1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
        2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
        2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)], -1).reshape(-1, 3, 3)


def torch_rasterize(means, quats, scales, opac, sh0, sh1, deg, w2c, K, W, H):
    """Reference EWA splatting in plain PyTorch (CPU dry run only). Returns (rgb, alpha, expected depth)."""
    torch = torch_mod()
    dev = means.device
    R = torch.as_tensor(w2c[:3, :3], dtype=torch.float32, device=dev)
    t = torch.as_tensor(w2c[:3, 3], dtype=torch.float32, device=dev)
    pc = means @ R.T + t
    keep = pc[:, 2] > 0.05
    pc, means, quats, scales, opac, sh0, sh1 = (a[keep] for a in (pc, means, quats, scales, opac, sh0, sh1))
    if pc.shape[0] == 0:
        z0 = torch.zeros(H, W, 1, device=dev)
        return torch.zeros(H, W, 3, device=dev), z0, z0
    Rq = quat_to_rot(quats)
    M = Rq * scales[:, None, :]
    cov = M @ M.transpose(1, 2)
    cov_c = R @ cov @ R.T
    fx, fy, cx, cy = float(K[0, 0]), float(K[1, 1]), float(K[0, 2]), float(K[1, 2])
    x, y, z = pc.unbind(-1)
    J = torch.zeros(pc.shape[0], 2, 3, device=dev)
    J[:, 0, 0] = fx / z
    J[:, 0, 2] = -fx * x / (z * z)
    J[:, 1, 1] = fy / z
    J[:, 1, 2] = -fy * y / (z * z)
    c2 = J @ cov_c @ J.transpose(1, 2) + 0.3 * torch.eye(2, device=dev)
    det = c2[:, 0, 0] * c2[:, 1, 1] - c2[:, 0, 1] ** 2
    ca, cb, cc = c2[:, 1, 1] / det, -c2[:, 0, 1] / det, c2[:, 0, 0] / det
    u, v = fx * x / z + cx, fy * y / z + cy
    campos = -R.T @ t
    col = eval_sh(sh0, sh1, means - campos, deg)
    order = torch.argsort(z)
    u, v, ca, cb, cc, op, col, zs = (a[order] for a in (u, v, ca, cb, cc, opac, col, z))
    ys, xs = torch.meshgrid(torch.arange(H, device=dev) + 0.5, torch.arange(W, device=dev) + 0.5, indexing="ij")
    px, py = xs.reshape(-1, 1), ys.reshape(-1, 1)
    rgb, acc, dep = [], [], []
    for a in range(0, px.shape[0], 2048):
        dx, dy = px[a:a + 2048] - u, py[a:a + 2048] - v
        power = -0.5 * (ca * dx * dx + 2 * cb * dx * dy + cc * dy * dy)
        al = (op * torch.exp(power.clamp_max(0))).clamp_max(0.99)
        al = torch.where((al < 1.0 / 255) | (power > 0), torch.zeros_like(al), al)
        T = torch.cumprod(torch.cat([torch.ones_like(al[:, :1]), 1 - al[:, :-1]], 1), 1)
        w = al * T
        rgb.append(w @ col)
        acc.append(w.sum(1, keepdim=True))
        dep.append(w @ zs[:, None])
    a_ = torch.cat(acc).reshape(H, W, 1)
    return torch.cat(rgb).reshape(H, W, 3), a_, torch.cat(dep).reshape(H, W, 1) / a_.clamp_min(1e-6)


class Renderer:
    def __init__(self, backend, antialiased):
        self.backend = backend
        self.mode = "antialiased" if antialiased else "classic"
        if backend == "gsplat":
            from gsplat import rasterization  # noqa: WPS433
            self.rasterization = rasterization

    def render(self, G, idx, sh0, sh1, cams, K, W, H, depth=False):
        """Render cams (list) of the splats `idx` with colours sh0/sh1 (already indexed).
        → rgb (C,H,W,3), alpha (C,H,W,1), and expected depth (C,H,W,1) when asked."""
        torch = torch_mod()
        means, quats, scales, opac = G.means[idx], G.quats[idx], G.scales[idx], G.opac[idx]
        if self.backend == "gsplat":
            viewmats = torch.as_tensor(np.stack([c["w2c"] for c in cams]), dtype=torch.float32, device=G.device)
            Ks = torch.as_tensor(np.stack([K] * len(cams)), dtype=torch.float32, device=G.device)
            if G.deg >= 1:
                colors = torch.cat([sh0[:, None, :], sh1], 1)
                deg = G.deg
            else:
                colors = sh0[:, None, :]
                deg = 0
            out, alpha, _ = self.rasterization(
                means, quats, scales, opac, colors, viewmats, Ks, W, H,
                sh_degree=deg, packed=True, near_plane=0.05, rasterize_mode=self.mode,
                render_mode="RGB+ED" if depth else "RGB")
            if depth:
                return out[..., :3], alpha, out[..., 3:4]
            return out, alpha, None
        outs = [torch_rasterize(means, quats, scales, opac, sh0, sh1, G.deg, c["w2c"], K, W, H) for c in cams]
        rgb, alpha = torch.stack([o[0] for o in outs]), torch.stack([o[1] for o in outs])
        return rgb, alpha, (torch.stack([o[2] for o in outs]) if depth else None)


def batch_indices(G, cams, K, W, H):
    torch = torch_mod()
    idx = torch.unique(torch.cat([G.visible(c["w2c"], K, W, H) for c in cams]))
    return idx


# ─── Images ──────────────────────────────────────────────────────────────────

def save_jpg(path, arr, q=95):
    from PIL import Image  # noqa: WPS433
    tmp = path + ".tmp.jpg"
    Image.fromarray(arr).save(tmp, quality=q, subsampling=0)
    os.replace(tmp, path)


def load_img(path):
    from PIL import Image  # noqa: WPS433
    return np.array(Image.open(path).convert("RGB"))


def load_gray(path):
    from PIL import Image  # noqa: WPS433
    return np.array(Image.open(path).convert("L"))


def save_gray(path, arr):
    from PIL import Image  # noqa: WPS433
    tmp = path + ".tmp.png"
    Image.fromarray(arr).save(tmp)
    os.replace(tmp, path)


def to_u8(t):
    return (t.clamp(0, 1) * 255 + 0.5).to(dtype=torch_mod().uint8).cpu().numpy()


# ─── The gentle classical clean-up (deterministic, identical for every view) ─

def box(x, r):
    """Box filter of radius r over (B,C,H,W), edge-replicated."""
    F = torch_mod().nn.functional
    k = 2 * r + 1
    return F.avg_pool2d(F.pad(x, (r, r, r, r), mode="replicate"), k, stride=1)


def guided(I, p, r, eps):
    mI, mp = box(I, r), box(p, r)
    cov = box(I * p, r) - mI * mp
    var = box(I * I, r) - mI * mI
    a = cov / (var + eps)
    b = mp - a * mI
    return box(a, r) * I + box(b, r)


def global_gains(sample_imgs):
    """One white balance for the whole scene (grey world on mid-tones), half strength."""
    torch = torch_mod()
    x = torch.cat([i.reshape(-1, 3) for i in sample_imgs])
    lum = x.mean(1)
    m = (lum > 0.08) & (lum < 0.9)
    if m.sum() < 1000:
        return torch.ones(3)
    mean = x[m].mean(0)
    g = mean.mean() / mean.clamp_min(1e-4)
    # a third of the way only: a bazaar is warm (brick, wood, lamps) and must stay so
    g = 1 + 0.33 * (g - 1)
    return g.clamp(0.93, 1.07)


def classical_restore(img, gains, strength=0.6):
    """img: (B,3,H,W) in 0..1 → cleaned. Gentle and the same for every view."""
    torch = torch_mod()
    s = float(strength)
    H = img.shape[-2]
    x = img * gains.view(1, 3, 1, 1).to(img)
    # 1. light edge-preserving denoise (guided filter, luminance as guide)
    L = x.mean(1, keepdim=True)
    den = torch.cat([guided(L, x[:, c:c + 1], 2, 4e-4) for c in range(3)], 1)
    x = x + 0.6 * s * (den - x)
    L = x.mean(1, keepdim=True).clamp_min(1e-4)
    # 2. grime/stain lift: a surface patch darker than the surface around it,
    #    by a little (stains, wet spots, soot) is brought up toward it; strong
    #    darkness (doorways, shadows, lettering) is left alone.
    r1 = max(2, H // 64)
    r2 = max(6, H // 12)
    base = guided(L, L, r1, 1e-2)
    around = box(base, r2)
    stain = (around - base).clamp_min(0)
    keep = (1 - ((stain - 0.04) / 0.10).clamp(0, 1))  # fade out above ~0.14
    lift = stain * keep * s
    x = x * ((L + lift) / L)
    # 3. local contrast ("bricks shine"): large-radius unsharp mask on luminance
    L = x.mean(1, keepdim=True).clamp_min(1e-4)
    blur = box(box(L, max(3, H // 40)), max(3, H // 40))
    mid = 1 - (2 * L - 1).abs()  # strongest in mid-tones
    Lc = L + 0.35 * s * (L - blur) * mid
    x = x * (Lc / L)
    # 4. vibrance and a gentle lift of the shadows
    mean = x.mean(1, keepdim=True)
    sat = (x.max(1, keepdim=True).values - x.min(1, keepdim=True).values)
    x = mean + (x - mean) * (1 + 0.25 * s * (1 - sat).clamp(0, 1))
    x = x + 0.06 * s * (1 - x) * (1 - x.clamp(0, 1)) ** 4
    return x.clamp(0, 1)


# ─── NVIDIA Fixer (optional; best effort, in its own environment) ────────────

FIXER_DRIVER = r'''
import os, sys, glob, time
import torch
from PIL import Image
src, models, inp, out = sys.argv[1:5]
sys.path.insert(0, src)
import transformer_engine  # noqa: F401  (Fixer's own inference script imports it first)
import pix2pix_turbo_nocond_cosmos_base_faster_tokenizer as fx
fx.config.dit_path = os.path.join(models, "base", "model_fast_tokenizer.pt")
fx.config.tokenizer["vae_pth"] = os.path.join(models, "base", "tokenizer_fast.pth")
model = fx.Pix2Pix_Turbo(pretrained_path=os.path.join(models, "pretrained", "pretrained_fixer.pkl"),
                         timestep=250, vae_skip_connection=False, batch_size=1)
model = model.to(device="cuda", dtype=torch.bfloat16)
model.set_eval()
torch.set_grad_enabled(False)
names = sorted(os.path.basename(p) for p in glob.glob(os.path.join(inp, "*.jpg")))
todo = [n for n in names if not os.path.exists(os.path.join(out, n))]
print("FIXER %d to do, %d done" % (len(todo), len(names) - len(todo)), flush=True)
t0 = time.time()
for i, n in enumerate(todo):
    im = Image.open(os.path.join(inp, n)).convert("RGB")
    size = im.size
    x = torch.from_numpy(__import__("numpy").asarray(im.resize((1024, 576), Image.BILINEAR))).float() / 255.0
    x = (x.permute(2, 0, 1)[None] * 2 - 1).to("cuda", torch.bfloat16)
    with torch.autocast(device_type="cuda", dtype=torch.bfloat16):
        y = model(x)
    y = (y.float()[0].clamp(-1, 1) * 0.5 + 0.5).permute(1, 2, 0).cpu().numpy()
    o = Image.fromarray((y * 255 + 0.5).astype("uint8")).resize(size, Image.BILINEAR)
    tmp = os.path.join(out, n + ".tmp.jpg")
    o.save(tmp, quality=95, subsampling=0)
    os.replace(tmp, os.path.join(out, n))
    if i % 25 == 0 or i == len(todo) - 1:
        el = time.time() - t0
        print("FIXER %d/%d  %.2f s per view" % (i + 1, len(todo), el / (i + 1)), flush=True)
print("FIXER DONE", flush=True)
'''

# Modules Fixer's code imports, and the pip package that brings each.
FIXER_PIP = {
    "cv2": "opencv-python-headless==4.10.0.84", "yaml": "pyyaml==6.0.2", "skimage": "scikit-image",
    "attr": "attrs==25.1.0", "attrs": "attrs==25.1.0", "hydra": "hydra-core==1.3.2", "omegaconf": "omegaconf==2.3.0",
    "megatron": "megatron-core==0.10.0", "PIL": "pillow", "google": "protobuf==4.25.3",
    "better_profanity": "better-profanity==0.7.0", "retinaface": "retinaface-py==0.0.2",
    "qwen_vl_utils": "qwen-vl-utils==0.0.11", "pynvml": "nvidia-ml-py==12.535.133", "sklearn": "scikit-learn",
    "imageio": "imageio[ffmpeg]==2.37.0", "huggingface_hub": "huggingface-hub==0.32.4",
}
FIXER_BASE_DEPS = [
    "einops==0.8.1", "hydra-core==1.3.2", "omegaconf==2.3.0", "attrs==25.1.0", "loguru==0.7.2", "termcolor==2.5.0",
    "diffusers==0.33.1", "transformers==4.51.3", "huggingface-hub==0.32.4", "safetensors==0.5.3", "peft==0.14.0",
    "fvcore==0.1.5.post20221221", "iopath==0.1.10", "imageio[ffmpeg]==2.37.0", "mediapy==1.2.2", "natsort",
    "tqdm", "pyyaml==6.0.2", "megatron-core==0.10.0", "nvidia-ml-py==12.535.133", "ftfy==6.3.1",
    "sentencepiece==0.2.0", "opencv-python-headless==4.10.0.84", "webdataset==0.2.111", "better-profanity==0.7.0",
    "nltk==3.9.1", "lpips", "ninja", "pybind11", "cmake", "wheel", "setuptools",
]


def run_logged(cmd, log, env=None, timeout=None, echo=None):
    """Run a command, appending its output to `log`. Returns the exit code."""
    with open(log, "ab") as f:
        f.write(("\n$ %s\n" % " ".join(cmd)).encode())
        f.flush()
        try:
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, stdin=subprocess.DEVNULL)
            start = time.time()
            for line in p.stdout:
                f.write(line)
                if echo and echo(line.decode("utf-8", "replace")):
                    say("  " + line.decode("utf-8", "replace").rstrip())
                if timeout and time.time() - start > timeout:
                    p.kill()
                    f.write(b"\n[timed out]\n")
                    return 124
            return p.wait()
        except FileNotFoundError:
            return 127


def constraints_file(work):
    """pip may never replace the pod's torch (template "PyTorch 2.8.0"): pin what is installed."""
    path = os.path.join(work, "constraints.txt")
    lines = []
    for mod, pkg in (("torch", "torch"), ("torchvision", "torchvision"), ("torchaudio", "torchaudio"), ("triton", "triton")):
        try:
            m = __import__(mod)
            v = getattr(m, "__version__", None)
            if v:
                lines.append("%s==%s" % (pkg, v))
        except Exception:  # noqa: BLE001
            pass
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")
    return path


def setup_fixer(args, fdir):
    """Make a venv that can run Fixer. Returns its python, or None (with the reason printed)."""
    os.makedirs(fdir, exist_ok=True)
    ready, failed = os.path.join(fdir, "READY"), os.path.join(fdir, "FAILED")
    log = os.path.join(fdir, "setup.log")
    if os.path.exists(ready):
        say("  NVIDIA Fixer is already set up.")
        return open(ready).read().strip()
    if os.path.exists(failed) and not args.retry_fixer:
        say("  NVIDIA Fixer could not be set up on an earlier run (%s)." % open(failed).read().strip())
        say("  Using the gentle clean-up only. (--retry-fixer tries again.)")
        return None

    def give_up(reason):
        with open(failed, "w") as f:
            f.write(reason)
        say("  ✗ NVIDIA Fixer could not be set up: %s" % reason)
        say("    Details: %s" % log)
        say("    Carrying on with the gentle classical clean-up (still a good result).")
        return None

    say("  Setting up NVIDIA Fixer — one time, about 15–40 minutes (it builds NVIDIA's Transformer Engine).")
    say("  If it cannot be set up, the gentle classical clean-up is used instead; nothing is lost.")
    deadline = time.time() + args.fixer_setup_minutes * 60
    left = lambda: max(60, deadline - time.time())  # noqa: E731
    venv = os.path.join(fdir, "venv")
    py = os.path.join(venv, "bin", "python")
    cons = constraints_file(fdir)
    env = dict(os.environ, PIP_BREAK_SYSTEM_PACKAGES="1", PIP_DISABLE_PIP_VERSION_CHECK="1",
               MAX_JOBS=str(max(2, (os.cpu_count() or 4) // 2)), NVTE_FRAMEWORK="pytorch")
    if not os.path.exists(py):
        say("  · making a separate Python environment for Fixer (the main one is not touched)")
        if run_logged([sys.executable, "-m", "venv", "--system-site-packages", venv], log, env) != 0:
            run_logged([sys.executable, "-m", "pip", "install", "-q", "virtualenv==20.29.3"], log, env)
            if run_logged([sys.executable, "-m", "virtualenv", "--system-site-packages", venv], log, env) != 0:
                return give_up("could not make a Python environment")
    pip = [py, "-m", "pip", "install", "-q", "-c", cons]
    src = os.path.join(fdir, "Fixer-%s" % FIXER_COMMIT)
    if not os.path.isdir(src):
        say("  · downloading Fixer's code (Apache-2.0) @ %s" % FIXER_COMMIT[:12])
        tgz = os.path.join(fdir, "fixer.tar.gz")
        try:
            download("https://codeload.github.com/nv-tlabs/Fixer/tar.gz/%s" % FIXER_COMMIT, tgz)
            import tarfile  # noqa: WPS433
            with tarfile.open(tgz) as t:
                t.extractall(fdir)
        except Exception as e:  # noqa: BLE001
            return give_up("could not download its code (%s)" % e)
    say("  · installing Fixer's Python packages")
    if run_logged(pip + ["cosmos-predict2==1.0.9", "--no-deps"], log, env, left()) != 0:
        return give_up("pip could not install cosmos-predict2")
    if run_logged(pip + FIXER_BASE_DEPS, log, env, left()) != 0:
        return give_up("pip could not install its packages")
    te_ok = run_logged([py, "-c", "import transformer_engine.pytorch"], log, env) == 0
    for spec in ("transformer_engine[pytorch]==1.13.0", "transformer_engine[pytorch]==2.5.0"):
        if te_ok:
            break
        say("  · building NVIDIA Transformer Engine (%s) — the long part, 10–30 min" % spec.split("==")[1])
        run_logged(pip + ["--no-build-isolation", spec], log, env, left())
        te_ok = run_logged([py, "-c", "import transformer_engine.pytorch"], log, env) == 0
    if not te_ok:
        return give_up("NVIDIA Transformer Engine would not build for this PyTorch")
    probe = ("import sys; sys.path.insert(0, %r); import transformer_engine; "
             "import pix2pix_turbo_nocond_cosmos_base_faster_tokenizer" % os.path.join(src, "src"))
    for _ in range(25):
        code = subprocess.run([py, "-c", probe], capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL)
        if code.returncode == 0:
            break
        m = re.search(r"No module named '([^'.]+)", code.stderr)
        with open(log, "a") as f:
            f.write(code.stderr[-3000:])
        if not m:
            return give_up("its code would not load (%s)" % (code.stderr.strip().splitlines() or ["?"])[-1][:160])
        pkg = FIXER_PIP.get(m.group(1), m.group(1).replace("_", "-"))
        say("  · adding missing package %s" % pkg)
        if run_logged(pip + [pkg], log, env, left()) != 0:
            return give_up("could not install %s" % pkg)
    else:
        return give_up("too many missing packages")
    models = os.path.join(fdir, "models")
    say("  · downloading Fixer's weights from Hugging Face (%s, several GB)" % FIXER_HF_REPO)
    dl = ("from huggingface_hub import snapshot_download; "
          "snapshot_download(%r, local_dir=%r)" % (FIXER_HF_REPO, models))
    if run_logged([py, "-c", dl], log, env, left()) != 0:
        return give_up("its weights could not be downloaded (the model page may need accepting its licence first)")
    for need in ("base/model_fast_tokenizer.pt", "base/tokenizer_fast.pth", "pretrained/pretrained_fixer.pkl"):
        if not os.path.exists(os.path.join(models, need)):
            return give_up("the weights are not laid out as expected (no %s)" % need)
    with open(os.path.join(fdir, "driver.py"), "w") as f:
        f.write(FIXER_DRIVER)
    with open(ready, "w") as f:
        f.write(py)
    if os.path.exists(failed):
        os.remove(failed)
    say("  ✓ NVIDIA Fixer is ready.")
    return py


def run_fixer(py, fdir, renders, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    src = os.path.join(fdir, "Fixer-%s" % FIXER_COMMIT, "src")
    log = os.path.join(fdir, "run.log")
    code = run_logged([py, os.path.join(fdir, "driver.py"), src, os.path.join(fdir, "models"), renders, out_dir],
                      log, dict(os.environ), echo=lambda ln: ln.startswith("FIXER"))
    return code == 0


# ─── The colour-only fit ─────────────────────────────────────────────────────

def ssim_map(a, b):
    """SSIM (11×11 Gaussian window) of (B,3,H,W) images."""
    torch = torch_mod()
    F = torch.nn.functional
    g = torch.exp(-((torch.arange(11, device=a.device) - 5.0) ** 2) / (2 * 1.5 ** 2))
    g = (g / g.sum())
    w = (g[:, None] * g[None, :]).expand(3, 1, 11, 11).contiguous()

    def f(x):
        return F.conv2d(x, w, padding=5, groups=3)

    mu_a, mu_b = f(a), f(b)
    va, vb, cab = f(a * a) - mu_a ** 2, f(b * b) - mu_b ** 2, f(a * b) - mu_a * mu_b
    c1, c2 = 0.01 ** 2, 0.03 ** 2
    return ((2 * mu_a * mu_b + c1) * (2 * cab + c2)) / ((mu_a ** 2 + mu_b ** 2 + c1) * (va + vb + c2))


class SelectiveAdam:
    """Adam that only steps the splats seen in this batch: an unseen splat never moves."""

    def __init__(self, param, lr):
        torch = torch_mod()
        self.p, self.lr = param, lr
        self.m = torch.zeros_like(param)
        self.v = torch.zeros_like(param)
        self.t = torch.zeros(param.shape[0], dtype=torch.int32, device=param.device)

    def step(self, idx, grad, lr_scale=1.0, b1=0.9, b2=0.999, eps=1e-15):
        self.t[idx] += 1
        t = self.t[idx].float().view(-1, *([1] * (grad.dim() - 1)))
        m = self.m[idx] * b1 + (1 - b1) * grad
        v = self.v[idx] * b2 + (1 - b2) * grad * grad
        self.m[idx], self.v[idx] = m, v
        mh, vh = m / (1 - b1 ** t), v / (1 - b2 ** t)
        self.p[idx] -= self.lr * lr_scale * mh / (vh.sqrt() + eps)


def fit_colours(G, R, cams, K, W, H, items, args, ckpt, init=None, anchor=None, iters=None, batch=None, label="fit"):
    """Optimise sh0 (and lightly sh1) toward target images; geometry is never a parameter.

    items: list of (camera index, target image path, view weight, pixel-weight
    image path or None). `init`: starting colours (sh0, sh1), default the
    scene's; `anchor`: colours the regulariser pulls toward, default `init`.
    Views are batched by camera spot (`group`) so a batch's splats overlap."""
    torch = torch_mod()
    sh0 = (init[0] if init else G.sh0).clone()
    sh1 = (init[1] if init else G.sh1).clone()
    a0, a1 = (anchor if anchor else (sh0.clone(), sh1.clone()))
    batch = batch or args.batch
    opt0 = SelectiveAdam(sh0, args.lr)
    opt1 = SelectiveAdam(sh1, args.lr * args.sh1_lr_scale) if (G.deg >= 1 and args.sh1 == "fit") else None
    groups = {}
    for item in items:
        groups.setdefault(cams[item[0]]["group"], []).append(item)
    batches = []
    for g in sorted(groups):
        v = groups[g]
        for a in range(0, len(v), batch):
            batches.append(v[a:a + batch])
    iters = iters or args.iters or max(200, args.epochs * len(batches))
    start = 0
    if os.path.exists(ckpt):
        st = torch.load(ckpt, map_location=G.device)
        if st.get("n") == G.sh0.shape[0] and st.get("iters") == iters:
            sh0.copy_(st["sh0"])
            sh1.copy_(st["sh1"])
            opt0.m, opt0.v, opt0.t = st["m0"], st["v0"], st["t0"]
            if opt1 is not None and "m1" in st:
                opt1.m, opt1.v, opt1.t = st["m1"], st["v1"], st["t1"]
            start = st["it"]
            say("  resuming at iteration %d of %d" % (start, iters))
    say("  %d iterations, up to %d views a batch, %d batches an epoch" % (iters, batch, len(batches)))
    if start >= iters:
        return sh0, sh1, None, None
    rng = np.random.default_rng(1)
    order = []
    pool = ThreadPoolExecutor(max_workers=4)

    def load_batch(b):
        tg = [load_img(x[1]) for x in b]
        pw = [load_gray(x[3]) if x[3] else None for x in b]
        return tg, pw

    def next_batch():
        nonlocal order
        if not order:
            order = list(rng.permutation(len(batches)))
        return batches[order.pop()]

    for _ in range(start % max(1, len(batches))):
        next_batch()
    b = next_batch()
    fut = pool.submit(load_batch, b)
    first_loss, last_losses, t_last = None, [], time.time()
    for it in range(start, iters):
        tg, pw = fut.result()
        cur = b
        if it + 1 < iters:
            b = next_batch()
            fut = pool.submit(load_batch, b)
        bc = [cams[x[0]] for x in cur]
        idx = batch_indices(G, bc, K, W, H)
        if idx.numel() == 0:
            continue
        p0 = sh0[idx].detach().requires_grad_(True)
        p1 = sh1[idx].detach().requires_grad_(opt1 is not None)
        rgb, alpha, _ = R.render(G, idx, p0, p1, bc, K, W, H)
        tgt = torch.as_tensor(np.stack(tg), device=G.device).float() / 255.0
        wv = torch.as_tensor([x[2] for x in cur], device=G.device, dtype=torch.float32).view(-1, 1, 1, 1)
        a = alpha.detach().clamp(0, 1) * wv
        if any(p is not None for p in pw):
            pm = np.stack([p if p is not None else np.full((H, W), 255, np.uint8) for p in pw])
            a = a * (torch.as_tensor(pm, device=G.device).float() / 255.0)[..., None]
        npx = float(rgb.shape[0] * H * W)
        l1 = ((rgb - tgt).abs() * a).sum() / (a.sum() * 3 + 1e-6)
        s_ = ssim_map(rgb.permute(0, 3, 1, 2), tgt.permute(0, 3, 1, 2))
        ls = ((1 - s_) * a.permute(0, 3, 1, 2)).sum() / (a.sum() * 3 + 1e-6)
        loss = (1 - args.ssim) * l1 + args.ssim * ls
        reg = args.reg * ((p0 - a0[idx]) ** 2).sum() / npx
        if opt1 is not None:
            reg = reg + 10 * args.reg * ((p1 - a1[idx]) ** 2).sum() / npx
        (loss + reg).backward()
        lr_scale = 0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * it / iters))
        with torch.no_grad():
            opt0.step(idx, p0.grad, lr_scale)
            if opt1 is not None and p1.grad is not None:
                opt1.step(idx, p1.grad, lr_scale)
        lv = float(loss.detach())
        first_loss = lv if first_loss is None else first_loss
        last_losses = (last_losses + [lv])[-50:]
        if time.time() - t_last > 20 or it == iters - 1:
            t_last = time.time()
            say("  %s %d/%d  loss %.4f (started at %.4f)" % (label, it + 1, iters, float(np.mean(last_losses)), first_loss))
        if (it + 1) % 500 == 0 or it + 1 == iters:
            st = {"n": G.sh0.shape[0], "iters": iters, "it": it + 1, "sh0": sh0, "sh1": sh1,
                  "m0": opt0.m, "v0": opt0.v, "t0": opt0.t}
            if opt1 is not None:
                st.update(m1=opt1.m, v1=opt1.v, t1=opt1.t)
            torch.save(st, ckpt + ".tmp")
            os.replace(ckpt + ".tmp", ckpt)
    pool.shutdown()
    if args.sh1 == "zero":
        sh1.zero_()
    return sh0, sh1, first_loss, float(np.mean(last_losses)) if last_losses else None


# ─── Contact sheet ───────────────────────────────────────────────────────────

def contact_sheet(path, rows, title, heads):
    """rows: list of tuples of HxWx3 images (one column each)."""
    from PIL import Image, ImageDraw  # noqa: WPS433
    cols = len(rows[0])
    h0, w0 = rows[0][0].shape[:2]
    tw = min(560 if cols > 2 else 640, w0 * 4)
    th = int(round(h0 * tw / w0))
    pad, top = 8, 44
    sheet = Image.new("RGB", (cols * tw + (cols + 1) * pad, top + len(rows) * (th + pad) + pad), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    d.text((pad, 6), title, fill=(240, 220, 150))
    for c, h in enumerate(heads):
        d.text((pad + c * (tw + pad), 24), h, fill=(220, 220, 220))
    for i, row in enumerate(rows):
        y = top + i * (th + pad)
        for c, im in enumerate(row):
            sheet.paste(Image.fromarray(im).resize((tw, th), Image.LANCZOS), (pad + c * (tw + pad), y))
    tmp = path + ".tmp.jpg"
    sheet.save(tmp, quality=88)
    os.replace(tmp, path)


# ─── Finding things in the views: Grounding DINO + SAM 2 (both Apache-2.0) ───
# Through Hugging Face transformers; ungated repositories, no token. Grounding
# DINO turns a text prompt into boxes; SAM 2.1 turns each box into an exact
# mask. (Not Ultralytics YOLO: AGPL.)

GDINO_REPO = "IDEA-Research/grounding-dino-base"
SAM2_REPOS = ("facebook/sam2.1-hiera-large", "facebook/sam2.1-hiera-base-plus")
CAR_PROMPT = "car . van . truck . pickup truck . motorcycle . scooter . bicycle . cart ."
# Kept from the original pixels in the «as new» pass: signs, and the goods in
# shop windows (a marketplace must not misrepresent merchandise).
SIGN_PROMPT = ("signboard . shop sign . sign . text . logo . poster . banner . shop window . "
               "display window . merchandise . goods on display .")
MODEL_NOTICE = (
    "Models: Grounding DINO base (IDEA-Research, Apache-2.0) · SAM 2.1 (Meta, Apache-2.0) ·\n"
    "Qwen-Image-Edit-2511 (Alibaba Qwen, Apache-2.0, github.com/QwenLM/Qwen-Image «License Agreement»).\n"
    "All downloaded from Hugging Face without a token.")


class Segmenter:
    def __init__(self, device):
        torch = torch_mod()
        from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor  # noqa: WPS433
        self.device = device
        say("  loading Grounding DINO (%s)…" % GDINO_REPO)
        self.dp = AutoProcessor.from_pretrained(GDINO_REPO)
        self.dm = AutoModelForZeroShotObjectDetection.from_pretrained(GDINO_REPO).to(device).eval()
        self.sp = self.sm = None
        for repo in SAM2_REPOS:
            try:
                from transformers import Sam2Model, Sam2Processor  # noqa: WPS433
                say("  loading SAM 2.1 (%s)…" % repo)
                self.sp = Sam2Processor.from_pretrained(repo)
                self.sm = Sam2Model.from_pretrained(repo, torch_dtype=torch.float32).to(device).eval()
                break
            except Exception as e:  # noqa: BLE001
                say("  (SAM 2.1 %s could not be loaded: %s)" % (repo, str(e).splitlines()[0][:120]))
        if self.sm is None:
            say("  ⚠ no SAM 2: masks will be the detection boxes (coarser, still usable)")

    def masks(self, img, prompt, box_thr, text_thr, max_area=0.5):
        """→ (uint8 HxW mask 0/255, list of (label, score, box))."""
        torch = torch_mod()
        from PIL import Image  # noqa: WPS433
        H, W = img.shape[:2]
        pil = Image.fromarray(img)
        with torch.no_grad():
            inp = self.dp(images=pil, text=prompt, return_tensors="pt").to(self.device)
            out = self.dm(**inp)
            res = self.dp.post_process_grounded_object_detection(
                out, inp["input_ids"], threshold=box_thr, text_threshold=text_thr, target_sizes=[(H, W)])[0]
        labels = res.get("text_labels", res.get("labels"))
        dets = []
        for box, sc, lb in zip(res["boxes"].tolist(), res["scores"].tolist(), labels):
            x0, y0, x1, y1 = box
            if (x1 - x0) * (y1 - y0) > max_area * W * H:
                continue  # a box over half the view is a wrong guess (the whole street)
            dets.append((str(lb), float(sc), [x0, y0, x1, y1]))
        mask = np.zeros((H, W), np.uint8)
        if not dets:
            return mask, dets
        boxes = [d[2] for d in dets]
        if self.sm is not None:
            try:
                with torch.no_grad():
                    si = self.sp(images=pil, input_boxes=[boxes], return_tensors="pt").to(self.device)
                    so = self.sm(**si, multimask_output=False)
                    ms = self.sp.post_process_masks(so.pred_masks.cpu(), si["original_sizes"])[0]
                ms = ms.reshape(-1, H, W).numpy() > 0
                mask[ms.any(0)] = 255
                return mask, dets
            except Exception as e:  # noqa: BLE001
                say("  (SAM 2 failed on a view, using boxes: %s)" % str(e).splitlines()[0][:100])
        for x0, y0, x1, y1 in boxes:
            mask[int(max(0, y0)):int(min(H, y1 + 1)), int(max(0, x0)):int(min(W, x1 + 1))] = 255
        return mask, dets


class StubSegmenter:
    """Dry run only: 'cars' are the blue splats, 'signs' the yellow ones."""

    def masks(self, img, prompt, box_thr, text_thr, max_area=0.5):
        x = img.astype(np.float32) / 255.0
        r, g, b = x[..., 0], x[..., 1], x[..., 2]
        if "car" in prompt:
            m = (b > r + 0.12) & (b > g + 0.06)
        else:
            m = (r > 0.55) & (g > 0.45) & (b < 0.35)
        return (m * 255).astype(np.uint8), ([("stub", 1.0, [0, 0, 1, 1])] if m.any() else [])


def dilate(mask, r):
    """uint8 mask dilated by r pixels (max-pool)."""
    if r <= 0:
        return mask
    torch = torch_mod()
    t = torch.as_tensor(mask, dtype=torch.float32)[None, None]
    t = torch.nn.functional.max_pool2d(t, 2 * r + 1, stride=1, padding=r)
    return t[0, 0].numpy().astype(np.uint8)


def detect_all(seg, src_dir, names, out_dir, prompt, args, which=None):
    """A mask per view (PNG), resumable. `which`: view indices (default all)."""
    os.makedirs(out_dir, exist_ok=True)
    which = range(len(names)) if which is None else which
    todo = [i for i in which if not os.path.exists(os.path.join(out_dir, names[i] + ".png"))]
    say("  %d views to look at (%d already done)" % (len(todo), len(list(which)) - len(todo)))
    found, last = 0, time.time()
    for k, i in enumerate(todo):
        m, dets = seg.masks(load_img(os.path.join(src_dir, names[i])), prompt, args.box_threshold, args.text_threshold)
        found += bool(dets)
        save_gray(os.path.join(out_dir, names[i] + ".png"), m)
        if time.time() - last > 20:
            last = time.time()
            say("  looked at %d of %d views (something found in %d)" % (k + 1, len(todo), found))


# ─── Stage: car removal (the ONLY stage that changes geometry) ───────────────

def components(keys):
    """Connected groups of occupied voxels (26-neighbourhood). keys: (M,3) int."""
    index = {}
    for i, k in enumerate(map(tuple, keys)):
        index.setdefault(k, []).append(i)
    seen, comps = set(), []
    nb = [(a, b, c) for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1) if (a, b, c) != (0, 0, 0)]
    for start in index:
        if start in seen:
            continue
        stack, members = [start], []
        seen.add(start)
        while stack:
            v = stack.pop()
            members.extend(index[v])
            for d in nb:
                w = (v[0] + d[0], v[1] + d[1], v[2] + d[2])
                if w in index and w not in seen:
                    seen.add(w)
                    stack.append(w)
        comps.append(np.array(members))
    return comps


def fit_ground(pts, rng, iters=300, thr=0.05):
    """RANSAC plane y = a·x + b·z + c through the lowest band of pts (viewer coords, y up)."""
    if len(pts) < 3:
        return None
    best, best_n = None, -1
    for _ in range(iters):
        s = pts[rng.choice(len(pts), 3, replace=False)]
        A = np.c_[s[:, 0], s[:, 2], np.ones(3)]
        try:
            a, b, c = np.linalg.solve(A, s[:, 1])
        except np.linalg.LinAlgError:
            continue
        if abs(a) > 0.5 or abs(b) > 0.5:
            continue  # a ground is not steeper than ~27°
        n = np.count_nonzero(np.abs(pts[:, 0] * a + pts[:, 2] * b + c - pts[:, 1]) < thr)
        if n > best_n:
            best, best_n = (a, b, c), n
    if best is None:
        return None
    a, b, c = best
    inl = pts[np.abs(pts[:, 0] * a + pts[:, 2] * b + c - pts[:, 1]) < thr]
    if len(inl) >= 3:
        A = np.c_[inl[:, 0], inl[:, 2], np.ones(len(inl))]
        a, b, c = np.linalg.lstsq(A, inl[:, 1], rcond=None)[0]
    return a, b, c


def quat_z_to(n):
    """Quaternions (w,x,y,z) turning +z onto unit normals n (M,3)."""
    w = 1.0 + n[:, 2]
    q = np.stack([w, -n[:, 1], n[:, 0], np.zeros(len(n))], 1)
    bad = w < 1e-6
    q[bad] = [0.0, 1.0, 0.0, 0.0]
    return (q / np.linalg.norm(q, axis=1, keepdims=True)).astype(np.float32)


def remove_cars(s, cams, K, W, H, T, mask_dir, names, args, device, backend):
    """Vote car masks onto splats, delete the cars, lay new ground where they stood.
    → (new Splats or None, report dict)."""
    torch = torch_mod()
    G = SceneGPU(s, device, max_deg=1)
    R = Renderer(backend, s.antialiased)
    N = s.n
    vis = torch.zeros(N, dtype=torch.int32, device=device)
    hit = torch.zeros(N, dtype=torch.int32, device=device)
    last = time.time()
    with torch.no_grad():
        for i, c in enumerate(cams):
            mp = os.path.join(mask_dir, names[i] + ".png")
            if not os.path.exists(mp):
                continue
            m = torch.as_tensor(load_gray(mp) > 127, device=device)
            idx = G.visible(c["w2c"], K, W, H)
            if idx.numel() == 0:
                continue
            _, alpha, dep = R.render(G, idx, G.sh0[idx], G.sh1[idx], [c], K, W, H, depth=True)
            dep = dep[0, ..., 0]
            Rw = torch.as_tensor(c["w2c"][:3, :3], dtype=torch.float32, device=device)
            tw = torch.as_tensor(c["w2c"][:3, 3], dtype=torch.float32, device=device)
            p = G.means[idx] @ Rw.T + tw
            z = p[:, 2]
            ok = z > 0.05
            u = (K[0, 0] * p[:, 0] / z.clamp_min(1e-6) + K[0, 2]).floor().long()
            v = (K[1, 1] * p[:, 1] / z.clamp_min(1e-6) + K[1, 2]).floor().long()
            ok &= (u >= 0) & (u < W) & (v >= 0) & (v < H)
            uu, vv = u.clamp(0, W - 1), v.clamp(0, H - 1)
            ok &= z <= dep[vv, uu] * 1.04 + 0.5 * G.radius[idx]  # in front, not hidden
            ok &= alpha[0, vv, uu, 0] > 0.3
            vis[idx[ok]] += 1
            hit[idx[ok & m[vv, uu]]] += 1
            if time.time() - last > 20:
                last = time.time()
                say("  voting: %d of %d views" % (i + 1, len(cams)))
    vis_np, hit_np = vis.cpu().numpy(), hit.cpu().numpy()
    car = (vis_np >= args.car_min_views) & (hit_np >= args.car_ratio * np.maximum(vis_np, 1))
    report = {"voted": int(car.sum()), "cars": 0, "deleted": 0, "added": 0, "skipped": []}
    say("  %s splats are on cars in most of the views that see them" % f"{int(car.sum()):,}")
    if car.sum() == 0:
        return None, report
    local = s.means.astype(np.float64) * np.diag(T)  # viewer coords (y up); T is ±diag
    rng = np.random.default_rng(3)
    keep = np.ones(N, bool)
    adds = []
    vox = np.floor(local[car] / args.car_voxel).astype(np.int64)
    car_idx = np.nonzero(car)[0]
    for comp in components(vox):
        if len(comp) < args.car_min_splats:
            continue
        pts = local[car_idx[comp]]
        lo, hi = np.percentile(pts, 2, 0), np.percentile(pts, 98, 0)
        size = hi - lo
        if max(size[0], size[2]) > args.car_max_size or size[1] > args.car_max_size / 3:
            report["skipped"].append("a group %.1f×%.1f×%.1f is too big to be a vehicle" % tuple(size))
            continue
        e = args.car_margin
        inx = (local[:, 0] > lo[0] - e) & (local[:, 0] < hi[0] + e) & (local[:, 2] > lo[2] - e) & (local[:, 2] < hi[2] + e)
        rr = args.car_ring
        ring = (local[:, 0] > lo[0] - rr) & (local[:, 0] < hi[0] + rr) & (local[:, 2] > lo[2] - rr) & \
               (local[:, 2] < hi[2] + rr) & ~inx & (local[:, 1] < lo[1] + 0.6) & keep
        rp = local[ring]
        plane = None
        if len(rp) >= 30:
            band = rp[rp[:, 1] <= np.percentile(rp[:, 1], 40)]
            plane = fit_ground(band, rng)
        if plane is None:
            keep[car_idx[comp]] = False  # cannot see the ground around it: just remove the vehicle
            report["skipped"].append("no ground found around a vehicle: removed without filling")
            report["cars"] += 1
            continue
        a, b, c0 = plane
        gy = local[:, 0] * a + local[:, 2] * b + c0
        gone = inx & (local[:, 1] > gy - 0.05) & (local[:, 1] < hi[1] + 0.3)
        keep &= ~gone
        keep[car_idx[comp]] = False
        ground = ring & (np.abs(local[:, 1] - gy) < 0.08)
        gi = np.nonzero(ground)[0]
        if len(gi) < 10:
            report["skipped"].append("too little road around a vehicle to copy its colour")
            report["cars"] += 1
            continue
        gscale = float(np.median(np.exp(s.log_scales[gi]).max(1)))
        sp = float(np.clip(1.5 * gscale, args.fill_min, args.fill_max))
        xs = np.arange(lo[0] - e, hi[0] + e, sp)
        zs = np.arange(lo[2] - e, hi[2] + e, sp)
        gx, gz = np.meshgrid(xs, zs, indexing="ij")
        gx = gx.ravel() + rng.uniform(-0.3, 0.3, gx.size) * sp
        gz = gz.ravel() + rng.uniform(-0.3, 0.3, gz.size) * sp
        gyy = gx * a + gz * b + c0 + 0.002
        newp = np.stack([gx, gyy, gz], 1)
        # colour: the 8 nearest road splats around, plus their own texture
        gcol = s.sh0[gi]
        gl = local[gi][:, [0, 2]]
        tg = torch_mod().as_tensor(gl, dtype=torch_mod().float32)
        cols = []
        for a_ in range(0, len(newp), 20000):
            q = torch_mod().as_tensor(newp[a_:a_ + 20000][:, [0, 2]], dtype=torch_mod().float32)
            d = torch_mod().cdist(q, tg)
            nn = d.topk(min(8, len(gi)), largest=False).indices.numpy()
            cols.append(gcol[nn].mean(1))
        col = np.concatenate(cols)
        col = col + rng.normal(0, 1, col.shape) * gcol.std(0) * 0.5
        nrm = np.array([-a, 1.0, -b])
        nrm /= np.linalg.norm(nrm)
        nf = np.tile(nrm * np.diag(T), (len(newp), 1))
        adds.append({
            "means": (newp * np.diag(T)).astype(np.float32), "quats": quat_z_to(nf),
            "log_scales": np.log(np.tile([sp * 0.75, sp * 0.75, sp * 0.08], (len(newp), 1))).astype(np.float32),
            "opacity_logits": np.full(len(newp), 3.0, np.float32), "sh0": col.astype(np.float32)})
        report["cars"] += 1
    deleted = int((~keep).sum())
    if deleted > args.car_max_fraction * N:
        report["skipped"].append("would delete %.0f%% of the scene — refused" % (100 * deleted / N))
        say("  ✗ car removal would delete %.0f%% of the scene; skipping it (check the masks in %s)" % (100 * deleted / N, mask_dir))
        return None, report
    add = {k: np.concatenate([d[k] for d in adds]) for k in adds[0]} if adds else None
    report["deleted"], report["added"] = deleted, int(add["means"].shape[0]) if add else 0
    for msg in report["skipped"]:
        say("  note: " + msg)
    say("  %d vehicle(s): %s splats deleted, %s new road splats laid" % (
        report["cars"], f"{deleted:,}", f"{report['added']:,}"))
    if report["cars"] == 0:
        return None, report
    return s.edited(keep, add), report


# ─── Stage: generative "as new" (Qwen-Image-Edit-2511, Apache-2.0) ───────────

QWEN_REPO = "Qwen/Qwen-Image-Edit-2511"
RENOVATE_PROMPT = (
    "The same street, freshly renovated: new smooth dark asphalt, clean new plaster and bricks, "
    "newly painted doors and shutters, no stains, no dirt, no litter. Keep every shape, window, door, "
    "awning and the camera view exactly identical. Do not change any text, letters or signboards. "
    "Photorealistic, same daylight.")
REFERENCE_PROMPT = (
    " Edit Picture 1. Picture 2 is a neighbouring view of the same street that is already renovated: "
    "match its materials and colours. Output only the renovated Picture 1, same view.")
NEGATIVE_PROMPT = ("different viewpoint, new objects, new text, changed signboard, changed letters, people, cars, "
                   "blurry, distorted geometry, cartoon, painting")


class Editor:
    def __init__(self, device):
        torch = torch_mod()
        from diffusers import QwenImageEditPlusPipeline  # noqa: WPS433
        say("  loading %s (about 58 GB the first time; bf16)…" % QWEN_REPO)
        self.pipe = QwenImageEditPlusPipeline.from_pretrained(QWEN_REPO, torch_dtype=torch.bfloat16)
        vram = torch.cuda.get_device_properties(device).total_memory / 2 ** 30
        if vram >= 70:
            self.pipe.to(device)
        else:
            say("  (%.0f GB of GPU memory: parts of the model wait in system memory — slower)" % vram)
            self.pipe.enable_model_cpu_offload()
        self.pipe.set_progress_bar_config(disable=True)
        self.device = device

    def edit(self, img, ref, steps, cfg, seed):
        torch = torch_mod()
        from PIL import Image  # noqa: WPS433
        H, W = img.shape[:2]
        images = [Image.fromarray(img)] + ([Image.fromarray(ref)] if ref is not None else [])
        prompt = RENOVATE_PROMPT + (REFERENCE_PROMPT if ref is not None else "")
        with torch.inference_mode():
            out = self.pipe(image=images, prompt=prompt, negative_prompt=NEGATIVE_PROMPT, true_cfg_scale=cfg,
                            guidance_scale=1.0, num_inference_steps=steps, height=H, width=W,
                            generator=torch.Generator(device="cpu").manual_seed(seed)).images[0]
        if out.size != (W, H):
            out = out.resize((W, H), Image.LANCZOS)
        return np.array(out.convert("RGB"))


class StubEditor:
    """Dry run only: 'renovates' by brightening and smoothing — and, on purpose,
    repaints the yellow sign red, so the check can prove signs are put back."""

    def edit(self, img, ref, steps, cfg, seed):
        x = img.astype(np.float32) / 255.0
        torch = torch_mod()
        t = torch.as_tensor(x).permute(2, 0, 1)[None]
        t = box(t, 1)[0].permute(1, 2, 0).numpy()
        y = np.clip(t * 1.12 + 0.03, 0, 1)
        sign = (x[..., 0] > 0.55) & (x[..., 1] > 0.45) & (x[..., 2] < 0.35)
        y[sign] = [0.9, 0.1, 0.1]
        return (y * 255 + 0.5).astype(np.uint8)


def pick_key_views(cams, n):
    """Up to n views spread evenly along the route (eye-level views first)."""
    cand = [i for i, c in enumerate(cams) if c["kind"] in ("fwd", "around")] or list(range(len(cams)))
    if len(cand) <= n:
        return cand
    return sorted(set(cand[int(round(j * (len(cand) - 1) / max(1, n - 1)))] for j in range(n)))


def edit_views(editor, seg, G, R, cams, key, K, args, edir, device):
    """Render key views at the edit size, renovate them in route order (each
    with its renovated neighbour as a reference), put signboards and anything
    not in the scene (sky) back from the original, and store at the fit size
    with a weight per view and per pixel. → list of (cam, target, weight, pixel weights)."""
    torch = torch_mod()
    W, H = args.width, args.height
    eW = args.edit_width
    eH = int(round(eW * H / W))
    if eW % 16 == 0:
        eH = max(16, int(round(eH / 16.0)) * 16)
    Ke = K.copy()
    Ke[0] *= eW / W
    Ke[1] *= eH / H
    os.makedirs(edir, exist_ok=True)
    weights_path = os.path.join(edir, "weights.json")
    weights = json.load(open(weights_path)) if os.path.exists(weights_path) else {}
    prev = None  # (camera index, renovated image at edit size)
    last = time.time()
    t0 = time.time()
    done_now = 0
    for k, i in enumerate(key):
        name = "e%05d" % i
        tgt, pwp = os.path.join(edir, name + ".jpg"), os.path.join(edir, name + "-w.png")
        full = os.path.join(edir, name + "-full.jpg")
        if os.path.exists(tgt) and os.path.exists(pwp) and name in weights:
            if os.path.exists(full):
                prev = (i, load_img(full))
            continue
        c = cams[i]
        with torch.no_grad():
            idx = G.visible(c["w2c"], Ke, eW, eH)
            rgb, alpha, _ = R.render(G, idx, G.sh0[idx], G.sh1[idx], [c], Ke, eW, eH)
        orig = to_u8(rgb)[0]
        a = alpha[0, ..., 0].cpu().numpy()
        ref = None
        if prev is not None:
            pc = cams[prev[0]]
            close = np.linalg.norm(pc["c2w"][:3, 3] - c["c2w"][:3, 3]) < args.ref_distance
            same_way = float(np.dot(pc["c2w"][:3, 2], c["c2w"][:3, 2])) > 0.7
            if close and same_way:
                ref = prev[1]
        new = editor.edit(orig, ref, args.edit_steps, args.edit_cfg, args.seed + i)
        sign, _ = seg.masks(orig, SIGN_PROMPT, args.box_threshold, args.text_threshold, max_area=0.35)
        keep_orig = np.maximum(dilate(sign, max(2, eW // 160)), ((a < 0.5) * 255).astype(np.uint8))
        soft = box(torch.as_tensor(keep_orig, dtype=torch.float32)[None, None] / 255.0, max(1, eW // 320))[0, 0].numpy()
        soft = np.maximum(soft, keep_orig / 255.0)[..., None]
        o, n_ = orig.astype(np.float32), new.astype(np.float32)
        mix = o + args.edit_mix * (n_ - o)
        comp = (mix * (1 - soft) + o * soft + 0.5).clip(0, 255).astype(np.uint8)
        # how much to trust it: a view the model re-drew is worth less; pixels it
        # changed beyond recognition (a new object) are worth little
        go = o.mean(2) / 255.0
        gn = comp.astype(np.float32).mean(2) / 255.0
        ss = float(ssim_map(torch.as_tensor(np.stack([go] * 3))[None], torch.as_tensor(np.stack([gn] * 3))[None]).mean())
        vw = float(np.clip((ss - 0.2) / 0.4, 0.2, 1.0))
        change = np.abs(comp.astype(np.float32) - o).mean(2) / 255.0
        pw = np.where(change > 0.35, 0.3, 1.0)
        from PIL import Image  # noqa: WPS433
        save_jpg(full, comp)
        save_jpg(tgt, np.array(Image.fromarray(comp).resize((W, H), Image.LANCZOS)))
        save_gray(pwp, (np.array(Image.fromarray((pw * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR))))
        weights[name] = {"view": vw, "ssim": ss, "reference": ref is not None, "sign_pixels": int((sign > 0).sum())}
        with open(weights_path + ".tmp", "w") as f:
            json.dump(weights, f)
        os.replace(weights_path + ".tmp", weights_path)
        prev = (i, comp)
        done_now += 1
        if time.time() - last > 30 or k == len(key) - 1:
            last = time.time()
            say("  renovated %d of %d views (%.0f s per view)" % (k + 1, len(key), (time.time() - t0) / max(1, done_now)))
    return [(i, os.path.join(edir, "e%05d.jpg" % i), weights["e%05d" % i]["view"], os.path.join(edir, "e%05d-w.png" % i))
            for i in key]


# ─── The pipeline ────────────────────────────────────────────────────────────

def gpu_info(device):
    torch = torch_mod()
    if device.type != "cuda":
        return "CPU (dry run)", 0.0, 0.0
    name = torch.cuda.get_device_name(device)
    mem = torch.cuda.get_device_properties(device).total_memory / 2 ** 30
    price = next((p for k, p in GPU_PRICES if k.lower() in name.lower()), 1.59)
    return name, mem, price


def free_gpu():
    import gc  # noqa: WPS433
    gc.collect()
    torch = torch_mod()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def render_all(G, R, cams, names, K, W, H, rdir, backend):
    torch = torch_mod()
    os.makedirs(rdir, exist_ok=True)
    todo = [i for i in range(len(cams)) if not os.path.exists(os.path.join(rdir, names[i]))]
    say("  %d to render (%d already done)" % (len(todo), len(cams) - len(todo)))
    pool = ThreadPoolExecutor(max_workers=4)
    last = time.time()
    bs = 4 if backend == "gsplat" else 1
    with torch.no_grad():
        for a in range(0, len(todo), bs):
            b = todo[a:a + bs]
            bc = [cams[i] for i in b]
            idx = batch_indices(G, bc, K, W, H)
            rgb, _, _ = R.render(G, idx, G.sh0[idx], G.sh1[idx], bc, K, W, H)
            for i, img in zip(b, to_u8(rgb)):
                pool.submit(save_jpg, os.path.join(rdir, names[i]), img)
            if time.time() - last > 15:
                last = time.time()
                say("  rendered %d of %d" % (a + len(b), len(todo)))
    pool.shutdown()


def pipeline(args, scene, splats_path, work, out_dir, device, backend, stubs=False):
    torch = torch_mod()
    sid = scene["id"]
    with Stage("Reading the splats"):
        s0 = read_splats(splats_path)
        say("  %s splats, SH degree %d, from a .%s" % (f"{s0.n:,}", s0.sh_degree, s0.source_kind))
        fp0 = s0.geometry_bytes()
    W, H = args.width, args.height
    K = intrinsics(args)
    with Stage("Placing cameras"):
        cams, T = make_cameras(scene, s0, args)
        names = ["v%05d.jpg" % i for i in range(len(cams))]
        meta = {"version": VERSION, "W": W, "H": H, "hfov": args.hfov, "n": len(cams), "splats": s0.n,
                "geometry": fp0, "c2w": [np.round(c["c2w"], 6).tolist() for c in cams]}
        sig = hashlib.sha256(json.dumps(meta, sort_keys=True).encode()).hexdigest()[:16]
        vdir = os.path.join(work, "views-" + sig)
        os.makedirs(vdir, exist_ok=True)
        with open(os.path.join(vdir, "cameras.json"), "w") as f:
            json.dump(dict(meta, groups=[c["group"] for c in cams], kinds=[c["kind"] for c in cams]), f)
        say("  working folder: %s" % vdir)
    r0dir = os.path.join(vdir, "renders")
    with Stage("Rendering %d views of the original splats" % len(cams)):
        G = SceneGPU(s0, device, max_deg=1)
        R = Renderer(backend, s0.antialiased)
        render_all(G, R, cams, names, K, W, H, r0dir, backend)
        del G
        free_gpu()

    # ── Stage 1: vehicles out (geometry changes here only) ──
    s, stage_notes, seg = s0, [], None
    if args.cars:
        with Stage("Removing cars, vans, motorbikes and carts"):
            if not stubs:
                say("  " + MODEL_NOTICE.replace("\n", "\n  "))
            nc_ply = os.path.join(vdir, "nocars.ply")
            rep_path = os.path.join(vdir, "nocars.json")
            if os.path.exists(nc_ply) and os.path.exists(rep_path):
                rep = json.load(open(rep_path))
                s = read_ply(nc_ply) if rep.get("changed") else s0
                say("  already done: %s" % rep)
            else:
                seg = StubSegmenter() if stubs else Segmenter(device)
                mdir = os.path.join(vdir, "masks-vehicles")
                detect_all(seg, r0dir, names, mdir, CAR_PROMPT, args)
                s1, rep = remove_cars(s0, cams, K, W, H, T, mdir, names, args, device, backend)
                rep["changed"] = s1 is not None
                if s1 is not None:
                    # kept as a .ply: from here on the scene is the edited one
                    write_ply(nc_ply, s1, s1.sh0, s1.shrest)
                    s = read_ply(nc_ply)
                else:
                    open(nc_ply, "wb").close()
                with open(rep_path, "w") as f:
                    json.dump(rep, f)
            if s is not s0:
                stage_notes.append("%d vehicle(s) removed (%s splats out, %s road splats in)" % (
                    rep["cars"], f"{rep['deleted']:,}", f"{rep['added']:,}"))
            else:
                say("  no vehicles removed")
    fp = s.geometry_bytes()
    G = SceneGPU(s, device, max_deg=1)
    R = Renderer(backend, s.antialiased)
    if s is not s0:
        rdir = os.path.join(vdir, "renders-" + fp[:12])
        with Stage("Rendering the views again, without the vehicles"):
            render_all(G, R, cams, names, K, W, H, rdir, backend)
    else:
        rdir = r0dir

    # ── Stage 2: repair (Fixer) + the gentle clean-up of every view ──
    restorer = "classical"
    with Stage("Cleaning every view (repair + gentle clean-up)"):
        src_dir = rdir
        fixer_out = os.path.join(vdir, "fixer-" + fp[:12])
        if args.fixer != "off" and device.type == "cuda":
            say(FIXER_NOTICE)
            py = setup_fixer(args, os.path.join(args.work, "fixer"))
            if py:
                say("  · running Fixer on every view")
                if run_fixer(py, os.path.join(args.work, "fixer"), rdir, fixer_out) and \
                        all(os.path.exists(os.path.join(fixer_out, n)) for n in names):
                    src_dir, restorer = fixer_out, "fixer+classical"
                else:
                    say("  ✗ Fixer stopped part-way (see %s); using the gentle clean-up only." %
                        os.path.join(args.work, "fixer", "run.log"))
            elif args.fixer == "on":
                raise Fail("--fixer on was asked for, but Fixer could not be set up.")
        elif args.fixer != "off":
            say("  (no GPU: NVIDIA Fixer is skipped in a dry run)")
        tdir = os.path.join(vdir, "targets-%s-%s-s%.2f" % (fp[:12], restorer, args.strength))
        os.makedirs(tdir, exist_ok=True)
        rng = np.random.default_rng(2)
        pick = rng.choice(len(names), size=min(64, len(names)), replace=False)
        sample = [torch.as_tensor(load_img(os.path.join(src_dir, names[i]))).float() / 255.0 for i in pick]
        gains = global_gains(sample)
        say("  one white balance for the whole scene: R×%.3f G×%.3f B×%.3f" % tuple(float(g) for g in gains))
        todo = [n for n in names if not os.path.exists(os.path.join(tdir, n))]
        say("  gentle clean-up of %d views (strength %.2f)" % (len(todo), args.strength))
        pool = ThreadPoolExecutor(max_workers=4)
        with torch.no_grad():
            for a in range(0, len(todo), 8):
                b = todo[a:a + 8]
                x = torch.stack([torch.as_tensor(load_img(os.path.join(src_dir, n))) for n in b]).to(device)
                x = x.permute(0, 3, 1, 2).float() / 255.0
                y = classical_restore(x, gains.to(device), args.strength).permute(0, 2, 3, 1)
                for n, img in zip(b, to_u8(y)):
                    pool.submit(save_jpg, os.path.join(tdir, n), img)
        pool.shutdown()

    # ── Stage 3: generative "as new" on key views ──
    edited, key = None, []
    if args.renovate:
        with Stage("Renovating key views «as new» (walls, road, doors; signs kept)"):
            if not stubs:
                say("  " + MODEL_NOTICE.replace("\n", "\n  "))
            key = pick_key_views(cams, args.edit_views)
            edir = os.path.join(vdir, "renovated-%s-%d-%d-%.2f" % (fp[:12], args.edit_width, args.edit_steps, args.edit_mix))
            if seg is None:
                seg = StubSegmenter() if stubs else Segmenter(device)
            editor = StubEditor() if stubs else Editor(device)
            say("  %d key views, %d steps each" % (len(key), args.edit_steps))
            edited = edit_views(editor, seg, G, R, cams, key, K, args, edir, device)
            del editor
            free_gpu()
    seg = None
    free_gpu()

    # ── Stage 4: colours only, onto the frozen geometry ──
    with Stage("Re-fitting colours (positions, sizes, rotations, opacities frozen)"):
        items = [(i, os.path.join(tdir, names[i]), 1.0, None) for i in range(len(cams))]
        ck = os.path.join(vdir, "fit1-%s.pt" % os.path.basename(tdir))
        sh0, sh1, l1, l2 = fit_colours(G, R, cams, K, W, H, items, args, ck, label="clean-up fit")
        if l1 is not None:
            say("  loss %.4f → %.4f" % (l1, l2))
        if edited:
            say("  now the renovated views, starting from the cleaned colours")
            ck2 = os.path.join(vdir, "fit2-%s-%s.pt" % (os.path.basename(tdir), os.path.basename(edir)))
            a2 = argparse.Namespace(**vars(args))
            a2.reg = args.edit_reg
            n2 = max(200, args.edit_epochs * len(edited))
            sh0, sh1, l1, l2 = fit_colours(G, R, cams, K, W, H, edited, a2, ck2, init=(sh0, sh1), iters=n2,
                                           batch=2, label="renovation fit")
            if l1 is not None:
                say("  loss %.4f → %.4f" % (l1, l2))
            restorer += "+renovated"

    with Stage("Writing the restored scene"):
        sh0_np = sh0.detach().cpu().numpy().astype(np.float32)
        shrest = np.zeros_like(s.shrest)
        k1 = sh1.shape[1]
        if k1:
            shrest[:, :k1] = sh1.detach().cpu().numpy()
        # SH bands 2–3 (a master has them) are zeroed: they held the old,
        # dirty view-dependent colour, and the web copy keeps degree ≤ 1 anyway.
        os.makedirs(out_dir, exist_ok=True)
        out_ply = os.path.join(out_dir, "%s-restored.ply" % sid)
        write_ply(out_ply, s, sh0_np, shrest, extra_comments=(
            "sarekooche restore.py %s: %s" % (VERSION, ", ".join(stage_notes + ["colours: " + restorer])),))
        back = read_ply(out_ply)
        if back.n != s.n or back.geometry_bytes() != fp:
            raise Fail("Internal check failed: the written geometry differs. Not using it.")
        if s.raw is not None:
            for name in s.raw.dtype.names:
                if not (name.startswith("f_dc_") or name.startswith("f_rest_")):
                    if s.raw[name].tobytes() != back.raw[name].tobytes():
                        raise Fail("Internal check failed: column %s changed." % name)
        if s is s0:
            say("  ✓ checked: %s splats, same order, geometry bit-identical to the source" % f"{back.n:,}")
        else:
            say("  ✓ checked: %s splats (was %s: vehicles out, new road in); every kept splat's geometry"
                " bit-identical, in the same order" % (f"{back.n:,}", f"{s0.n:,}"))
        say("  %s (%.0f MB)" % (out_ply, os.path.getsize(out_ply) / 1e6))

    with Stage("Making the before/after sheet"):
        if edited:
            pool_ = [e[0] for e in edited]
            mid = {e[0]: e[1] for e in edited}
        else:
            pool_ = [i for i, c in enumerate(cams) if c["kind"] == "fwd"] or list(range(len(cams)))
            mid = {}
        pick = sorted(set(pool_[int(round(j * (len(pool_) - 1) / 7))] for j in range(min(8, len(pool_)))))
        rows = []
        with torch.no_grad():
            for i in pick:
                idx = batch_indices(G, [cams[i]], K, W, H)
                rgb, _, _ = R.render(G, idx, sh0[idx], sh1[idx], [cams[i]], K, W, H)
                ai = load_img(mid[i]) if i in mid else load_img(os.path.join(tdir, names[i]))
                rows.append((load_img(os.path.join(r0dir, names[i])), ai, to_u8(rgb)[0]))
        sheet = os.path.join(out_dir, "%s-before-after.jpg" % sid)
        contact_sheet(sheet, rows, "%s - %s" % (sid, ", ".join(stage_notes + [restorer])),
                      ["BEFORE (original splats)", "AI PICTURE (target)", "AFTER (restored splats)"])
        say("  %s" % sheet)
    return out_ply, sheet, restorer, s, s0


def synthetic_scene(path_spz, path_ply, n_target=3000):
    """A tiny y-down street: asphalt with stains, two brick walls with grime,
    a blue 'car' parked on the road and a yellow 'signboard' on a wall."""
    rng = np.random.default_rng(7)
    pts, cols, kind = [], [], []
    for _ in range(n_target // 2):  # ground: y = 0 (viewer), x in [-3, 3], z in [-10, 0]
        x, z = rng.uniform(-3, 3), rng.uniform(-10, 0)
        c = np.array([0.33, 0.33, 0.34]) + rng.normal(0, 0.02)
        if (x - 1) ** 2 + (z + 3) ** 2 < 0.5 or (x + 1.2) ** 2 + (z + 7) ** 2 < 0.6:
            c = c * 0.55  # stains
        pts.append([x, 0.0, z])
        cols.append(c)
        kind.append(0)
    for _ in range(n_target - len(pts) - 500):  # walls at x = ±3, y in [0, 3.5]
        side = rng.choice([-3.0, 3.0])
        y, z = rng.uniform(0, 3.5), rng.uniform(-10, 0)
        brick = (int(y / 0.25) + int((z + (0.2 if int(y / 0.25) % 2 else 0)) / 0.5)) % 2
        c = np.array([0.55, 0.28, 0.2]) if brick else np.array([0.62, 0.34, 0.24])
        if y < 1.0:
            c = c * (0.6 + 0.4 * y)  # grime near the ground
        if side < 0 and 2.0 < y < 2.6 and -6.5 < z < -4.5:
            c, k = np.array([0.85, 0.75, 0.15]), 2  # the signboard
        else:
            k = 0
        pts.append([side, y, z])
        cols.append(c + rng.normal(0, 0.015))
        kind.append(k)
    for _ in range(500):  # the car: a box on the road
        f = rng.integers(0, 5)
        x, y, z = rng.uniform(0.6, 1.9), rng.uniform(0.05, 1.3), rng.uniform(-6.2, -4.2)
        if f == 0:
            y = 1.3
        elif f == 1:
            x = 0.6
        elif f == 2:
            x = 1.9
        elif f == 3:
            z = -6.2
        else:
            z = -4.2
        pts.append([x, y, z])
        cols.append(np.array([0.15, 0.25, 0.75]) + rng.normal(0, 0.02))
        kind.append(1)
    local = np.array(pts, np.float64)
    n = len(local)
    file_xyz = (local @ FLIP.T).astype(np.float32)  # stored y-down, like a Splatica reconstruction
    cols = np.clip(np.array(cols), 0.02, 0.98)
    q = rng.normal(0, 1, (n, 4))
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    s = Splats(
        means=file_xyz, quats=q.astype(np.float32),
        log_scales=np.log(np.full((n, 3), 0.12) * rng.uniform(0.7, 1.3, (n, 3))).astype(np.float32),
        opacity_logits=np.full(n, 2.0, np.float32) + rng.normal(0, 0.3, n).astype(np.float32),
        sh0=((cols - 0.5) / SH_C0).astype(np.float32),
        shrest=(rng.normal(0, 0.03, (n, 3, 3))).astype(np.float32), sh_degree=1, source_kind="ply")
    write_spz(path_spz, s, version=3)
    write_ply(path_ply, s, s.sh0, s.shrest)
    return s, np.array(kind)


def dry_run_checks(work):
    """Round trips and the camera maths, on the synthetic scene."""
    os.makedirs(work, exist_ok=True)
    spz, ply = os.path.join(work, "dryrun.spz"), os.path.join(work, "dryrun.ply")
    s, kind = synthetic_scene(spz, ply)
    with Stage("Dry-run checks: PLY and SPZ round trips"):
        a = read_ply(ply)
        for k in ("means", "quats", "log_scales", "opacity_logits", "sh0", "shrest"):
            assert np.array_equal(getattr(a, k), getattr(s, k)), "PLY round trip changed " + k
        say("  PLY write → read: bit-identical")
        b = read_spz(spz)
        assert b.n == s.n and b.sh_degree == 1
        assert np.abs(b.means - s.means).max() < 1.0 / 4096 + 1e-6, "SPZ positions"
        assert np.abs(b.sh0 - s.sh0).max() < 0.5 / (SPZ_COLOR_SCALE * 255) + 1e-4, "SPZ colours"
        assert np.abs(b.log_scales - s.log_scales).max() < 1 / 32 + 1e-5, "SPZ scales"
        qa = s.quats / np.linalg.norm(s.quats, axis=1, keepdims=True)
        dots = np.abs((qa * b.quats).sum(1))
        assert dots.min() > 0.999, "SPZ rotations (min |dot| %.5f)" % dots.min()
        assert np.abs(b.shrest - s.shrest).max() < 1 / 128 + 1e-6, "SPZ SH"
        say("  SPZ v3 write → read: within quantisation (pos %.2e, rot |dot| ≥ %.5f)" %
            (np.abs(b.means - s.means).max(), dots.min()))
        spz2 = os.path.join(work, "dryrun-v2.spz")
        write_spz(spz2, s, version=2)
        c = read_spz(spz2)
        assert np.abs((qa * c.quats).sum(1)).min() > 0.99, "SPZ v2 rotations"
        say("  SPZ v2 write → read: ok")
        p2 = os.path.join(work, "from-spz.ply")
        write_ply(p2, b, b.sh0, b.shrest)
        assert read_ply(p2).geometry_bytes() == b.geometry_bytes()
        say("  SPZ-sourced PLY output: geometry bit-identical")
        # editing (the car stage's only geometry change) keeps the kept splats exact
        keep = np.ones(a.n, bool)
        keep[::7] = False
        add = {"means": np.zeros((5, 3), np.float32), "quats": np.tile([1, 0, 0, 0], (5, 1)).astype(np.float32),
               "log_scales": np.full((5, 3), -3.0, np.float32), "opacity_logits": np.ones(5, np.float32),
               "sh0": np.zeros((5, 3), np.float32)}
        e = a.edited(keep, add)
        p3 = os.path.join(work, "edited.ply")
        write_ply(p3, e, e.sh0, e.shrest)
        e2 = read_ply(p3)
        assert e2.n == keep.sum() + 5 and np.array_equal(e2.means[:keep.sum()], a.means[keep])
        assert np.array_equal(e2.quats[-5:], add["quats"])
        say("  delete + add splats → valid PLY, kept splats bit-identical and in order")
    with Stage("Dry-run checks: tour coordinates"):
        place = {"offset": [5.0, 0.0, -2.0], "yaw": 0.7, "scale": 1.3}
        v = np.array([1.0, 2.0, 3.0])
        c_, s_ = math.cos(0.7), math.sin(0.7)
        x, y, z = v * 1.3
        world = np.array([5 + x * c_ + z * s_, y, -2 - x * s_ + z * c_])  # place.ts toWorld
        assert np.allclose(to_local(place, world), v), "toLocal"
        m = look_c2w(np.zeros(3), 0.0, 0.0)
        assert np.allclose(m[:3, 2], [0, 0, -1]) and np.allclose(m[:3, 0], [1, 0, 0]) and np.allclose(m[:3, 1], [0, -1, 0])
        m = look_c2w(np.zeros(3), math.pi / 2, 0.0)
        assert np.allclose(m[:3, 2], [1, 0, 0]), "yaw +90° looks along +x (turns right)"
        n = np.array([[0, 0, 1.0], [1.0, 0, 0], [0, 1.0, 0], [0, 0, -1.0]])
        for q, nn in zip(quat_z_to(n), n):
            Rm = quat_to_rot(torch_mod().as_tensor(q[None]))[0].numpy()
            assert np.allclose(Rm @ [0, 0, 1], nn, atol=1e-5), "flat splat normal"
        say("  place.toLocal, the camera axes and flat-splat normals match")
    return ply, spz, kind


def main():
    ap = argparse.ArgumentParser(description="AI restoration of a Gaussian-splat scene: vehicles out, «as new» colours.")
    ap.add_argument("scene", nargs="?", help="scene id in the tour, e.g. iranianplaza1")
    ap.add_argument("--site", default=SITE)
    ap.add_argument("--source", help="a .ply/.spz URL or path to use instead of the tour's file")
    ap.add_argument("--work", default="/workspace/restore")
    ap.add_argument("--out", default="/workspace/out")
    ap.add_argument("--step", type=float, default=0.5, help="camera spacing along the route (scene units)")
    ap.add_argument("--width", type=int, default=1024)
    ap.add_argument("--height", type=int, default=576)
    ap.add_argument("--hfov", type=float, default=90.0)
    ap.add_argument("--max-views", type=int, default=3000)
    g = ap.add_argument_group("stages (each can be switched off; finished stages are skipped on a re-run)")
    g.add_argument("--no-cars", dest="cars", action="store_false", help="keep vehicles")
    g.add_argument("--fixer", choices=["auto", "on", "off"], default="auto", help="NVIDIA Fixer repair")
    g.add_argument("--no-renovate", dest="renovate", action="store_false", help="skip the «as new» AI edit")
    g.add_argument("--strength", type=float, default=0.6, help="gentle clean-up strength, 0..1")
    c = ap.add_argument_group("vehicle removal")
    c.add_argument("--box-threshold", type=float, default=0.35)
    c.add_argument("--text-threshold", type=float, default=0.30)
    c.add_argument("--car-ratio", type=float, default=0.5, help="share of a splat's views that must call it a vehicle")
    c.add_argument("--car-min-views", type=int, default=2)
    c.add_argument("--car-voxel", type=float, default=0.3)
    c.add_argument("--car-min-splats", type=int, default=50)
    c.add_argument("--car-max-size", type=float, default=12.0)
    c.add_argument("--car-margin", type=float, default=0.15)
    c.add_argument("--car-ring", type=float, default=1.2)
    c.add_argument("--car-max-fraction", type=float, default=0.15)
    c.add_argument("--fill-min", type=float, default=0.02)
    c.add_argument("--fill-max", type=float, default=0.15)
    r = ap.add_argument_group("renovation («as new»)")
    r.add_argument("--edit-views", type=int, default=160, help="key views renovated by the AI")
    r.add_argument("--edit-width", type=int, default=1280, help="their width (height follows)")
    r.add_argument("--edit-steps", type=int, default=24)
    r.add_argument("--edit-cfg", type=float, default=4.0)
    r.add_argument("--edit-mix", type=float, default=0.85, help="how much of the AI picture is used, 0..1")
    r.add_argument("--edit-reg", type=float, default=0.3, help="pull toward the cleaned colours in the renovation fit")
    r.add_argument("--edit-epochs", type=int, default=6)
    r.add_argument("--ref-distance", type=float, default=3.0)
    f = ap.add_argument_group("colour fit")
    f.add_argument("--epochs", type=int, default=6)
    f.add_argument("--iters", type=int, default=0, help="clean-up fit iterations (0: epochs × batches)")
    f.add_argument("--batch", type=int, default=6)
    f.add_argument("--lr", type=float, default=0.01)
    f.add_argument("--sh1-lr-scale", type=float, default=0.05)
    f.add_argument("--sh1", choices=["fit", "keep", "zero"], default="fit")
    f.add_argument("--reg", type=float, default=1.0, help="pull toward the original colours")
    f.add_argument("--ssim", type=float, default=0.2)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--retry-fixer", action="store_true")
    ap.add_argument("--fixer-setup-minutes", type=float, default=50)
    ap.add_argument("--price-per-hour", type=float, default=0.0)
    ap.add_argument("--dry-run", action="store_true", help="tiny synthetic scene, no network, models stubbed")
    ap.add_argument("--cpu", action="store_true", help="no GPU: pure-PyTorch rasteriser (dry run)")
    args = ap.parse_args()

    torch = torch_mod()
    say("Sarekooche splat restoration %s" % VERSION)
    say("Python %s · PyTorch %s · CUDA %s" % (sys.version.split()[0], torch.__version__, torch.version.cuda))
    if args.cpu or not torch.cuda.is_available():
        if not args.dry_run:
            raise Fail("No GPU found. On RunPod choose a GPU pod with the «PyTorch 2.8.0» template.")
        device, backend = torch.device("cpu"), "torch"
    else:
        device, backend = torch.device("cuda"), "gsplat"
    gpu, mem, price = gpu_info(device)
    if args.price_per_hour:
        price = args.price_per_hour
    say("Device: %s%s" % (gpu, " (%.0f GB)" % mem if mem else ""))
    stages = ["vehicles out" if args.cars else None, "Fixer repair (%s)" % args.fixer if args.fixer != "off" else None,
              "gentle clean-up", "«as new» AI on %d key views" % args.edit_views if args.renovate else None,
              "colour re-fit"]
    say("Stages: " + " → ".join(x for x in stages if x))

    if args.dry_run:
        args.work = os.path.join(args.work, "dryrun")
        args.out = os.path.join(args.out, "dryrun")
        if device.type == "cpu" and (args.width, args.height) == (1024, 576):
            args.width, args.height = 96, 54
        if args.edit_width == 1280:
            args.edit_width = 2 * args.width
        args.iters = args.iters or 60
        args.batch = min(args.batch, 3)
        args.step = 1.0
        args.edit_views = min(args.edit_views, 10)
        args.car_max_fraction = 0.4  # the toy street is 17% car
        if device.type == "cpu":
            args.fixer = "off"
        ply, spz, kind = dry_run_checks(args.work)
        route = [[0.0, 1.6, -1.0 - 0.5 * i] for i in range(17)]
        scene = {"id": "dryrun", "file": "scenes/dryrun/dryrun.spz", "flip": True, "route": route, "place": None,
                 "start": {"position": [0, 1.6, -1], "yaw": 0, "pitch": 0}}
        orig = read_spz(spz)
        out_ply, sheet, restorer, s, s0 = pipeline(args, scene, spz, args.work, args.out, device, backend, stubs=True)
        back = read_ply(out_ply)
        banner("Dry-run verdict")
        if args.cars:
            local = orig.means * np.diag(FLIP)
            car = kind == 1
            # which original splats survive? kept ones are bit-identical and in order
            from collections import Counter  # noqa: WPS433
            pool = Counter(map(bytes, np.ascontiguousarray(orig.means).view(np.uint8).reshape(orig.n, -1)))
            survived = np.zeros(orig.n, bool)
            for i, row in enumerate(np.ascontiguousarray(back.means).view(np.uint8).reshape(back.n, -1)):
                k = bytes(row)
                if pool.get(k):
                    pool[k] -= 1
            for i, row in enumerate(np.ascontiguousarray(orig.means).view(np.uint8).reshape(orig.n, -1)):
                survived[i] = pool[bytes(row)] == 0
            far = (np.abs(local[:, 0] - 1.25) > 1.6) | (np.abs(local[:, 2] + 5.2) > 1.9)
            say("  car splats removed: %d of %d" % ((~survived & car).sum(), car.sum()))
            say("  splats far from the car removed by mistake: %d" % (~survived & far).sum())
            say("  new road splats: %d" % (back.n - survived.sum()))
            assert (~survived & car).sum() >= 0.8 * car.sum(), "the car was not removed"
            assert (~survived & far).sum() == 0, "splats far from the car were removed"
            assert back.n - survived.sum() > 0, "no road was laid where the car stood"
        for k in ("means", "quats", "log_scales", "opacity_logits"):
            assert getattr(back, k).tobytes() == getattr(s, k).tobytes(), "colour fit changed geometry: " + k
        if args.renovate:
            # signs: the stub editor painted them red; the kept original must be back
            vd = [d for d in os.listdir(args.work) if d.startswith("views-")][0]
            ed = [d for d in os.listdir(os.path.join(args.work, vd)) if d.startswith("renovated-")][0]
            full = sorted(x for x in os.listdir(os.path.join(args.work, vd, ed)) if x.endswith("-full.jpg"))
            red = 0
            for fn in full:
                im = load_img(os.path.join(args.work, vd, ed, fn)).astype(int)
                red += int(((im[..., 0] > 190) & (im[..., 1] < 70) & (im[..., 2] < 70)).sum())
            say("  renovated views: %d; red (redrawn-sign) pixels left after compositing: %d" % (len(full), red))
            assert red == 0, "a signboard was redrawn"
        say("")
        say("DRY RUN OK: every stage ran; geometry exact where it must be; signs kept.")
        say("  %s\n  %s" % (out_ply, sheet))
        return

    if not args.scene or not SCENE_RE.match(args.scene):
        raise Fail("Give the scene id, e.g.:  restore.py iranianplaza1")
    os.makedirs(args.work, exist_ok=True)
    with Stage("Finding scene «%s» in the tour" % args.scene):
        site = args.site.rstrip("/")
        t = http_json(site + "/api/splats/tour")
        if not t.get("ok"):
            raise Fail("The site did not return the tour: %s" % t.get("error"))
        scene = find_scene(t["tour"], args.scene)
        base = (http_json(site + "/api/splats/config").get("base") or "").rstrip("/")
        say("  «%s»: %s, route %d points, flip %s, placed %s" % (
            scene["id"], (scene.get("title") or {}).get("en", ""), len(scene.get("route") or []),
            scene.get("flip"), "yes" if scene.get("place") else "no"))
        src, name = resolve_source(args, scene, base)
    work = os.path.join(args.work, args.scene)
    os.makedirs(work, exist_ok=True)
    with Stage("Downloading the scene"):
        if os.path.exists(src):
            local = src
        else:
            ext = ".ply" if name.lower().endswith(".ply") else ".spz"
            local = os.path.join(work, "source-" + hashlib.sha256(src.split("?")[0].encode()).hexdigest()[:10] + ext)
            download(src, local)
    out_ply, sheet, restorer, s, s0 = pipeline(args, scene, local, work, args.out, device, backend)

    total = time.time() - T0
    banner("FINISHED — %s" % args.scene)
    for title, dt in TIMINGS:
        say("  %-62s %s" % (title[:62], human_time(dt)))
    say("  %-62s %s" % ("Total (this run)", human_time(total)))
    say("")
    say("  GPU: %s (%.0f GB) · about $%.2f/hour → this run cost about $%.2f" % (gpu, mem, price, price * total / 3600))
    say("  Splats: %s before, %s after · colours: %s" % (f"{s0.n:,}", f"{s.n:,}", restorer))
    say("")
    say("  YOUR FILES (Jupyter → left panel → folder «workspace» → «out»):")
    say("    1. %s   ← look at this first" % sheet)
    say("    2. %s   ← upload this one" % out_ply)
    say("")
    say("  NEXT: open %s/operator/splats → «1 · Upload scenes» → choose %s" % (args.site.rstrip("/"), os.path.basename(out_ply)))
    say("        → change «Scene id» to:  %s   (it guesses «%s-restored» — change it!)" % (args.scene, args.scene))
    say("        → keep «convert to .spz here» ticked → Start.")
    say("        → then in «2 · Tour», under %s, press «Make the streamed copy»." % args.scene)
    say("  THEN STOP AND TERMINATE THIS POD on runpod.io so billing stops (download the files first).")


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
