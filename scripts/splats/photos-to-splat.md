# A 3D scan of a store with only a phone, for `/vca/splat`

You film the store with your phone. Your computer then works out where the
phone was for each frame (**COLMAP**), and trains a 3D "splat" of the store
from those frames (**Brush**). You upload the result at `/operator/splats`, and
customers can walk through the store at `/vca/splat`.

You need a **Mac with an M chip** (M1 or newer, 16 GB of memory or more is best)
or a **Windows PC with a graphics card**, about 30 GB of free disk space, and an
afternoon. Most of that time the computer works by itself.

On a Mac, `scripts/splats/photos-to-splat.sh` runs steps 3 to 6 in one go
(see **The quick way on a Mac**).

---

## 1. Install the three programs (once)

**Mac.** Install [Homebrew](https://brew.sh), then in *Terminal*:

```
brew install ffmpeg colmap
```

**Windows.**
- ffmpeg: in *PowerShell*, `winget install --id Gyan.FFmpeg -e`
  (or download it from <https://ffmpeg.org/download.html>).
- COLMAP: from <https://github.com/colmap/colmap/releases> download
  `colmap-x64-windows-cuda.zip` if the PC has an **NVIDIA** card, otherwise
  `colmap-x64-windows-nocuda.zip`. Unzip it, e.g. to `C:\COLMAP`. You start it
  with `COLMAP.bat` (double-click for the window, or `C:\COLMAP\COLMAP.bat` in
  PowerShell for commands). Windows may warn that it is unsigned; choose
  *More info → Run anyway*.

**Brush** (both). From <https://github.com/ArthurBrussee/brush/releases>
(version **v0.3.0**) download:
- Mac: `brush-app-aarch64-apple-darwin.tar.xz` (double-click to unpack)
- Windows: `brush-app-x86_64-pc-windows-msvc.zip` (unzip)

The program inside is called **`brush_app`** (`brush_app.exe` on Windows). It
is one program for both the window and the command line. On a Mac, macOS may
refuse to open it the first time because it was downloaded; run this once in
Terminal (drag the file into the window instead of typing its path):

```
xattr -d com.apple.quarantine ~/Downloads/brush-app-aarch64-apple-darwin/brush_app
```

---

## 2. Film the store

**Before you start**
- Use the normal **1×** lens. Don't use 0.5× or zoom.
- iPhone: *Settings → Camera → Record Video* → **4K at 30 fps**, and turn
  **HDR Video off**. Turn off Action mode and Cinematic mode.
  (Android: 4K 30 fps, HDR off, in the camera settings.)
- Turn on **every light** in the store, close blinds that let in direct sun, and
  keep the lights the same the whole time. Make sure **nobody is in the store**,
  and nothing moves: no fans, no screens playing video, no open doors.
- In the Camera app, **press and hold** on a shelf at normal distance until
  **AE/AF LOCK** appears. This locks focus and brightness. Without the lock the
  phone keeps changing them, and the scan comes out blotchy.

**While filming** (one video, about 3–6 minutes):
1. **Walk each wall twice**: once with the phone at **chest height**, pointing
   straight at the shelves, then again at **head height** tilted slightly down.
2. Walk **slowly**, about half your normal pace. Hold the phone with both
   hands and turn your whole body, not just the phone. Fast turns give blurry
   frames, and blurry frames are useless.
3. Make **close passes along the shelves** with the good china, about an arm's
   length away, sliding sideways. Don't point the phone at the plates from
   one spot.
4. Finish with **one loop through the middle of the store** that comes back
   to where you started, so the computer can connect the walls.
5. Avoid filming plain white walls, mirrors or windows on their own: always
   keep something with detail in view.

**Or take photos instead of a video:** 200–300 photos, each one overlapping the
last by about two thirds. Take a step between photos; don't just turn on the
spot. Follow the same route as above. iPhone: *Settings → Camera → Formats →*
**Most Compatible**, so the photos are JPEG (COLMAP can't read HEIC).

Copy the video (or photos) to the computer, e.g. AirDrop to a Mac, or a cable
to Windows.

---

## 3. Turn the video into photos

Make a folder for this scan, e.g. `store-scan`, with a folder `images` inside
it. Put the video in `store-scan`. Then, in Terminal (Mac) or PowerShell
(Windows), from inside `store-scan`:

```
ffmpeg -i walk.mov -vf fps=2 -q:v 2 images/frame_%05d.jpg
```

This saves **2 frames for every second** of video (`fps=2`) at high JPEG
quality (`-q:v 2`). A 4-minute video gives about 480 frames. ffmpeg turns the
frames upright by itself.

If you took photos instead, just copy them into `images`.

---

## 4. Delete the blurry frames

Open `images` with large thumbnails (Finder: *View → as Icons*, then make the
icons bigger; Windows: *View → Extra large icons*). Delete every frame that is
smeared, mostly floor or ceiling, shows a person, or is very dark. It's fine to
leave gaps in the numbering. Deleting 5–10% of the frames is normal.

---

## 5. Find the camera positions with COLMAP

Use **either** the window (5a) **or** the commands (5b). Both write the camera
positions into `store-scan/sparse/0`.

### 5a. With the COLMAP window

1. Open COLMAP (Mac: type `colmap gui` in Terminal; Windows: double-click
   `COLMAP.bat`).
2. *Reconstruction → Automatic reconstruction*:
   - **Workspace folder:** `store-scan`
   - **Image folder:** `store-scan/images`
   - **Data type:** *Video frames* (for photos: *Individual images*)
   - **Quality:** High
   - **Shared intrinsics:** ✔ (all frames come from one camera)
   - **Sparse model:** ✔ **Dense model:** ✘ (you don't need it, and it takes
     hours)
   - **GPU:** untick it on a Mac. On Windows, leave it ticked with the CUDA
     version of COLMAP.
   - Press **Run**. When it finishes you see dots (the store) and little red
     camera shapes (your path).
3. *Extras → Undistortion*: format **COLMAP**, `output_path` =
   `store-scan/dense`, then **Undistort**. Brush needs this step: it can't
   correct for the lens itself.

### 5b. With commands

Mac/Linux shown. On Windows write `C:\COLMAP\COLMAP.bat` instead of `colmap`, and put
each command on one line, without the `\` at the end of each line. Run them from inside
`store-scan`.

```
colmap feature_extractor --database_path database.db --image_path images \
  --ImageReader.single_camera 1

colmap sequential_matcher --database_path database.db
#   (for photos instead of a video: colmap exhaustive_matcher --database_path database.db)

mkdir sparse
colmap mapper --database_path database.db --image_path images --output_path sparse

colmap image_undistorter --image_path images --input_path sparse/0 \
  --output_path dense --output_type COLMAP --max_image_size 1920
```

**Mac:** the Mac version of COLMAP has no CUDA. If `feature_extractor` or the
matcher stops with a GPU or OpenGL error, add `--FeatureExtraction.use_gpu 0`
to the first command and `--FeatureMatching.use_gpu 0` to the matcher. COLMAP
older than 3.13 calls these `--SiftExtraction.use_gpu 0` and
`--SiftMatching.use_gpu 0`; `colmap feature_extractor -h` shows which ones your
version has.

The **mapper is the slow part**. It prints `Registering image #… (…)` as it
places each frame.

### Check that it worked

The number to look at is **how many frames were placed** ("registered"):

```
colmap model_analyzer --path sparse/0
```

Look for `Registered images:`. Compare it with the number of files in `images`.

- **90% or more**: good.
- **Less than about 80%**: parts of the store will be missing or blurry.
- **There is also a `sparse/1` (or `2`, …)**: COLMAP made more than one
  model. Run `model_analyzer` on each one and use the one with the **most**
  registered images. It isn't always `sparse/0`. Use it everywhere this guide
  says `sparse/0`: in `image_undistorter` and for the upload. If none of them
  has most of the frames, COLMAP split the store into pieces (see below).

### When COLMAP fails

You'll see one of these:
- very few registered images, or several pieces (`sparse/0`, `sparse/1`, …);
- in the window, a camera path that jumps, folds back on itself, or has walls
  at odd angles;
- the mapper stops with "No good initial image pair found" and writes nothing.

To fix it, try these in order, each in a **new, empty** folder:
1. Take **more frames**: run step 3 again with `fps=3`.
2. For a video, use the **sequential matcher**: it matches each frame with the
   ones just before and after it. In the window, that's *Data type: Video
   frames*. If the pieces still don't join, add
   `--SequentialMatching.loop_detection 1` to the matcher (COLMAP 3.12 and
   newer download what this needs by themselves), or try
   `exhaustive_matcher`. It's slow with many frames, but it's the most thorough.
3. **Film again** with more overlap: slower, closer, the double pass at
   two heights, and the loop at the end. Check the lights didn't change, the
   exposure was locked, and nobody walked through.

---

## 6. Train the splat with Brush

Mac/Linux (from inside `store-scan`, with the path to your `brush_app`):

```
~/Downloads/brush-app-aarch64-apple-darwin/brush_app dense \
  --total-steps 30000 --export-every 5000 \
  --export-path splat --export-name "splat_{iter}.ply"
```

Windows (PowerShell, from inside `store-scan`):

```
C:\Brush\brush_app.exe dense --total-steps 30000 --export-every 5000 --export-path splat --export-name "splat_{iter}.ply"
```

- `dense` is the undistorted folder from step 5. Give Brush **that** folder,
  not the whole `store-scan` folder: it uses the first camera file it finds.
- 30000 steps is Brush's default and gives the best quality. A copy is saved every
  5000 steps, so `splat/splat_05000.ply` already gives an early look while it
  keeps going.
- The finished file is **`splat/splat_30000.ply`**.
- Add `--with-viewer` to watch it train in a window. You can also open any
  `.ply` by starting `brush_app` with no arguments and dragging the file in.
- Brush uses frames up to 1920 pixels wide (`--max-resolution`, default 1920).
  Leave it there.

The `.ply` is a standard 3D Gaussian Splatting file (binary, full precision,
colour detail at SH degree 3). That is what `/operator/splats` and the viewer
read.

---

## The quick way on a Mac

Steps 3 to 6 in one command. It extracts the frames, runs COLMAP
(one camera; sequential matcher for a video, exhaustive for photos), undistorts,
trains with Brush, and prints the two files to upload:

```
scripts/splats/photos-to-splat.sh ~/Movies/walk.mov ~/store-scan
scripts/splats/photos-to-splat.sh ~/Pictures/store-photos ~/store-scan
```

The output folder must be new or empty. Settings go in front of the command,
e.g. `FPS=3 scripts/splats/photos-to-splat.sh …` for more frames, or
`BRUSH=~/Downloads/brush-app-aarch64-apple-darwin/brush_app` if `brush_app`
isn't on your PATH. `scripts/splats/photos-to-splat.sh --help` lists them all.
The script can't check for blurry frames, so film carefully (step 2) or do
steps 3 to 5 by hand.

---

## 7. Upload and look

At **sarekooche.com/operator/splats**, upload:
1. **The splat:** `splat/splat_30000.ply`. Big files are fine; they're stored
   and converted to the smaller `.spz` format for the web, and very large
   files are converted by the *Convert splat* workflow.
2. **The walk route:** `sparse/0/images.bin`, the camera path you walked.
   It sets the route the tour follows. `images.txt` works too: in the COLMAP
   window use *File → Export model as text*, or run
   `colmap model_converter --input_path sparse/0 --output_path sparse/0 --output_type TXT`.
   If COLMAP made several models, upload the `images.bin` of the one you
   undistorted and trained (the script picks the biggest and prints its path).
   `images.txt` is much bigger than `images.bin`, because it also lists every
   matched point, so upload `images.bin` when you can.

Then open **sarekooche.com/vca/splat** and walk through the store.

The splat and the route come from the same COLMAP run, so they line up.
Don't run *Normalize reconstruction* in COLMAP between the two, or the route
and the splat won't match any more.

---

## How long it takes (M-series Mac)

**These are estimates**, for a 4-minute video at `fps=2` (about 450 frames). Real
times depend on the chip, the memory and the store. An M1 is at the slow end,
an M3/M4 Pro or Max at the fast end.

| Step | Estimate |
|---|---|
| Filming | 15–30 min (plus clearing the store) |
| ffmpeg frames | 1–3 min |
| Deleting blurry frames | 10–20 min |
| COLMAP features (CPU on a Mac) | 5–15 min |
| COLMAP sequential matching | 10–30 min (exhaustive: 1–3 h) |
| COLMAP mapper | 15–60 min |
| Undistortion | 2–5 min |
| Brush, 30000 steps | 45 min – 2 h |
| **Total computer time** | **about 1.5–4 hours** |

Upload time depends on your connection. The `.ply` is usually a few hundred MB
up to a couple of GB.
