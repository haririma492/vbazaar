#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  SAREKOOCHE — build a walkable Gaussian-splat scene from ONE 360° walk video,
#  on a rented GPU (RunPod). No Splatica, no account, no token.
#
#  1. Upload the 360° MP4 (exported from Insta360 Studio as equirectangular)
#     to the pod through Jupyter: it lands in /workspace.
#  2. Paste into the pod's web terminal (template «Runpod Pytorch 2.8.0»,
#     1× A40 48 GB, or L40S / A100):
#
#      curl -fsSL https://sarekooche.com/gpu/build-scene.sh | bash -s /workspace/plaza.mp4 plaza1
#
#     (the second word is the scene's name; leave it out and it is made from
#      the file name.)
#
#  Then wait (about 2–3 hours for a 2-minute 8K walk). It says what it is doing
#  in plain words and, at the end, exactly which files to download and what to
#  do with them. Running the same command again carries on where it stopped
#  (everything is kept under /workspace/build/<name>; log: log.txt there).
#
#  Extra options go after the name and are passed to build_scene.py, e.g.
#      ... | bash -s /workspace/plaza.mp4 plaza1 --camera-height 2.3
#      ... | bash -s /workspace/plaza.mp4 plaza1 --trainer gsplat   (skip Brush)
#      ... | bash -s /workspace/plaza.mp4 plaza1 --fps 3            (more frames)
#  See /gpu/BUILD-README.txt.
# ─────────────────────────────────────────────────────────────────────────────

# Everything is inside main(), so bash has read the whole script before any of
# it runs (it arrives through a pipe; nothing may read the rest of it as input).
main() {
  set -Eeuo pipefail

  local SITE="${SAREKOOCHE_SITE:-https://sarekooche.com}"
  local SCRIPT_VERSION="2026-10-09.1"
  local PYCOLMAP_VERSION="4.2.1"   # COLMAP 4.2.1 (BSD-3-Clause), GLOMAP's global mapper built in; 2026-09-29
  local GSPLAT_VERSION="1.5.3"     # Apache-2.0
  local BRUSH_VERSION="v0.3.0"     # Apache-2.0; the newest Brush release with Linux binaries (2025-09-14)

  say()  { printf '%s\n' "$*"; }
  step() { printf '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  %s\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' "$*"; }
  die()  { printf '\n✗ %s\n' "$*"; exit 1; }

  # /workspace on RunPod: Jupyter's folder. Everything is deleted when the pod
  # is terminated — download the results first.
  local ROOT=/workspace
  if ! mkdir -p "$ROOT" 2>/dev/null || [[ ! -w "$ROOT" ]]; then ROOT="$HOME/workspace"; mkdir -p "$ROOT"; fi

  # ── Which video, which name ───────────────────────────────────────────────
  local VIDEO="${1:-}" NAME=""
  if [[ $# -gt 0 ]]; then shift; fi
  if [[ $# -gt 0 && "${1:-}" != --* ]]; then NAME="${1,,}"; shift; fi
  if [[ -n "$VIDEO" && ! -f "$VIDEO" && -f "$ROOT/$VIDEO" ]]; then VIDEO="$ROOT/$VIDEO"; fi
  if [[ -z "$VIDEO" || ! -f "$VIDEO" ]]; then
    local found=()
    while IFS= read -r -d '' f; do found+=("$f"); done < <(find "$ROOT" -maxdepth 2 -type f \( -iname '*.mp4' -o -iname '*.mov' \) -not -path "$ROOT/build/*" -print0 2>/dev/null)
    if [[ -z "$VIDEO" && ${#found[@]} -eq 1 ]]; then
      VIDEO="${found[0]}"
      say "Using the only video in $ROOT: $VIDEO"
    else
      local list=""
      for f in "${found[@]}"; do list+=$'\n'"      $f"; done
      [[ -n "$list" ]] || list=$'\n      (none — upload it first: Jupyter → left panel → the upload arrow)'
      die "Video not found: «${VIDEO:-(none given)}». Videos in $ROOT:$list
    Paste the command with the video's full path, for example:
      curl -fsSL $SITE/gpu/build-scene.sh | bash -s /workspace/plaza.mp4 plaza1
    (If the file name has spaces, rename it in Jupyter first: right-click → Rename.)"
    fi
  fi
  case "${VIDEO,,}" in
    *.insv) die "$VIDEO is the camera's own .insv file. Export it from Insta360 Studio as a 360° MP4 first (see /gpu/BUILD-README.txt)." ;;
  esac
  if [[ -z "$NAME" ]]; then
    NAME=$(basename "$VIDEO"); NAME="${NAME%.*}"; NAME=$(printf '%s' "$NAME" | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-40 | sed -E 's/-+$//')
  fi
  if [[ ! "$NAME" =~ ^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$ ]]; then
    die "«$NAME» cannot be a scene name. Give one after the video: lowercase letters, digits and inner hyphens, e.g.
    curl -fsSL $SITE/gpu/build-scene.sh | bash -s $VIDEO plaza1"
  fi

  local BUILD="$ROOT/build/$NAME" TOOLS="$ROOT/build/.tools"
  mkdir -p "$BUILD" "$TOOLS"
  local LOG="$BUILD/log.txt"
  exec > >(tee -a "$LOG") 2>&1

  say ""
  say "Sarekooche scene builder ($SCRIPT_VERSION) — «$NAME» from $(basename "$VIDEO")"
  say "Everything is kept in $BUILD. Log: $LOG"
  local START; START=$(date +%s)

  # ── 1. The machine ────────────────────────────────────────────────────────
  step "1/5  Checking the GPU, Python and the disk"
  command -v nvidia-smi >/dev/null || die "No NVIDIA GPU here. On runpod.io deploy a GPU pod (A40, L40S or A100) with the «Runpod Pytorch 2.8.0» template."
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader | sed 's/^/  GPU: /'
  local PY=""
  for c in python3 python; do command -v "$c" >/dev/null && { PY="$(command -v "$c")"; break; }; done
  [[ -n "$PY" ]] || die "No Python found. Use RunPod's «Runpod Pytorch 2.8.0» template."
  "$PY" - </dev/null <<'EOF' || die "PyTorch with a working GPU is needed. Use RunPod's «Runpod Pytorch 2.8.0» template (do not install another PyTorch)."
import sys
v = sys.version_info
assert v >= (3, 10), "Python 3.10 or newer is needed"
import torch
print("  Python %s · PyTorch %s · CUDA %s" % (sys.version.split()[0], torch.__version__, torch.version.cuda))
assert torch.cuda.is_available(), "PyTorch cannot see the GPU"
print("  GPU compute capability %d.%d" % torch.cuda.get_device_capability(0))
EOF
  local TORCH_TAG ARCH
  TORCH_TAG=$("$PY" -c 'import torch;a,b=torch.__version__.split("+")[0].split(".")[:2];c=(torch.version.cuda or "").replace(".","");print("pt%s%scu%s"%(a,b,c))' </dev/null)
  ARCH=$("$PY" -c 'import torch;print("%d.%d"%torch.cuda.get_device_capability(0))' </dev/null)
  local FREE_GB
  FREE_GB=$(df -Pk "$ROOT" | awk 'NR==2{printf "%d", $4/1048576}')
  say "  Disk free at $ROOT: ${FREE_GB} GB · CPU cores: $(nproc) · memory: $(free -g 2>/dev/null | awk '/^Mem:/{print $2" GB"}')"
  say "  Video: $VIDEO ($(du -h "$VIDEO" | cut -f1))"
  if [[ ! -f "$BUILD/work/frames/frames.json" && "$FREE_GB" -lt 30 ]]; then
    die "Only ${FREE_GB} GB free at $ROOT; a 2-minute 8K walk needs about 25 GB of working space.
    Make a new pod with a bigger disk (BUILD-README.txt, step 2: Volume Disk 100 GB)."
  fi

  # ── 2. System tools ───────────────────────────────────────────────────────
  step "2/5  Installing the tools (pinned versions; PyTorch itself is never touched)"
  local APT_MARK="$TOOLS/.apt-$SCRIPT_VERSION"
  if [[ -f "$APT_MARK" ]] && command -v ffmpeg >/dev/null; then
    say "  system packages: already installed."
  else
    say "  system packages (ffmpeg, Vulkan loader)…"
    export DEBIAN_FRONTEND=noninteractive
    (apt-get update -qq && apt-get install -y -qq --no-install-recommends \
       ffmpeg libvulkan1 vulkan-tools xz-utils ca-certificates \
       libx11-6 libxext6 libsm6 libice6 libxcursor1 libxrandr2 libxi6 libxkbcommon0 libwayland-client0 libegl1 libgl1) </dev/null >>"$LOG" 2>&1 \
      || die "apt could not install ffmpeg (network?). Run the same command again."
    touch "$APT_MARK"
    say "  ✓ installed"
  fi
  # Vulkan for Brush: the NVIDIA driver's Vulkan library is libGLX_nvidia.so.0.
  # When the pod mounts it but no loader entry points at it, add the entry.
  if ! ls /usr/share/vulkan/icd.d/nvidia_icd*.json /etc/vulkan/icd.d/nvidia_icd*.json >/dev/null 2>&1; then
    if ldconfig -p 2>/dev/null | grep -q 'libGLX_nvidia.so.0'; then
      mkdir -p /etc/vulkan/icd.d
      printf '{ "file_format_version": "1.0.0", "ICD": { "library_path": "libGLX_nvidia.so.0", "api_version": "1.3" } }\n' \
        >/etc/vulkan/icd.d/nvidia_icd.json
      say "  added the NVIDIA Vulkan entry (/etc/vulkan/icd.d/nvidia_icd.json)"
    fi
  fi
  ffmpeg -hide_banner -version 2>/dev/null | head -1 | sed 's/^/  /'

  export PIP_BREAK_SYSTEM_PACKAGES=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_ROOT_USER_ACTION=ignore
  # Pin what the template already has (PyTorch, its CUDA libraries, NumPy), so
  # no package can swap them out.
  "$PY" - >"$TOOLS/constraints.txt" </dev/null <<'EOF'
import importlib.metadata as md
keep = {"torch", "torchvision", "torchaudio", "triton", "numpy"}
for d in md.distributions():
    n = (d.metadata["Name"] or "").lower()
    if n in keep or n.startswith("nvidia-"):
        print("%s==%s" % (n, d.version))
EOF
  sed -n 's/^\(torch\|numpy\)==/  keeping \1 /p' "$TOOLS/constraints.txt"
  local DEPS_MARK="$TOOLS/.deps-$SCRIPT_VERSION-$TORCH_TAG"
  if [[ -f "$DEPS_MARK" ]]; then
    say "  Python packages: already installed."
  else
    say "  Python packages (pycolmap $PYCOLMAP_VERSION with CUDA, OpenCV, SciPy)…"
    # pycolmap-cuda12 and pycolmap are the same module: only ever one of them.
    # The GPU build loads the CUDA runtime that PyTorch already brought
    # (nvidia-cuda-runtime-cu12, nvidia-curand-cu12); if pip will not settle its
    # CUDA metapackage next to the pinned ones, it is installed without it.
    "$PY" -m pip uninstall -y -q pycolmap </dev/null >>"$LOG" 2>&1 || true
    if "$PY" -m pip install -q -c "$TOOLS/constraints.txt" "pycolmap-cuda12==$PYCOLMAP_VERSION" </dev/null >>"$LOG" 2>&1 \
       || "$PY" -m pip install -q --no-deps "pycolmap-cuda12==$PYCOLMAP_VERSION" </dev/null >>"$LOG" 2>&1; then
      "$PY" -c 'import pycolmap; assert pycolmap.has_cuda' </dev/null >>"$LOG" 2>&1 || {
        say "  (the GPU build of pycolmap does not load here; using the CPU build — COLMAP will be slower)"
        "$PY" -m pip uninstall -y -q pycolmap-cuda12 </dev/null >>"$LOG" 2>&1 || true
        "$PY" -m pip install -q -c "$TOOLS/constraints.txt" "pycolmap==$PYCOLMAP_VERSION" </dev/null >>"$LOG" 2>&1 \
          || die "pip could not install pycolmap (network?). Run the same command again."
      }
    else
      say "  (the GPU build of pycolmap would not install; using the CPU build — COLMAP will be slower)"
      "$PY" -m pip uninstall -y -q pycolmap-cuda12 </dev/null >>"$LOG" 2>&1 || true
      "$PY" -m pip install -q -c "$TOOLS/constraints.txt" "pycolmap==$PYCOLMAP_VERSION" </dev/null >>"$LOG" 2>&1 \
        || die "pip could not install pycolmap (network?). Run the same command again."
    fi
    "$PY" -m pip install -q -c "$TOOLS/constraints.txt" "opencv-python-headless>=4.10,<5" "scipy>=1.11" "pillow>=10.4" \
      </dev/null >>"$LOG" 2>&1 || die "pip could not install OpenCV/SciPy (network?). Run the same command again."
    touch "$DEPS_MARK"
    say "  ✓ installed"
  fi
  "$PY" -c 'import pycolmap,cv2,scipy;print("  pycolmap %s (CUDA: %s) · OpenCV %s · SciPy %s"%(pycolmap.__version__,getattr(pycolmap,"has_cuda","?"),cv2.__version__,scipy.__version__))' </dev/null \
    || die "pycolmap/OpenCV do not load (details in the log). Send the log to the developer."

  # gsplat: the fallback trainer and the preview renderer (as in restore.sh).
  export TORCH_EXTENSIONS_DIR="$TOOLS/torch_extensions" TORCH_CUDA_ARCH_LIST="$ARCH" MAX_JOBS="$(( $(nproc) > 2 ? $(nproc) : 2 ))"
  local GS_MARK="$TOOLS/.gsplat-$GSPLAT_VERSION-$TORCH_TAG-$ARCH"
  if [[ -f "$GS_MARK" ]]; then
    say "  gsplat $GSPLAT_VERSION: already set up."
  else
    say "  gsplat $GSPLAT_VERSION (Apache-2.0), the GPU splat renderer…"
    "$PY" -m pip install -q -c "$TOOLS/constraints.txt" "ninja==1.11.1.4" "jaxtyping==0.2.36" "rich==13.9.4" </dev/null >>"$LOG" 2>&1 \
      || die "pip could not install gsplat's helpers (network?). Run the same command again."
    # A prebuilt wheel for this PyTorch/CUDA when gsplat publishes one
    # ($TORCH_TAG); otherwise the official package, whose GPU code is compiled
    # once for this GPU on first use (kept in $TOOLS).
    if "$PY" -m pip install -q --no-deps -c "$TOOLS/constraints.txt" "gsplat==$GSPLAT_VERSION" \
         --index-url "https://docs.gsplat.studio/whl/$TORCH_TAG" </dev/null >>"$LOG" 2>&1; then
      say "  ✓ prebuilt gsplat wheel for $TORCH_TAG"
    else
      "$PY" -m pip install -q --no-deps -c "$TOOLS/constraints.txt" "gsplat==$GSPLAT_VERSION" </dev/null >>"$LOG" 2>&1 \
        || die "pip could not install gsplat. Run the same command again."
      say "  ✓ gsplat (official package; its GPU code is compiled on first use)"
    fi
    if ! command -v nvcc >/dev/null && [[ ! -x /usr/local/cuda/bin/nvcc ]]; then
      say "  the CUDA compiler is missing; installing it from NVIDIA's apt repository…"
      local CV; CV=$("$PY" -c 'import torch;print(torch.version.cuda.replace(".","-"))' </dev/null)
      (apt-get update -qq && apt-get install -y -qq "cuda-nvcc-$CV" "cuda-cudart-dev-$CV" "cuda-cccl-$CV") </dev/null >>"$LOG" 2>&1 \
        || say "  (could not install nvcc; fine if gsplat's prebuilt wheel was used)"
    fi
    [[ -d /usr/local/cuda/bin ]] && export PATH="/usr/local/cuda/bin:$PATH" CUDA_HOME="${CUDA_HOME:-/usr/local/cuda}"
    say "  checking gsplat on the GPU (the first time it compiles its GPU code: 3–8 minutes)…"
    "$PY" - </dev/null <<'EOF' || die "gsplat does not run on this GPU (details above and in the log). Send the log to the developer."
import torch, time
t = time.time()
from gsplat import rasterization
n, d = 1000, "cuda"
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
  [[ -d /usr/local/cuda/bin ]] && export PATH="/usr/local/cuda/bin:$PATH" CUDA_HOME="${CUDA_HOME:-/usr/local/cuda}"

  # ── 3. Brush (the preferred trainer; needs Vulkan on the pod) ─────────────
  step "3/5  Fetching Brush $BRUSH_VERSION (Apache-2.0), the splat trainer"
  local BDIR="$TOOLS/brush-$BRUSH_VERSION" BRUSH_BIN=""
  BRUSH_BIN=$(find "$BDIR" -maxdepth 3 -type f \( -name brush_app -o -name brush \) -perm -u+x 2>/dev/null | head -1 || true)
  if [[ -z "$BRUSH_BIN" ]]; then
    mkdir -p "$BDIR"
    local BURL="https://github.com/ArthurBrussee/brush/releases/download/$BRUSH_VERSION/brush-app-x86_64-unknown-linux-gnu.tar.xz"
    if curl -fsSL --retry 3 "$BURL" -o "$BDIR/brush.tar.xz" </dev/null >>"$LOG" 2>&1 \
       && tar -xJf "$BDIR/brush.tar.xz" -C "$BDIR" </dev/null >>"$LOG" 2>&1; then
      BRUSH_BIN=$(find "$BDIR" -maxdepth 3 -type f \( -name brush_app -o -name brush \) 2>/dev/null | head -1 || true)
      [[ -n "$BRUSH_BIN" ]] && chmod +x "$BRUSH_BIN"
    fi
  fi
  if [[ -n "$BRUSH_BIN" ]]; then
    say "  ✓ $BRUSH_BIN ($("$BRUSH_BIN" --version </dev/null 2>/dev/null | head -1 || echo "version unknown"))"
    if ldd "$BRUSH_BIN" 2>/dev/null | grep -q 'not found'; then
      say "  (Brush misses some system libraries: $(ldd "$BRUSH_BIN" | awk '/not found/{print $1}' | tr '\n' ' ')— it will be skipped if it cannot start)"
    fi
  else
    say "  (Brush could not be downloaded; the gsplat trainer will be used instead)"
  fi

  # ── 4. The pipeline itself ────────────────────────────────────────────────
  step "4/5  Fetching build_scene.py"
  if curl -fsSL "$SITE/gpu/build_scene.py" -o "$TOOLS/build_scene.py.new" </dev/null; then
    mv "$TOOLS/build_scene.py.new" "$TOOLS/build_scene.py"
    say "  ✓ $TOOLS/build_scene.py"
  elif [[ -f "$TOOLS/build_scene.py" ]]; then
    say "  (could not fetch a fresh copy; using the one from the last run)"
  else
    die "Could not download $SITE/gpu/build_scene.py"
  fi

  step "5/5  Building «$NAME» (the long part: about 2–3 hours)"
  say "  You can close this browser tab: it keeps running. To watch again later, open a"
  say "  new web terminal and type:   tail -f $LOG"
  "$PY" -u "$TOOLS/build_scene.py" "$VIDEO" "$NAME" --root "$ROOT/build" --log "$LOG" --site "$SITE" \
      --brush-bin "$BRUSH_BIN" --brush-version "$BRUSH_VERSION" "$@" </dev/null \
    || die "The build stopped (the reason is above). Run the same command again to carry on where it stopped."

  local MINS=$(( ($(date +%s) - START + 59) / 60 ))
  say ""
  say "All done in about $MINS min. Files to download (Jupyter → «workspace» → «build» → «$NAME»):"
  ls -lh "$BUILD/$NAME.ply" "$BUILD/$NAME-cameras.json" "$BUILD/$NAME-preview.jpg" "$BUILD/summary.txt" 2>/dev/null | awk '{print "   "$5"\t"$9}'
  say ""
  say "Then: upload $NAME.ply at $SITE/operator/splats (Scene id «$NAME», «convert to .spz here» ticked),"
  say "press «Make the streamed copy», and STOP + TERMINATE this pod on runpod.io (billing stops)."
}

main "$@"
