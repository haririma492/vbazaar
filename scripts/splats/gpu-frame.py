#!/usr/bin/env python3
"""
THE TRAINED SPLAT'S FRAME — run inside the RunPod pod by gpu-train.sh
(nerfstudio 1.1.5 image: Python 3.10, numpy < 2). Pure numpy apart from
`rewrite-transforms`, which calls nerfstudio's own converter.

Why: the viewer (/vca/splat) turns a scene upright with `flip` (y and z change
sign): it expects COLMAP's world frame — y roughly down, as the first camera
held it — the frame Brush's .ply comes out in (lib/splats/cameras.ts). Out of
the box nerfstudio gives neither:

  1. ns-process-data writes transforms.json in its own world: COLMAP's
     (x, y, z) becomes (x, z, -y) — z up (nerfstudio/process_data/colmap_utils.py
     `colmap_to_json`, lines 446-449 and 475-479 at v1.1.5). Undone by
     `rewrite-transforms`: the same function with
     keep_original_world_coordinate=True, and "applied_transform" written as
     the identity (without it the dataparser assumes an old default,
     nerfstudio_dataparser.py lines 323-329).
  2. ns-train's dataparser moves, turns and scales the cameras before
     training (nerfstudio_dataparser.py lines 236-249): with
     `--orientation-method none` it only subtracts the cameras' mean
     (camera_utils.py `auto_orient_and_center_poses`, lines 621-625) and then
     divides by the largest coordinate (`auto_scale_poses`). Splatfacto must
     train at that scale (its densify/cull thresholds are absolute:
     splatfacto.py lines 163-171, `scene_scale=1.0` line 332), and ns-export
     writes the trained means as they are (exporter.py lines 577-583) — so the
     .ply comes out in the dataparser frame  p = s·(R·X + t), with R, t and s
     saved in dataparser_transforms.json (base_dataparser.py lines 84-91;
     trainer.py lines 236-238).
     `unnormalize` maps it back: X = Rᵀ·(p/s − t); every splat's log-scale
     loses ln s. R is the identity here (orientation "none"), so rotations and
     spherical harmonics are untouched — anything else is refused rather than
     half-converted.

The result: splat.ply and cameras.json both in COLMAP's world (normalized by
COLMAP's mapper to span ~10 units: colmap 3.9.1 sfm/incremental_mapper.cc
line 721, Reconstruction::Normalize(extent = 10)), like a Brush scene.

Two helpers for the steps before, same file so the pod gets one script:

  pick-frames: of the frames ffmpeg cut, the sharpest in each run of
     consecutive ones (variance of the Laplacian — a walking phone's frames
     blur, and blurred frames both fail COLMAP and smear the splat).
  largest-model: COLMAP's mapper splits a video it cannot join into several
     models (sparse/0, sparse/1, …), and sparse/0 is not always the biggest;
     the one with most registered images is trained.

  gpu-frame.py pick-frames <candidates-dir> <images-dir> <how-many>
  gpu-frame.py largest-model <sparse-dir>
  gpu-frame.py rewrite-transforms <data-dir> [<model-dir>]
  gpu-frame.py unnormalize <in.ply> <dataparser_transforms.json> <out.ply>
  gpu-frame.py cameras <transforms.json> <cameras.json>
  gpu-frame.py self-test
"""

import json
import math
import sys

import numpy as np

PLY_TYPES = {
    "float": "<f4", "float32": "<f4", "double": "<f8", "float64": "<f8",
    "uchar": "u1", "uint8": "u1", "char": "i1", "int8": "i1",
    "short": "<i2", "int16": "<i2", "ushort": "<u2", "uint16": "<u2",
    "int": "<i4", "int32": "<i4", "uint": "<u4", "uint32": "<u4",
}
IDENTITY_3X4 = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0]]


def read_ply(path):
    """A binary little-endian PLY with one vertex element: (header lines, structured array)."""
    with open(path, "rb") as f:
        header = []
        while True:
            line = f.readline()
            if not line:
                raise ValueError(f"{path}: no end_header")
            text = line.decode("ascii", "replace").rstrip("\r\n")
            header.append(text)
            if text == "end_header":
                break
        if "format binary_little_endian 1.0" not in header:
            raise ValueError(f"{path}: only binary little-endian PLY is supported")
        count, fields, elements = 0, [], 0
        for text in header:
            parts = text.split()
            if parts[:1] == ["element"]:
                elements += 1
                if parts[1] != "vertex":
                    raise ValueError(f"{path}: unexpected element {parts[1]}")
                count = int(parts[2])
            elif parts[:1] == ["property"]:
                if parts[1] == "list":
                    raise ValueError(f"{path}: list properties are not supported")
                fields.append((parts[2], PLY_TYPES[parts[1]]))
        if elements != 1:
            raise ValueError(f"{path}: expected one vertex element")
        data = np.fromfile(f, dtype=np.dtype(fields), count=count)
        if data.shape[0] != count:
            raise ValueError(f"{path}: {data.shape[0]} of {count} vertices")
    return header, data


def write_ply(path, header, data):
    with open(path, "wb") as f:
        f.write(("\n".join(header) + "\n").encode("ascii"))
        data.tofile(f)


def load_dataparser(path):
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    m = np.array(d["transform"], dtype=np.float64)
    s = float(d["scale"])
    if m.shape != (3, 4) or not np.isfinite(m).all() or not (math.isfinite(s) and s > 0):
        raise ValueError(f"{path}: not a nerfstudio dataparser transform")
    return m[:, :3], m[:, 3], s


def unnormalize(src, transforms_path, dst):
    """The exported splat, from the dataparser frame back to the data (COLMAP) frame."""
    r, t, s = load_dataparser(transforms_path)
    if not np.allclose(r, np.eye(3), atol=1e-5):
        raise ValueError("the dataparser turned the scene (orientation method is not «none»): refusing to half-convert it")
    header, data = read_ply(src)
    names = data.dtype.names
    for k in ("x", "y", "z", "scale_0", "scale_1", "scale_2"):
        if k not in names:
            raise ValueError(f"{src}: no «{k}» property — not a Gaussian-splat PLY")
    p = np.stack([data["x"], data["y"], data["z"]], axis=1).astype(np.float64)
    x = (p / s - t) @ r  # Rᵀ·v for each row v is v·R
    data["x"], data["y"], data["z"] = x[:, 0], x[:, 1], x[:, 2]
    for k in ("scale_0", "scale_1", "scale_2"):  # log-scales
        data[k] = data[k].astype(np.float64) - math.log(s)
    header = [h for h in header if not h.lower().startswith("comment vertical axis")]
    header.insert(2, "comment sarekooche: COLMAP world frame (y down), un-normalized from the nerfstudio dataparser frame")
    write_ply(dst, header, data)
    return data.shape[0], s


def cameras(transforms_path, dst):
    """cameras.json — [{img_name, position}] in transforms.json's frame (lib/splats/cameras.ts reads it)."""
    with open(transforms_path, encoding="utf-8") as f:
        meta = json.load(f)
    applied = meta.get("applied_transform")
    if applied is None or not np.allclose(np.array(applied, dtype=np.float64), np.array(IDENTITY_3X4), atol=1e-9):
        raise ValueError("transforms.json is not in COLMAP's frame (run rewrite-transforms first)")
    out = []
    for i, fr in enumerate(meta.get("frames", [])):
        m = np.array(fr["transform_matrix"], dtype=np.float64)
        pos = m[:3, 3]
        if not np.isfinite(pos).all():
            continue
        name = str(fr.get("file_path", i)).split("/")[-1]
        out.append({"id": i, "img_name": name, "position": [float(v) for v in pos]})
    if len(out) < 2:
        raise ValueError("fewer than two camera positions in transforms.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump({"frame": "colmap", "cameras": out}, f)
    return len(out)


def rewrite_transforms(data_dir, model_dir=None):
    """transforms.json and sparse_pc.ply, in COLMAP's own world (see 1. above), from one COLMAP model."""
    from pathlib import Path
    from nerfstudio.process_data import colmap_utils  # pylint: disable=import-outside-toplevel

    d = Path(data_dir)
    n = colmap_utils.colmap_to_json(
        recon_dir=Path(model_dir) if model_dir else d / "colmap" / "sparse" / "0", output_dir=d, keep_original_world_coordinate=True,
    )
    path = d / "transforms.json"
    meta = json.loads(path.read_text(encoding="utf-8"))
    meta["applied_transform"] = IDENTITY_3X4
    path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return n


def sharpness(path):
    """Variance of the 4-neighbour Laplacian of the grey image, at ≤ 640 px wide: higher is sharper."""
    from PIL import Image  # pylint: disable=import-outside-toplevel

    with Image.open(path) as im:
        g = im.convert("L")
        if g.width > 640:
            g = g.resize((640, max(1, round(g.height * 640 / g.width))))
        a = np.asarray(g, dtype=np.float32)
    return laplacian_variance(a)


def laplacian_variance(a):
    if a.shape[0] < 3 or a.shape[1] < 3:
        return 0.0
    lap = -4 * a[1:-1, 1:-1] + a[:-2, 1:-1] + a[2:, 1:-1] + a[1:-1, :-2] + a[1:-1, 2:]
    return float(lap.var())


def pick_windows(scores, want):
    """Indices of the best score in each of `want` runs of consecutive candidates (all, if there are fewer)."""
    n = len(scores)
    if n <= want:
        return list(range(n))
    edges = np.linspace(0, n, want + 1)
    out = []
    for k in range(want):
        lo, hi = int(round(edges[k])), int(round(edges[k + 1]))
        if hi > lo:
            out.append(lo + int(np.argmax(scores[lo:hi])))
    return out


def pick_frames(cand_dir, images_dir, want):
    """The sharpest frame of each window, moved to images_dir as frame_00001.jpg … in filming order."""
    import os  # pylint: disable=import-outside-toplevel

    names = sorted(f for f in os.listdir(cand_dir) if f.lower().endswith((".jpg", ".jpeg", ".png")))
    if not names:
        raise ValueError("ffmpeg cut no frames")
    scores = [sharpness(os.path.join(cand_dir, f)) for f in names]
    keep = pick_windows(scores, want)
    os.makedirs(images_dir, exist_ok=True)
    ext = os.path.splitext(names[0])[1].lower()
    for i, k in enumerate(keep, start=1):
        os.replace(os.path.join(cand_dir, names[k]), os.path.join(images_dir, f"frame_{i:05d}{ext}"))
    kept = sorted(scores[k] for k in keep)
    every = sorted(scores)
    return len(names), len(keep), float(np.median(every)), float(np.median(kept))


def registered_images(model_dir):
    """How many images a COLMAP model holds: images.bin starts with that count (uint64, little endian)."""
    import os  # pylint: disable=import-outside-toplevel

    path = os.path.join(model_dir, "images.bin")
    try:
        with open(path, "rb") as f:
            head = f.read(8)
    except OSError:
        return 0
    return int(np.frombuffer(head, dtype="<u8")[0]) if len(head) == 8 else 0


def largest_model(sparse_dir):
    """(the sub-folder with most registered images, its count, every model's count) — (None, 0, {}) when none."""
    import os  # pylint: disable=import-outside-toplevel

    counts = {}
    if os.path.isdir(sparse_dir):
        for name in sorted(os.listdir(sparse_dir)):
            d = os.path.join(sparse_dir, name)
            if os.path.isdir(d):
                counts[name] = registered_images(d)
    if not counts or max(counts.values()) == 0:
        return None, 0, counts
    best = max(counts, key=lambda k: (counts[k], -int(k) if k.isdigit() else 0))
    return os.path.join(sparse_dir, best), counts[best], counts


def self_test():
    """Round trip with synthetic numbers: what the dataparser does, undone."""
    import os
    import tempfile

    rng = np.random.default_rng(1)
    n = 500
    world = rng.normal(size=(n, 3)) * 4 + np.array([3.0, -1.0, 7.0])
    log_scale = rng.normal(size=(n, 3)) - 3
    mean = np.array([2.5, -0.5, 6.0])
    s = 0.137
    # The dataparser, orientation "none": p = s·(X − mean); scales × s.
    p = s * (world - mean)
    fields = [("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("nx", "<f4"), ("ny", "<f4"), ("nz", "<f4"),
              ("f_dc_0", "<f4"), ("opacity", "<f4"), ("scale_0", "<f4"), ("scale_1", "<f4"), ("scale_2", "<f4"),
              ("rot_0", "<f4"), ("rot_1", "<f4"), ("rot_2", "<f4"), ("rot_3", "<f4")]
    data = np.zeros(n, dtype=np.dtype(fields))
    data["x"], data["y"], data["z"] = p[:, 0], p[:, 1], p[:, 2]
    for i in range(3):
        data[f"scale_{i}"] = log_scale[:, i] + math.log(s)
    data["rot_0"] = 1
    data["opacity"] = 0.5
    header = ["ply", "format binary_little_endian 1.0", "comment Vertical Axis: z", f"element vertex {n}"]
    header += [f"property float {k}" for k, _ in fields] + ["end_header"]
    with tempfile.TemporaryDirectory() as tmp:
        src, dst, dpt = (os.path.join(tmp, f) for f in ("a.ply", "b.ply", "dp.json"))
        write_ply(src, header, data)
        with open(dpt, "w", encoding="utf-8") as f:
            json.dump({"transform": [[1, 0, 0, -mean[0]], [0, 1, 0, -mean[1]], [0, 0, 1, -mean[2]]], "scale": s}, f)
        count, _ = unnormalize(src, dpt, dst)
        h2, back = read_ply(dst)
        got = np.stack([back["x"], back["y"], back["z"]], axis=1)
        assert count == n
        assert np.abs(got - world).max() < 1e-3 * np.abs(world).max(), "positions"
        for i in range(3):
            assert np.abs(back[f"scale_{i}"] - log_scale[:, i]).max() < 1e-4, "scales"
        assert (back["rot_0"] == 1).all() and (back["opacity"] == 0.5).all(), "untouched fields"
        assert not any(h.lower().startswith("comment vertical axis") for h in h2), "stale axis comment"
        # A turned dataparser frame is refused.
        with open(dpt, "w", encoding="utf-8") as f:
            json.dump({"transform": [[0, -1, 0, 0], [1, 0, 0, 0], [0, 0, 1, 0]], "scale": s}, f)
        try:
            unnormalize(src, dpt, dst)
            raise AssertionError("a rotation should be refused")
        except ValueError:
            pass
        # cameras.json from a COLMAP-frame transforms.json.
        tj, cj = os.path.join(tmp, "transforms.json"), os.path.join(tmp, "cameras.json")
        frames = [{"file_path": f"./images/frame_{i:05d}.png",
                   "transform_matrix": [[1, 0, 0, i * 0.5], [0, 1, 0, 1.0], [0, 0, 1, -i], [0, 0, 0, 1]]} for i in range(5)]
        with open(tj, "w", encoding="utf-8") as f:
            json.dump({"applied_transform": IDENTITY_3X4, "frames": frames}, f)
        assert cameras(tj, cj) == 5
        with open(cj, encoding="utf-8") as f:
            cams = json.load(f)["cameras"]
        assert cams[3] == {"id": 3, "img_name": "frame_00003.png", "position": [1.5, 1.0, -3.0]}, cams[3]
        # A transforms.json still in nerfstudio's z-up world is refused.
        with open(tj, "w", encoding="utf-8") as f:
            json.dump({"applied_transform": [[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0]], "frames": frames}, f)
        try:
            cameras(tj, cj)
            raise AssertionError("a z-up transforms.json should be refused")
        except ValueError:
            pass
    # pick-frames: the sharpest of each window, in order; a blurred image scores lower.
    rng2 = np.random.default_rng(2)
    sharp = rng2.integers(0, 255, size=(40, 40)).astype(np.float32)
    blur = (sharp[:-2, :-2] + sharp[1:-1, 1:-1] + sharp[2:, 2:]) / 3
    assert laplacian_variance(sharp) > 2 * laplacian_variance(blur)
    assert pick_windows([1, 5, 2, 9, 3, 3], 3) == [1, 3, 4]
    assert pick_windows([1, 2], 5) == [0, 1]
    assert pick_windows(list(range(10)), 4) == sorted(pick_windows(list(range(10)), 4))
    # largest-model: the biggest model wins, whatever its number.
    with tempfile.TemporaryDirectory() as tmp:
        for name, n_img in (("0", 40), ("1", 131), ("2", 7)):
            os.makedirs(os.path.join(tmp, name))
            with open(os.path.join(tmp, name, "images.bin"), "wb") as f:
                f.write(np.array([n_img], dtype="<u8").tobytes())
        best, n_best, counts = largest_model(tmp)
        assert best == os.path.join(tmp, "1") and n_best == 131 and counts == {"0": 40, "1": 131, "2": 7}, counts
        assert largest_model(os.path.join(tmp, "nope"))[0] is None
    print("gpu-frame self-test: ok")


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "pick-frames" and len(argv) == 5:
        cut, kept, med_all, med_kept = pick_frames(argv[2], argv[3], int(argv[4]))
        print(f"frames: kept the sharpest {kept} of {cut} (median sharpness {med_all:.0f} → {med_kept:.0f})")
    elif cmd == "largest-model" and len(argv) == 3:
        best, n, counts = largest_model(argv[2])
        if best is None:
            print("no COLMAP model", file=sys.stderr)
            return 1
        print(best)
        print(f"COLMAP models (images each): {counts}", file=sys.stderr)
    elif cmd == "rewrite-transforms" and len(argv) in (3, 4):
        print(f"transforms.json rewritten in COLMAP's frame: {rewrite_transforms(*argv[2:])} cameras")
    elif cmd == "unnormalize" and len(argv) == 5:
        count, s = unnormalize(argv[2], argv[3], argv[4])
        print(f"splat un-normalized: {count} splats, dataparser scale {s:.6g}")
    elif cmd == "cameras" and len(argv) == 4:
        print(f"cameras.json: {cameras(argv[2], argv[3])} camera positions")
    elif cmd == "self-test":
        self_test()
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
