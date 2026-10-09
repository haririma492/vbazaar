#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  SAREKOOCHE — a phone video of a store → a Gaussian splat, on a rented GPU.
#
#  Runs INSIDE a RunPod pod started by our server (lib/splats/train-job.ts,
#  «Train» on /operator/splats), on the official nerfstudio image
#  (ghcr.io/nerfstudio-project/nerfstudio:1.1.5 — CUDA 11.8, COLMAP 3.9.1,
#  ffmpeg, gsplat; Apache-2.0). It arrives base64 in SK_TRAIN_SH_B64 and the
#  pod's command unpacks and runs it, then idles (train.ts, POD_BOOT), so
#  nothing has to be deployed to RunPod first.
#
#  It never sees an R2 key or our RunPod key: only presigned URLs —
#    SK_VIDEO_URL       GET   the uploaded phone video (.mp4 / .mov)
#    SK_STATUS_URL      PUT   status.json, every ~30 s and at the end
#    SK_STATUS_GET_URL  GET   the same status.json (the restart guard below)
#    SK_PLY_URL         PUT   the trained splat (.ply, COLMAP's frame)
#    SK_CAMERAS_URL     PUT   cameras.json (the route, in the same frame)
#    SK_LOG_URL         PUT   the whole log, at the end (also on failure)
#    SK_FRAME_PY_B64    scripts/splats/gpu-frame.py, base64
#  and, optional: SK_JOB, SK_SCENE, SK_VIDEO_EXT (mp4|mov), SK_FRAMES (500),
#  SK_ITERATIONS (30000), SK_METHOD (splatfacto-big), SK_TIMEOUT_S (14400).
#
#  ⚠️ A POD BILLS UNTIL IT IS TERMINATED, and RunPod starts the container
#  again when its command ends. So:
#    • when this script ends, well or badly, it deletes its own pod with the
#      pod-scoped key RunPod puts in every pod (RUNPOD_API_KEY, with
#      RUNPOD_POD_ID — RunPod's, not ours); our server does the same from
#      outside as soon as status.json says done or failed;
#    • if the container starts again anyway, status.json already says done
#      or failed for this job: it does not train twice, it asks again to be
#      deleted, and idles;
#    • after SK_TIMEOUT_S it reports «failed» and deletes its pod, even if
#      our server is down.
#
#  The image has no curl: step 0 installs it (apt, ~20 s).
#
#  Steps (each flag checked against nerfstudio v1.1.5's and COLMAP 3.9.1's source):
#    1. curl the video.
#    2. ffmpeg cuts ~3× as many frames as wanted, at ≤ 1600 px; gpu-frame.py
#       pick-frames keeps the sharpest of each run of three (SK_FRAMES, 500).
#       (A 360° video — 2:1, or SK_EQUIRECT=1 — instead goes through
#       ns-process-data's equirectangular path: 8 views a frame, the
#       operator cropped, vocabulary-tree matching; see step 2–3 below.)
#    3. COLMAP run here (not by ns-process-data, which matches only 10
#       neighbours with no loop detection and always keeps sparse/0):
#       sequential matching, 20 neighbours + quadratic + loop detection;
#       a mapper that drops fewer frames; the model with most frames kept.
#       Then gpu-frame.py rewrite-transforms writes transforms.json in
#       COLMAP's own world (y down, like Brush's output), not nerfstudio's z-up one.
#    4. ns-train splatfacto-big (30k steps; --vis tensorboard: no viewer, so
#       it ends with the training), every frame at 1600 px, bilateral grid;
#       dataparser `--orientation-method none`: the scene is only centred
#       and scaled, never turned.
#    5. ns-export gaussian-splat → splat.ply (dataparser frame).
#    6. gpu-frame.py unnormalize + cameras — splat and cameras both back
#       in COLMAP's frame (see that file for the maths and the citations).
#    7. PUT splat.ply, cameras.json, then status «done», then the log.
#  Any failure: status «failed» with the reason, the log, exit non-zero.
#  Either way, the pod is deleted.
# ─────────────────────────────────────────────────────────────────────────────

main() {
  set -euo pipefail

  : "${SK_VIDEO_URL:?}" "${SK_STATUS_URL:?}" "${SK_STATUS_GET_URL:?}" "${SK_PLY_URL:?}" "${SK_CAMERAS_URL:?}" "${SK_LOG_URL:?}" "${SK_FRAME_PY_B64:?}"
  local ext="${SK_VIDEO_EXT:-mp4}"
  [[ "$ext" =~ ^(mp4|mov)$ ]] || ext=mp4
  local frames="${SK_FRAMES:-500}" iterations="${SK_ITERATIONS:-30000}" method="${SK_METHOD:-splatfacto-big}"
  [[ "$frames" =~ ^[0-9]+$ ]] || frames=500
  [[ "$iterations" =~ ^[0-9]+$ ]] || iterations=30000
  [[ "$method" =~ ^splatfacto(-big)?$ ]] || method=splatfacto-big
  local limit="${SK_TIMEOUT_S:-14400}"
  [[ "$limit" =~ ^[0-9]+$ ]] || limit=14400

  # ── 0. curl (the image's CUDA runtime base has none) ─────────────────────
  if ! command -v curl > /dev/null; then
    echo "Installing curl…"
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends curl ca-certificates > /dev/null \
      || { echo "✗ Could not install curl: nothing can be reported."; self_terminate; exit 1; }
  fi

  # The container started again after this job had ended: do not train twice.
  if curl -fsS --retry 3 --connect-timeout 20 "$SK_STATUS_GET_URL" 2>/dev/null | grep -Eq '"stage": *"(done|failed)"'; then
    echo "This job has already ended (status.json says so): not training again."
    self_terminate
    exit 0
  fi

  WORK=/tmp/sk-train
  rm -rf "$WORK"
  mkdir -p "$WORK"
  LOG="$WORK/train.log"
  : > "$LOG"
  printf '%s' "$SK_FRAME_PY_B64" | base64 -d > "$WORK/gpu-frame.py"
  STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf 'starting' > "$WORK/stage"
  : > "$WORK/error"

  # Everything said from here on goes to the log (and to the pod's own log).
  exec > >(tee -a "$LOG") 2>&1

  trap on_exit EXIT
  heartbeat &
  HEARTBEAT=$!
  watchdog "$limit" &
  WATCHDOG=$!

  say "Sarekooche training — scene «${SK_SCENE:-?}», job ${SK_JOB:-?}, $(date -u)"
  nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || say "(nvidia-smi said nothing)"

  # ── 1. The video ──────────────────────────────────────────────────────────
  stage downloading "Downloading the video"
  local video="$WORK/video.$ext"
  curl -fsSL --retry 5 --retry-all-errors --connect-timeout 30 -o "$video" "$SK_VIDEO_URL" \
    || fail "Could not download the video from R2 (the link may have expired)."
  say "video: $(du -h "$video" | cut -f1)"

  # ── 2–3. Frames, and where the camera was for each ──────────────────────
  # ⚠️ A 360° WALK (founder, 2026-10-09: the Iranian plaza, an Insta360 X5
  # video cleaned in Insta360 Studio and exported as a 360° MP4). COLMAP
  # cannot read a panorama: nerfstudio cuts each equirectangular frame into
  # 8 ordinary views first (`--camera-type equirectangular`), and the bottom
  # fifth — the person holding the camera — is cropped away. The views of one
  # frame are not neighbours in time, so matching uses the vocabulary tree
  # (finds overlaps anywhere) instead of «sequential». Detected by shape: a
  # 2:1 video is a panorama (or SK_EQUIRECT=1 / 0 to force it).
  # A phone video takes the path below it: sharpest frames, COLMAP run here.
  local equi="${SK_EQUIRECT:-}"
  if [[ -z "$equi" ]]; then
    local wh
    wh=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$video" 2>/dev/null || true)
    if [[ "$wh" =~ ^([0-9]+)x([0-9]+)$ ]] && (( BASH_REMATCH[1] == 2 * BASH_REMATCH[2] )); then equi=1; else equi=0; fi
  fi
  local data="$WORK/data" model cut
  # Phone frames are cut at ≤ 1600 px and train at that size; a panorama's
  # views are sized by nerfstudio, and its dataparser picks their scale.
  local scale=(--downscale-factor 1)
  if [[ "$equi" == 1 ]]; then
    # 160 frames (1 280 views) ran past 3 h in COLMAP's mapper on an L4
    # (2026-10-09, the plaza): mapping grows much faster than the image
    # count, and every 360° frame already sees all round — 96 is plenty.
    (( frames > 96 )) && frames=96
    local proc=(--camera-type equirectangular --images-per-equirect 8 --crop-factor 0 0.2 0 0 --matching-method vocab_tree)
    say "A 360° video: each of $frames frames becomes 8 views, the bottom fifth (the operator) cropped."
    stage matching "Finding where the camera was for each view (COLMAP, 360°) — 40 to 90 min"
    ns-process-data video --data "$video" --output-dir "$data" \
      --num-frames-target "$frames" "${proc[@]}" --verbose || true
    if [[ ! -s "$data/transforms.json" ]]; then
      say "No transforms.json with GPU feature extraction — trying again on the CPU (slower)."
      rm -rf "$data"
      ns-process-data video --data "$video" --output-dir "$data" \
        --num-frames-target "$frames" "${proc[@]}" --verbose --no-gpu || true
    fi
    [[ -s "$data/transforms.json" && -s "$data/colmap/sparse/0/images.bin" ]] \
      || fail "COLMAP could not work out where the camera was. Walk again more slowly, with more detail in view."
    rm -f "$video"
    model="$data/colmap/sparse/0"
    cut=$(( frames * 8 ))
    scale=()
  else
    # ── 2. Frames: many cut, the sharpest kept ───────────────────────────────
    stage matching "Choosing the sharpest frames"
    local cand="$WORK/cand"
    mkdir -p "$data/images" "$cand"
    local duration fps
    duration=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$video" 2>/dev/null || echo 0)
    # About three candidates per kept frame, between 1 and 10 a second.
    fps=$(awk -v d="$duration" -v n="$frames" 'BEGIN { f = (d > 0) ? 3 * n / d : 4; if (f < 1) f = 1; if (f > 10) f = 10; printf "%.3f", f }')
    say "video: ${duration%.*} s; cutting $fps frames a second at ≤ 1600 px"
    # ≤ 1600 px on the long side: what splatfacto trains at without shrinking
    # (nerfstudio_dataparser.py MAX_AUTO_RESOLUTION; 4K was trained at 960 px).
    ffmpeg -hide_banner -loglevel error -i "$video" \
      -vf "fps=$fps,scale='if(gt(iw,ih),min(1600,iw),-2)':'if(gt(iw,ih),-2,min(1600,ih))'" \
      -q:v 2 "$cand/c_%05d.jpg" || fail "ffmpeg could not read the video."
    python3 "$WORK/gpu-frame.py" pick-frames "$cand" "$data/images" "$frames" || fail "Could not choose frames from the video."
    rm -rf "$cand" "$video"
    cut=$(find "$data/images" -name 'frame_*' | wc -l)

    # ── 3. Where the phone was (COLMAP, run here rather than by ns-process-data:
    #    more neighbours matched, loops closed, and the biggest model kept) ─────
    stage matching "Finding where the phone was for each of $cut frames (COLMAP) — 20 to 60 min"
    local db="$data/colmap/database.db" sparse="$data/colmap/sparse"
    mkdir -p "$sparse"
    local gpu=1
    colmap feature_extractor --database_path "$db" --image_path "$data/images" \
      --ImageReader.single_camera 1 --ImageReader.camera_model OPENCV --SiftExtraction.use_gpu 1 \
      || { say "GPU feature extraction failed — on the CPU instead (slower)."; gpu=0; rm -f "$db"
           colmap feature_extractor --database_path "$db" --image_path "$data/images" \
             --ImageReader.single_camera 1 --ImageReader.camera_model OPENCV --SiftExtraction.use_gpu 0 \
             || fail "COLMAP could not read the frames."; }
    # Each frame against its 20 neighbours (and 1, 2, 4 … 2^k further: quadratic),
    # plus loop detection — a store walk passes the same shelves again.
    local loop=()
    if curl -fsSL --retry 3 --connect-timeout 30 -o "$WORK/vocab_tree.bin" "https://demuc.de/colmap/vocab_tree_flickr100K_words32K.bin"; then
      loop=(--SequentialMatching.loop_detection 1 --SequentialMatching.vocab_tree_path "$WORK/vocab_tree.bin")
    else
      say "(no vocabulary tree to download: matching without loop detection)"
    fi
    colmap sequential_matcher --database_path "$db" --SiftMatching.use_gpu "$gpu" \
      --SequentialMatching.overlap 20 --SequentialMatching.quadratic_overlap 1 "${loop[@]}" \
      || colmap sequential_matcher --database_path "$db" --SiftMatching.use_gpu "$gpu" --SequentialMatching.overlap 20 \
      || fail "COLMAP could not match the frames."
    # Placing a frame needs 15 inliers at a 15 % ratio (defaults 30 and 25 %):
    # fewer frames dropped where the shelves look alike.
    colmap mapper --database_path "$db" --image_path "$data/images" --output_path "$sparse" \
      --Mapper.ba_global_function_tolerance=1e-6 \
      --Mapper.abs_pose_min_num_inliers 15 --Mapper.abs_pose_min_inlier_ratio 0.15 \
      || fail "COLMAP could not work out where the phone was. Film again more slowly, with more overlap and detail in view (see the filming guide)."
    model=$(python3 "$WORK/gpu-frame.py" largest-model "$sparse") \
      || fail "COLMAP could not work out where the phone was. Film again more slowly, with more overlap and detail in view (see the filming guide)."
    say "training on COLMAP model $(basename "$model")"
    colmap bundle_adjuster --input_path "$model" --output_path "$model" --BundleAdjustment.refine_principal_point 1 \
      || say "(refining the lens failed; going on with COLMAP's own)"
    rm -f "$db"
  fi

  # COLMAP's own world (y down, like Brush's output), not nerfstudio's z-up one.
  python3 "$WORK/gpu-frame.py" rewrite-transforms "$data" "$model"
  local matched
  matched=$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["frames"]))' "$data/transforms.json")
  say "COLMAP placed $matched of $cut frames."
  (( matched >= 20 )) || fail "COLMAP placed only $matched frames — too few for a scene. Film again more slowly, with more overlap."

  # ── 4. Training ──────────────────────────────────────────────────────────
  # splatfacto-big: more, finer splats (method_configs.py). Every frame
  # trains (--eval-mode all; nerfstudio holds 10 % back by default), a phone
  # frame at its full 1600 px (--downscale-factor 1), and a bilateral grid absorbs the
  # phone's exposure and white-balance drift so it is not baked in as smears.
  stage training "Training the splat ($iterations steps, $method) — 40 to 90 min"
  local out="$WORK/out"
  ns-train "$method" \
    --data "$data" \
    --output-dir "$out" --experiment-name scene --timestamp run \
    --max-num-iterations "$iterations" \
    --vis tensorboard \
    --viewer.quit-on-train-completion True \
    --pipeline.model.use-bilateral-grid True \
    nerfstudio-data --orientation-method none --center-method poses --eval-mode all "${scale[@]}" \
    || fail "Training stopped with an error (see the log)."
  local run="$out/scene/splatfacto/run"
  [[ -s "$run/config.yml" && -s "$run/dataparser_transforms.json" ]] || fail "Training wrote no config.yml / dataparser_transforms.json."

  # ── 5. Export ────────────────────────────────────────────────────────────
  stage exporting "Writing the splat file (a few minutes)"
  ns-export gaussian-splat --load-config "$run/config.yml" --output-dir "$WORK/export" \
    || fail "Exporting the splat failed (see the log)."
  [[ -s "$WORK/export/splat.ply" ]] || fail "The export wrote no splat.ply."

  # ── 6. Back to COLMAP's frame ────────────────────────────────────────────
  stage framing "Putting the splat and the route in the same coordinates"
  python3 "$WORK/gpu-frame.py" unnormalize "$WORK/export/splat.ply" "$run/dataparser_transforms.json" "$WORK/splat.ply"
  python3 "$WORK/gpu-frame.py" cameras "$data/transforms.json" "$WORK/cameras.json"
  rm -f "$WORK/export/splat.ply"

  # ── 7. Results ───────────────────────────────────────────────────────────
  stage uploading "Uploading the splat ($(du -h "$WORK/splat.ply" | cut -f1)) to R2"
  put "$WORK/splat.ply" "$SK_PLY_URL" || fail "Could not upload the splat to R2."
  put "$WORK/cameras.json" "$SK_CAMERAS_URL" || fail "Could not upload cameras.json to R2."

  : > "$WORK/error"  # finished after all (the pod outlived its time limit): no stale error
  stage "done" "Done"
  say "Finished: $(date -u)"
}

say() { printf '%s\n' "$*"; }

# stage <id> <words>: what the operator's screen shows; status.json goes out at once.
stage() {
  printf '%s' "$1" > "$WORK/stage"
  printf '%s' "$2" > "$WORK/stage_words"
  say ""
  say "━━ $2"
  push_status || true
}

fail() {
  printf '%s' "$*" > "$WORK/error"
  say "✗ $*"
  exit 1
}

# put <file> <presigned url>: one PUT, retried. No Content-Type: the URL is signed without one.
put() {
  curl -fsS --retry 5 --retry-all-errors --connect-timeout 30 -X PUT -T "$1" "$2" -o /dev/null
}

# status.json from the stage files and the log's tail (Python writes the JSON, so any text is safe).
push_status() {
  python3 - "$WORK" "$STARTED" "${SK_JOB:-}" "${SK_SCENE:-}" > "$WORK/status.json" <<'PY' || return 1
import json, re, sys, datetime
work, started, job, scene = sys.argv[1:5]
def read(name):
    try:
        with open(f"{work}/{name}", encoding="utf-8", errors="replace") as f:
            return f.read().strip()
    except OSError:
        return ""
try:
    with open(f"{work}/train.log", "rb") as f:
        f.seek(0, 2)
        f.seek(max(0, f.tell() - 65536))
        raw = f.read().decode("utf-8", "replace")
except OSError:
    raw = ""
text = re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", "", raw)
lines = [l.strip() for l in re.split(r"[\r\n]+", text) if l.strip()]
stage = read("stage") or "starting"
percent = None
if stage == "training":
    # nerfstudio's progress table: "29990 (99.97%)  ..." in the "Step (% Done)" column.
    hits = re.findall(r"\b\d+ \((\d{1,3}(?:\.\d+)?)%\)", text)
    if hits:
        percent = min(100.0, float(hits[-1]))
elif stage == "done":
    percent = 100.0
json.dump({
    "v": 1, "job": job, "scene": scene, "stage": stage, "words": read("stage_words"),
    "percent": percent, "error": read("error") or None, "log": [l[:300] for l in lines[-15:]],
    "startedAt": started, "updatedAt": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
}, sys.stdout)
PY
  curl -fsS --retry 3 --connect-timeout 20 -X PUT -T "$WORK/status.json" "$SK_STATUS_URL" -o /dev/null
}

heartbeat() {
  trap - EXIT
  while sleep 30; do push_status || true; done
}

# watchdog <seconds>: at the time limit, say so, hand in the log and delete the pod.
watchdog() {
  trap - EXIT
  sleep "$1"
  printf 'Stopped by the time limit (%s h).' "$(awk -v s="$1" 'BEGIN { printf "%g", s / 3600 }')" > "$WORK/error"
  printf 'failed' > "$WORK/stage"
  say "✗ Time limit reached."
  push_status
  put "$LOG" "$SK_LOG_URL"
  self_terminate
}

# Delete this pod (RunPod's REST v2, then v1 until it retires on 2026-11-15),
# with the pod-scoped key RunPod injects. Our server does it too; this covers
# the server being down.
self_terminate() {
  if [[ -z "${RUNPOD_POD_ID:-}" || -z "${RUNPOD_API_KEY:-}" ]] || ! command -v curl > /dev/null; then
    echo "(cannot delete this pod from inside it; the server will)"
    return 0
  fi
  local url
  for url in "https://api.runpod.io/v2/pods/$RUNPOD_POD_ID" "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID"; do
    if curl -fsS --retry 3 --connect-timeout 20 -X DELETE -H "Authorization: Bearer $RUNPOD_API_KEY" "$url" -o /dev/null; then
      echo "Pod $RUNPOD_POD_ID deleted."
      return 0
    fi
  done
  echo "(this pod could not delete itself; the server will)"
}

on_exit() {
  local code=$?
  set +e
  [[ -n "${HEARTBEAT:-}" ]] && kill "$HEARTBEAT" 2>/dev/null
  [[ -n "${WATCHDOG:-}" ]] && kill "$WATCHDOG" 2>/dev/null
  if [[ $code -ne 0 ]]; then
    if [[ ! -s "$WORK/error" ]]; then
      printf 'Stopped while «%s» (exit %s) — see the log.' "$(cat "$WORK/stage" 2>/dev/null)" "$code" > "$WORK/error"
    fi
    printf 'failed' > "$WORK/stage"
  fi
  push_status
  sleep 1  # let tee write the last lines
  put "$LOG" "$SK_LOG_URL"
  self_terminate
  exit "$code"
}

main "$@"
