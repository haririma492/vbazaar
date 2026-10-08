#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  SAREKOOCHE — restore a Gaussian-splat scene on a rented GPU (RunPod).
#
#  Paste into the pod's web terminal (template «PyTorch 2.8.0», 1× A100 80 GB):
#
#      curl -fsSL https://sarekooche.com/gpu/restore.sh | bash -s iranianplaza1
#
#  Then wait. It says what it is doing in plain words and, at the end, exactly
#  which file to download and what to do with it. Running the same command
#  again carries on where it stopped (everything is kept under /workspace).
#
#  Extra options go after the scene id and are passed to restore.py, e.g.
#      ... | bash -s iranianplaza1 --fixer off              (skip NVIDIA Fixer)
#      ... | bash -s iranianplaza1 --no-cars                (keep the vehicles)
#      ... | bash -s iranianplaza1 --no-renovate            (no «as new» AI edit)
#      ... | bash -s iranianplaza1 --source "<a .ply link>"  (use the master)
#
#  Only the vehicle-removal stage changes geometry (vehicles' splats out, new
#  road splats in); every other stage changes colours only. See
#  /gpu/README.txt and docs/research/splat-restoration.md in the repository.
# ─────────────────────────────────────────────────────────────────────────────

# Everything is inside main(), so bash has read the whole script before any of
# it runs (it arrives through a pipe; nothing may read the rest of it as input).
main() {
  set -Eeuo pipefail

  local SITE="${SAREKOOCHE_SITE:-https://sarekooche.com}"
  local GSPLAT_VERSION="1.5.3"   # Apache-2.0; the newest release (2025-07-04)
  local SCRIPT_VERSION="2026-10-08.2"
  local SCENE="${1:-}"
  if [[ $# -gt 0 ]]; then shift; fi

  say()  { printf '%s\n' "$*"; }
  step() { printf '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  %s\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' "$*"; }
  die()  { printf '\n✗ %s\n' "$*"; exit 1; }

  if [[ ! "$SCENE" =~ ^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$ ]]; then
    die "Give the scene id after «bash -s», for example:
    curl -fsSL $SITE/gpu/restore.sh | bash -s iranianplaza1"
  fi

  # /workspace on RunPod (on this pod it is plain container disk: it is lost
  # when the pod is terminated — download the results first).
  local ROOT=/workspace
  if ! mkdir -p "$ROOT" 2>/dev/null || [[ ! -w "$ROOT" ]]; then ROOT="$HOME/workspace"; mkdir -p "$ROOT"; fi
  local WORK="$ROOT/restore" OUT="$ROOT/out"
  mkdir -p "$WORK" "$OUT"
  local LOG="$WORK/$SCENE.log"
  exec > >(tee -a "$LOG") 2>&1

  say ""
  say "Sarekooche splat restoration ($SCRIPT_VERSION) — scene «$SCENE»"
  say "Everything is kept in $WORK; the results go to $OUT. Log: $LOG"
  local START; START=$(date +%s)

  # ── 1. The machine ────────────────────────────────────────────────────────
  step "1/5  Checking the GPU and Python"
  command -v nvidia-smi >/dev/null || die "No NVIDIA GPU here. On runpod.io deploy a GPU pod (A100 80 GB) with the «PyTorch 2.8.0» template."
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader | sed 's/^/  GPU: /'
  local PY=""
  for c in python3 python; do command -v "$c" >/dev/null && { PY="$(command -v "$c")"; break; }; done
  [[ -n "$PY" ]] || die "No Python found. Use RunPod's «PyTorch 2.8.0» template."
  "$PY" - </dev/null <<'EOF' || die "PyTorch with a working GPU is needed. Use RunPod's «PyTorch 2.8.0» template (do not install another PyTorch)."
import sys
v = sys.version_info
assert v >= (3, 10), "Python 3.10 or newer is needed"
import torch
print("  Python %s · PyTorch %s · CUDA %s" % (sys.version.split()[0], torch.__version__, torch.version.cuda))
assert torch.cuda.is_available(), "PyTorch cannot see the GPU"
cap = torch.cuda.get_device_capability(0)
print("  GPU compute capability %d.%d" % cap)
EOF
  local TORCH_TAG ARCH
  TORCH_TAG=$("$PY" -c 'import torch;a,b=torch.__version__.split("+")[0].split(".")[:2];c=(torch.version.cuda or "").replace(".","");print("pt%s%scu%s"%(a,b,c))' </dev/null)
  ARCH=$("$PY" -c 'import torch;print("%d.%d"%torch.cuda.get_device_capability(0))' </dev/null)
  df -h "$ROOT" | awk 'NR==2{print "  Disk free at '"$ROOT"': "$4" of "$2}'

  # ── 2. Packages ───────────────────────────────────────────────────────────
  step "2/5  Installing the tools (pinned versions; PyTorch itself is never touched)"
  export PIP_BREAK_SYSTEM_PACKAGES=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_ROOT_USER_ACTION=ignore
  # Model downloads (about 60 GB) are kept here; no Hugging Face token is used.
  export HF_HOME="$WORK/hf" HF_HUB_DISABLE_TELEMETRY=1
  # Pin what the template already has, so no package can swap PyTorch out.
  "$PY" - >"$WORK/constraints.txt" </dev/null <<'EOF'
import importlib
for mod, pkg in (("torch", "torch"), ("torchvision", "torchvision"), ("torchaudio", "torchaudio"),
                 ("triton", "triton"), ("numpy", "numpy")):
    try:
        print("%s==%s" % (pkg, importlib.import_module(mod).__version__))
    except Exception:
        pass
EOF
  sed 's/^/  keeping /' "$WORK/constraints.txt"
  local DEPS_MARK="$WORK/.deps-$SCRIPT_VERSION-$TORCH_TAG"
  if [[ -f "$DEPS_MARK" ]]; then
    say "  already installed."
  else
    # All have prebuilt wheels for Python 3.10–3.12 (none compiles anything).
    # diffusers 0.40 (Qwen-Image-Edit-2511), transformers 5.17 (Grounding DINO,
    # SAM 2.1, Qwen2.5-VL), accelerate 1.15: all Apache-2.0.
    "$PY" -m pip install -q -c "$WORK/constraints.txt" \
      "pillow>=10.4,<12" "ninja==1.11.1.4" "jaxtyping==0.2.36" "rich==13.9.4" "packaging>=24" \
      "diffusers==0.40.0" "transformers==5.17.0" "accelerate==1.15.0" </dev/null \
      || die "pip could not install the tools (network?). Run the same command again."
    touch "$DEPS_MARK"
    say "  ✓ installed"
  fi

  # ── 3. gsplat (the splat renderer) ────────────────────────────────────────
  step "3/5  Setting up gsplat $GSPLAT_VERSION (Apache-2.0), the GPU splat renderer"
  export TORCH_EXTENSIONS_DIR="$WORK/torch_extensions" TORCH_CUDA_ARCH_LIST="$ARCH" MAX_JOBS="$(( $(nproc) > 2 ? $(nproc) : 2 ))"
  local GS_MARK="$WORK/.gsplat-$GSPLAT_VERSION-$TORCH_TAG-$ARCH"
  if [[ -f "$GS_MARK" ]]; then
    say "  already set up."
  else
    # A prebuilt wheel for this PyTorch/CUDA when gsplat publishes one
    # ($TORCH_TAG); otherwise the official package, whose GPU code is compiled
    # once for this GPU on first use (a few minutes; kept in $WORK).
    if "$PY" -m pip install -q --no-deps -c "$WORK/constraints.txt" "gsplat==$GSPLAT_VERSION" \
         --index-url "https://docs.gsplat.studio/whl/$TORCH_TAG" </dev/null 2>/dev/null; then
      say "  ✓ prebuilt gsplat wheel for $TORCH_TAG"
    else
      say "  (no prebuilt gsplat wheel for $TORCH_TAG — using the official package; its GPU code is"
      say "   compiled once for this GPU, about 3–8 minutes)"
      "$PY" -m pip install -q --no-deps -c "$WORK/constraints.txt" "gsplat==$GSPLAT_VERSION" </dev/null \
        || die "pip could not install gsplat. Run the same command again."
      if ! command -v nvcc >/dev/null && [[ ! -x /usr/local/cuda/bin/nvcc ]]; then
        say "  the CUDA compiler is missing; installing it from NVIDIA's apt repository…"
        local CV; CV=$("$PY" -c 'import torch;print(torch.version.cuda.replace(".","-"))' </dev/null)
        (apt-get update -qq && apt-get install -y -qq "cuda-nvcc-$CV" "cuda-cudart-dev-$CV" "cuda-cccl-$CV") </dev/null >>"$LOG" 2>&1 \
          || die "No CUDA compiler (nvcc) on this pod and it could not be installed. Use RunPod's «PyTorch 2.8.0» template."
      fi
      [[ -d /usr/local/cuda/bin ]] && export PATH="/usr/local/cuda/bin:$PATH" CUDA_HOME="${CUDA_HOME:-/usr/local/cuda}"
    fi
    say "  checking gsplat on the GPU (this is where it compiles, the first time)…"
    "$PY" - </dev/null <<'EOF' || die "gsplat does not run on this GPU (details above and in the log). Send the log to the developer."
import torch, time
t = time.time()
from gsplat import rasterization
n = 1000
d = "cuda"
means = torch.randn(n, 3, device=d) + torch.tensor([0, 0, 5.0], device=d)
quats = torch.nn.functional.normalize(torch.randn(n, 4, device=d), dim=1)
scales = torch.full((n, 3), 0.05, device=d)
opac = torch.full((n,), 0.8, device=d)
cols = torch.rand(n, 1, 3, device=d, requires_grad=True)
K = torch.tensor([[[100.0, 0, 64], [0, 100.0, 36], [0, 0, 1]]], device=d)
img, alpha, _ = rasterization(means, quats, scales, opac, cols, torch.eye(4, device=d)[None], K, 128, 72, sh_degree=0)
img.sum().backward()
assert cols.grad is not None and float(alpha.max()) > 0
print("  ✓ gsplat renders and differentiates on the GPU (%.0f s)" % (time.time() - t))
EOF
    touch "$GS_MARK"
  fi

  # ── 4. The pipeline itself ────────────────────────────────────────────────
  step "4/5  Fetching restore.py"
  if curl -fsSL "$SITE/gpu/restore.py" -o "$WORK/restore.py.new"; then
    mv "$WORK/restore.py.new" "$WORK/restore.py"
    say "  ✓ $WORK/restore.py"
  elif [[ -f "$WORK/restore.py" ]]; then
    say "  (could not fetch a fresh copy; using the one from the last run)"
  else
    die "Could not download $SITE/gpu/restore.py"
  fi

  step "5/5  Restoring «$SCENE» (the long part)"
  "$PY" -u "$WORK/restore.py" "$SCENE" --site "$SITE" --work "$WORK" --out "$OUT" "$@" </dev/null \
    || die "The restoration stopped (the reason is above). Run the same command again to carry on where it stopped."

  local MINS=$(( ($(date +%s) - START + 59) / 60 ))
  say ""
  say "All done in about $MINS min. Files to download (Jupyter → folder «out»):"
  ls -lh "$OUT/$SCENE-restored.ply" "$OUT/$SCENE-before-after.jpg" 2>/dev/null | awk '{print "   "$5"\t"$9}'
  say ""
  say "Then: upload $SCENE-restored.ply at $SITE/operator/splats with Scene id «$SCENE»,"
  say "press «Make the streamed copy», and STOP + TERMINATE this pod on runpod.io (billing stops)."
}

main "$@"
