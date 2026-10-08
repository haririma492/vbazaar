#!/usr/bin/env bash
# Phone video or photos -> COLMAP camera poses -> Brush Gaussian splat (.ply).
# Guide: scripts/splats/photos-to-splat.md
#
#   scripts/splats/photos-to-splat.sh INPUT OUTPUT_DIR
#
#   INPUT       a video (.mov/.mp4/...) or a folder of photos (.jpg/.jpeg/.png)
#   OUTPUT_DIR  a new or empty folder; everything is written inside it
#
# Settings (environment variables, all optional):
#   FPS=2          frames taken per second of video (3 when COLMAP loses track)
#   MATCHER=auto   auto = sequential for a video, exhaustive for photos;
#                  or set "sequential" / "exhaustive"
#   LOOP=0         1 = sequential matcher also looks for loop closures (needs a
#                  vocabulary tree; COLMAP 3.12+ downloads one by itself)
#   USE_GPU=auto   COLMAP SIFT on the GPU: auto = CPU on macOS (no CUDA there),
#                  COLMAP's default elsewhere; or 0 / 1
#   STEPS=30000    Brush training steps (Brush's default)
#   MAX_RES=1920   longest image side used for training (Brush's default)
#   VIEWER=0       1 = open Brush's window to watch training
#   BRUSH=         path to the Brush binary if it is not "brush" or
#                  "brush_app" on PATH
#
# Mac/Linux only. On Windows follow the guide (COLMAP.bat + brush_app.exe).
set -euo pipefail

FPS="${FPS:-2}"
MATCHER="${MATCHER:-auto}"
LOOP="${LOOP:-0}"
USE_GPU="${USE_GPU:-auto}"
STEPS="${STEPS:-30000}"
MAX_RES="${MAX_RES:-1920}"
VIEWER="${VIEWER:-0}"
BRUSH="${BRUSH:-}"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }

usage() {
  sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && usage 0
[[ $# -eq 2 ]] || usage 1

INPUT="$1"
OUT="$2"

[[ -e "$INPUT" ]] || die "input not found: $INPUT"
[[ "$FPS" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "FPS must be a number, got: $FPS"
[[ "$STEPS" =~ ^[1-9][0-9]*$ ]] || die "STEPS must be a positive whole number, got: $STEPS"
[[ "$MAX_RES" =~ ^[1-9][0-9]*$ ]] || die "MAX_RES must be a positive whole number, got: $MAX_RES"

if [[ -d "$INPUT" ]]; then IS_VIDEO=0; else IS_VIDEO=1; fi

# ── tools ────────────────────────────────────────────────────────────────────

need() {
  command -v "$1" >/dev/null 2>&1 && return 0
  printf 'ERROR: "%s" is not installed (or not on PATH).\n%s\n' "$1" "$2" >&2
  exit 1
}

if [[ $IS_VIDEO -eq 1 ]]; then
  need ffmpeg "  Mac:   brew install ffmpeg
  Linux: sudo apt install ffmpeg"
fi
need colmap "  Mac:   brew install colmap
  Linux: sudo apt install colmap   (or build with CUDA: https://colmap.github.io/install.html)"

if [[ -z "$BRUSH" ]]; then
  if command -v brush >/dev/null 2>&1; then BRUSH=brush
  elif command -v brush_app >/dev/null 2>&1; then BRUSH=brush_app
  fi
fi
if [[ -z "$BRUSH" ]] || ! command -v "$BRUSH" >/dev/null 2>&1; then
  cat >&2 <<'EOF'
ERROR: Brush is not installed (or not on PATH).
  Download it from https://github.com/ArthurBrussee/brush/releases (v0.3.0):
    Mac (Apple Silicon): brush-app-aarch64-apple-darwin.tar.xz
    Linux x64:           brush-app-x86_64-unknown-linux-gnu.tar.xz
  Unpack it; the program inside is called "brush_app". Then either put it on
  PATH or run this script with BRUSH=/full/path/to/brush_app.
  Mac: if macOS refuses to open it, run once:
    xattr -d com.apple.quarantine /full/path/to/brush_app
EOF
  exit 1
fi

# ── output folder ────────────────────────────────────────────────────────────

if [[ -e "$OUT" ]]; then
  [[ -d "$OUT" ]] || die "output exists and is not a folder: $OUT"
  [[ -z "$(ls -A "$OUT")" ]] || die "output folder is not empty: $OUT (use a new folder for each try)"
fi
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
IMAGES="$OUT/images"
DB="$OUT/database.db"
SPARSE="$OUT/sparse"
DENSE="$OUT/dense"
SPLAT_DIR="$OUT/splat"
mkdir -p "$IMAGES" "$SPARSE"

# ── 1. images ────────────────────────────────────────────────────────────────

if [[ $IS_VIDEO -eq 1 ]]; then
  step "Extracting $FPS frames per second from the video"
  if command -v ffprobe >/dev/null 2>&1; then
    transfer="$(ffprobe -v error -select_streams v:0 -show_entries stream=color_transfer -of csv=p=0 "$INPUT" || true)"
    case "$transfer" in
      *arib-std-b67*|*smpte2084*)
        warn "this video is HDR ($transfer). Frames may look washed out; next time turn HDR Video off on the phone." ;;
    esac
  fi
  ffmpeg -hide_banner -loglevel error -stats -i "$INPUT" -vf "fps=$FPS" -q:v 2 "$IMAGES/frame_%05d.jpg"
else
  step "Copying photos"
  find "$INPUT" -maxdepth 1 -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) -exec cp {} "$IMAGES/" \;
  if find "$INPUT" -maxdepth 1 -type f -iname '*.heic' | grep -q .; then
    warn "HEIC photos were skipped. Export them as JPEG (iPhone: Settings > Camera > Formats > Most Compatible)."
  fi
fi

N_IMAGES="$(find "$IMAGES" -type f | wc -l | tr -d ' ')"
[[ "$N_IMAGES" -ge 20 ]] || die "only $N_IMAGES images in $IMAGES; need at least 20 (aim for 200-600)"
echo "$N_IMAGES images in $IMAGES"
if [[ $IS_VIDEO -eq 1 ]]; then
  echo "Tip: you can stop here (Ctrl-C), delete blurry frames from $IMAGES, and run COLMAP by hand (see the guide)."
fi

# ── 2. COLMAP ────────────────────────────────────────────────────────────────

# Option names changed in COLMAP 3.13 (SiftExtraction.use_gpu -> FeatureExtraction.use_gpu).
help_extract="$(colmap feature_extractor -h 2>&1 || true)"
if grep -q -- '--FeatureExtraction.use_gpu' <<<"$help_extract"; then
  GPU_X=FeatureExtraction.use_gpu; GPU_M=FeatureMatching.use_gpu
else
  GPU_X=SiftExtraction.use_gpu; GPU_M=SiftMatching.use_gpu
fi
gpu_args_x=(); gpu_args_m=()
if [[ "$USE_GPU" == auto && "$(uname -s)" == Darwin ]]; then USE_GPU=0; fi
if [[ "$USE_GPU" == 0 || "$USE_GPU" == 1 ]]; then
  gpu_args_x=(--"$GPU_X" "$USE_GPU"); gpu_args_m=(--"$GPU_M" "$USE_GPU")
fi

step "COLMAP: finding features (one camera for all images)"
colmap feature_extractor \
  --database_path "$DB" \
  --image_path "$IMAGES" \
  --ImageReader.single_camera 1 \
  ${gpu_args_x[@]+"${gpu_args_x[@]}"}

if [[ "$MATCHER" == auto ]]; then
  if [[ $IS_VIDEO -eq 1 ]]; then MATCHER=sequential; else MATCHER=exhaustive; fi
fi
case "$MATCHER" in
  sequential)
    step "COLMAP: matching neighbouring frames (sequential)"
    loop_args=()
    [[ "$LOOP" == 1 ]] && loop_args=(--SequentialMatching.loop_detection 1)
    colmap sequential_matcher \
      --database_path "$DB" \
      ${gpu_args_m[@]+"${gpu_args_m[@]}"} \
      ${loop_args[@]+"${loop_args[@]}"}
    ;;
  exhaustive)
    step "COLMAP: matching every pair of images (exhaustive)"
    colmap exhaustive_matcher \
      --database_path "$DB" \
      ${gpu_args_m[@]+"${gpu_args_m[@]}"}
    ;;
  *) die "MATCHER must be auto, sequential or exhaustive, got: $MATCHER" ;;
esac

step "COLMAP: solving camera positions (mapper; the slow part)"
colmap mapper \
  --database_path "$DB" \
  --image_path "$IMAGES" \
  --output_path "$SPARSE"

# The mapper writes sparse/0, sparse/1, ... when it could not join everything
# into one model. Keep the one with the most registered images.
BEST=""; BEST_N=0; N_MODELS=0
for model in "$SPARSE"/*/; do
  model="${model%/}"
  [[ -f "$model/images.bin" ]] || continue
  N_MODELS=$((N_MODELS + 1))
  txt="$OUT/.txt-$(basename "$model")"
  mkdir -p "$txt"
  colmap model_converter --input_path "$model" --output_path "$txt" --output_type TXT >/dev/null 2>&1
  # images.txt: comment lines, then two lines per registered image.
  n="$(awk '!/^#/ { n++ } END { print int(n / 2) }' "$txt/images.txt")"
  if [[ "$n" -gt "$BEST_N" ]]; then BEST="$model"; BEST_N="$n"; fi
done
[[ -n "$BEST" ]] || die "COLMAP could not reconstruct anything. Capture again with more overlap, or retry with FPS=3 (see the guide)."
cp "$OUT/.txt-$(basename "$BEST")/images.txt" "$BEST/images.txt"
rm -rf "$OUT"/.txt-*

PCT=$((100 * BEST_N / N_IMAGES))
echo "Registered $BEST_N of $N_IMAGES images ($PCT%) in $BEST"
if [[ $N_MODELS -gt 1 ]]; then
  warn "COLMAP split the store into $N_MODELS separate pieces; only the biggest ($BEST) is used."
fi
if [[ $PCT -lt 80 ]]; then
  warn "fewer than 80% of images were placed. Parts of the store will be missing or blurry. See \"When COLMAP fails\" in the guide."
fi

step "COLMAP: undistorting images for Brush (Brush ignores lens distortion)"
colmap image_undistorter \
  --image_path "$IMAGES" \
  --input_path "$BEST" \
  --output_path "$DENSE" \
  --output_type COLMAP \
  --max_image_size "$MAX_RES"

# ── 3. Brush ─────────────────────────────────────────────────────────────────

step "Brush: training $STEPS steps (a checkpoint .ply every 5000 steps)"
viewer_args=()
[[ "$VIEWER" == 1 ]] && viewer_args=(--with-viewer)
"$BRUSH" "$DENSE" \
  --total-steps "$STEPS" \
  --max-resolution "$MAX_RES" \
  --export-every 5000 \
  --export-path "$SPLAT_DIR" \
  --export-name "splat_{iter}.ply" \
  ${viewer_args[@]+"${viewer_args[@]}"}

# Brush pads {iter} to the number of digits in --total-steps.
PLY="$SPLAT_DIR/splat_$(printf "%0${#STEPS}d" "$STEPS").ply"
[[ -f "$PLY" ]] || die "Brush finished but $PLY is missing; look in $SPLAT_DIR"

# ── done ─────────────────────────────────────────────────────────────────────

cat <<EOF

Done. Upload these at https://sarekooche.com/operator/splats :
  splat:       $PLY
  walk route:  $BEST/images.bin
               (or the same poses as text: $BEST/images.txt)
Then open https://sarekooche.com/vca/splat to walk through it.
EOF
