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

  gpu-frame.py rewrite-transforms <data-dir>
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


def rewrite_transforms(data_dir):
    """transforms.json and sparse_pc.ply again, in COLMAP's own world (see 1. above)."""
    from pathlib import Path
    from nerfstudio.process_data import colmap_utils  # pylint: disable=import-outside-toplevel

    d = Path(data_dir)
    n = colmap_utils.colmap_to_json(
        recon_dir=d / "colmap" / "sparse" / "0", output_dir=d, keep_original_world_coordinate=True,
    )
    path = d / "transforms.json"
    meta = json.loads(path.read_text(encoding="utf-8"))
    meta["applied_transform"] = IDENTITY_3X4
    path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return n


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
    print("gpu-frame self-test: ok")


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "rewrite-transforms" and len(argv) == 3:
        print(f"transforms.json rewritten in COLMAP's frame: {rewrite_transforms(argv[2])} cameras")
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
