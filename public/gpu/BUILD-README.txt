SAREKOOCHE — MAKING A 3D SCENE FROM A 360° WALK VIDEO (on a rented GPU)
=======================================================================

What this does
--------------
You film a walk with the Insta360 (X4 or X5), clean it in Insta360 Studio,
and export it as one 360° MP4. A rented GPU computer turns that video into a
3D scene that visitors can walk through (a "Gaussian splat" .ply file) — the
same kind of file Splatica made for us, made by us, with no Splatica account.

On the GPU computer it:
  1. picks about 2 sharp frames per second of video (blurry moments and
     moments where you stood still are left out);
  2. cuts every 360° frame into 16 ordinary camera pictures (8 around, 4 a bit
     down, 4 a bit up) and blanks out the area right under the camera (you
     and the stick) and right above it;
  3. works out where the camera was for every frame (COLMAP);
  4. stands the scene upright and sizes it in metres;
  5. trains the 3D scene (Brush, or gsplat when Brush cannot run on that
     computer — same kind of result);
  6. writes the scene, the walking route, a preview picture and a summary.

The result is a file you upload on our operator page, exactly like a
Splatica .ply.

Time and cost (a 2-minute 8K walk; ESTIMATES — the first real run will tell):
  1× A40 48 GB at about $0.49/hour:   about 2–3 hours   →  about $1–1.50
  1× L40S 48 GB at about $0.79/hour:  about 1½–2½ hours →  about $1.20–2
  1× A100 80 GB at about $1.59/hour:  about 1½–2½ hours →  about $2.50–4
  plus the time the pod is on while the video uploads (step 3).
  The parts: setting up ~10 min (first time), frames ~5–10 min, camera
  positions (COLMAP) ~25–45 min, training ~1–2 hours, finishing ~5 min.
Put $10 in; you will have most of it left.


1. Export the video from Insta360 Studio
----------------------------------------
  a. Open the clip in Insta360 Studio and apply your cleaning as usual
     (denoise, brighter colour). Keep the horizon level («Direction lock» /
     «Horizon lock» on — the default): the builder takes the picture's
     «down» as the real down.
  b. Do NOT reframe it (no keyframes, no «flat» view, no tiny-planet).
     Trim the start and end if you like (the minutes before you start
     walking).
  c. Export:
       Format / type:   360° video (equirectangular), NOT «reframed»/«flat»
       Resolution:      the full resolution (8K: 7680×3840 on the X4/X5;
                        5.7K is also fine)
       Encoding:        H.265 (smaller file) or H.264
       Bitrate:         about 100–150 Mbps is plenty (a 2-minute 8K file of
                        about 1.5–2.5 GB uploads much faster than 5 GB)
       Frame rate:      as filmed (24, 25 or 30)
       Stabilisation:   keep FlowState and the horizon lock ON
  d. Rename the file to something short WITHOUT SPACES, e.g.  plaza.mp4

  Filming tips (they matter more than any setting):
     walk slowly and steadily (normal walking pace or slower); keep the
     camera at the same height all the way (above your head is good — the
     builder assumes about 2.0 m above the ground; if yours was different,
     see «Switches»); avoid sudden turns; walk past every shopfront you
     want, and loop back to where you started if you can.


2. Start a GPU computer ("pod") on RunPod
-----------------------------------------
  a. https://www.runpod.io → sign in → Billing: have at least $10.
  b. Left menu → Pods → «+ Deploy».
  c. GPU: «A40» 48 GB (cheapest that is fast enough; $0.49/h when we looked).
     «L40S» (faster) or «A100» are fine too. Quantity 1.
  d. Template: «Runpod Pytorch 2.8.0» (RunPod's own; image
     runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404).
  e. Storage — press «Edit Template» (or the pencil next to the disks):
       Container Disk:  50 GB
       Volume Disk:     100 GB   ← this is /workspace, where the video and
                                   all the work go
     (If you see only one disk, make it 120 GB.) Why so much: for a 2-minute
     8K walk the video is 2–5 GB, the frames about 3 GB, the 16 camera views
     about 4 GB, COLMAP's database about 3–5 GB, training and the result
     about 3–5 GB: about 25 GB at the peak. The builder checks the space
     first and stops at once, saying so, if it is too small.
  f. Press «Deploy On-Demand». Wait until it says «Running» (1–3 minutes).
     Note: everything on this pod is deleted when you terminate it — that is
     fine, you will download the result first.


3. Upload the video
-------------------
  a. On the pod: «Connect» → «Connect to Jupyter Lab» (port 8888).
  b. The left panel shows the folder «workspace». Drag plaza.mp4 into it
     (or press the upload arrow ↑ above the file list and choose it).
  c. Wait until the upload bar at the bottom is finished and the file shows
     its full size (a 2 GB file takes about 5 minutes on a fast connection,
     longer on a slow one). Do not start step 4 before it is complete.


4. Paste ONE command
--------------------
  a. On the pod: «Connect» → «Open Web Terminal» (or «Start Web Terminal»,
     then «Connect to Web Terminal»). A black window opens.
  b. Paste this line and press Enter (change plaza.mp4 to your file's name,
     and plaza1 to the scene name you want — lowercase letters, digits and
     hyphens):

       curl -fsSL https://sarekooche.com/gpu/build-scene.sh | bash -s /workspace/plaza.mp4 plaza1

  c. Wait. It prints what it is doing in plain English. The long parts are
     «Working out where the camera was» and «Training the Gaussian splats».
     You can close the browser tab: it keeps running. To watch again later,
     open a new web terminal and type:
         tail -f /workspace/build/plaza1/log.txt
  d. If anything stops it (a lost connection, for example), paste the SAME
     command again. It carries on where it stopped; finished steps are
     skipped (training carries on from its last checkpoint).
  e. If Brush cannot run on this computer it says so and trains with gsplat
     instead. You still get the same kind of result.

  At the end it prints «FINISHED», how long each part took, about what it
  cost, how much of the walk it could place («Registered … frames»), and the
  files.


5. Download the files
---------------------
  a. In Jupyter's left panel open «workspace» → «build» → «plaza1».
  b. Right-click each file → «Download»:
       plaza1-preview.jpg    ← look at this first: left = the photo,
                               right = the 3D scene from the same spot
       plaza1.ply            ← the scene (large: about 1–2 GB)
       plaza1-cameras.json   ← the route you walked (small)
       summary.txt           ← the numbers, for the developer
  c. If the right-hand pictures are mush, or «Registered» in summary.txt is
     low (under about 70% of the frames), DON'T upload; terminate the pod
     (step 7) and send summary.txt and log.txt to the developer.


6. Put the scene on the site
----------------------------
  a. On a computer (not a phone — the page converts the file and needs about
     4 GB of memory), open https://sarekooche.com/operator/splats
  b. Section «1 · Upload scenes»: press «Choose Files» and pick plaza1.ply.
  c. «Scene id» is guessed from the file name: plaza1. Keep it (or type the
     id you want). Leave the title empty or type one.
  d. Leave «convert to .spz here» TICKED.
  e. Press «Start». It uploads the .ply as the scene's master, converts it,
     uploads the web copy and adds the scene to the tour. Wait for «done».
  f. Section «2 · Tour — where visitors can go»: find «plaza1».
       «flip upright»: leave it TICKED (it is ticked by default). The
       builder writes the scene the same way up as Splatica's files.
     Press «Make the streamed copy (phone-safe, fast)». Wait for «done in … s».
  g. Optional, the walking route: back in «1 · Upload scenes» choose
     plaza1-cameras.json, set its «Scene id» to plaza1, press «Start». The
     tour then knows the path you walked (check it in the viewer's edit
     mode: the blue line).
  h. Press «View» next to plaza1 to walk the new scene.


7. STOP AND TERMINATE THE POD (billing stops only then)
-------------------------------------------------------
  a. runpod.io → Pods → your pod → «Stop», then the bin icon «Terminate».
  b. Check the pod is gone from the list.
  Do this as soon as the files are downloaded. (To build a second walk, do
  it on the same pod first — upload the next video and paste the command
  with its name; the setup is then skipped.)


Switches (add after the scene name)
-----------------------------------
  --camera-height 2.3   how high the camera was above the ground, in metres
                        (default 2.0). Only the scene's size depends on it.
  --fps 3               more frames per second of video (slower walk-throughs
                        of narrow places; default 2)
  --nadir-mask 45       blank a wider area under the camera (if you or the
                        stick still show up as smears near the ground;
                        default 35°)
  --trainer gsplat      skip Brush and train with gsplat
  --steps 20000         a shorter training (faster, a bit softer; default 30000)
  --max-splats 5000000  a lighter scene (default 7 million)
Example:
  curl -fsSL https://sarekooche.com/gpu/build-scene.sh | bash -s /workspace/plaza.mp4 plaza1 --camera-height 2.3


Honest limits
-------------
- Things that MOVE while you film — people, cars, shopping carts, flags,
  trees in wind — come out as smears or ghosts, and parked cars become part
  of the scene. Film when the plaza is quiet.
- The camera height matters: everything is seen from that one height. A
  visitor's eye stays near the height you walked at; looking from much
  lower or higher shows gaps and blur. Places you never walked near (the far
  end of the parking lot, the top of the shade roof) are softer.
- The sky and very shiny glass come out blotchy; plain white walls can wobble.
- Under the camera, the 35° circle where you and the stick were is blanked:
  the ground right under your path is only seen from a few steps away.
- How good it is compared with Splatica is not known until the first real
  walk is built: try one walk, compare the preview and the scene with the
  Splatica version, then decide.
- These are first runs of new code on a rented machine. If a step fails
  twice, send /workspace/build/<name>/log.txt to the developer.


Licences (commercial use)
-------------------------
- COLMAP / pycolmap 4.2.1 (camera positions; includes GLOMAP's global
  mapper): BSD-3-Clause.
- Brush v0.3.0 (training, when the pod gives it Vulkan): Apache-2.0.
- gsplat 1.5.3 (training otherwise, and the preview pictures): Apache-2.0.
- PyTorch: BSD-3-Clause. OpenCV: Apache-2.0. NumPy, SciPy: BSD-3-Clause.
  Pillow: MIT-CMU.
- FFmpeg (reads the video): Ubuntu's package, run as a separate program on
  the rented computer; nothing of it is copied into our files or our site.
- COLMAP's vocabulary tree (finding loops in the walk): from COLMAP's own
  release, BSD-3-Clause.
- Our own code: the frame picking, the 360° cutting, the upright/metric
  step and the training loop.
- Nothing asks for or uses an account, password or token.
