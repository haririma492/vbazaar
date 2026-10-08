SAREKOOCHE — MAKING A SCENE LOOK NEW (AI restoration on a rented GPU)
====================================================================

What this does
--------------
It takes one of our 3D scenes (for example «iranianplaza1») and, on a rented
GPU computer:

  1. Takes the CARS OUT. It finds cars, vans, trucks, motorbikes, scooters,
     bicycles and carts in thousands of pictures along the cameraman's path,
     removes them from the 3D scene, and lays new road where they stood.
  2. CLEANS every picture (NVIDIA Fixer removes blur and smears; then one
     gentle clean-up: even colour, less noise, stains and grime lifted).
  3. Makes walls, road, doors and shutters look NEW («as new» AI,
     Qwen-Image-Edit) on about 160 key pictures. SHOP SIGNS ARE NEVER TOUCHED:
     they are found and put back exactly as they were, and so are the goods
     in shop windows. (Signs are changed
     separately, by hand, with the «replace sign» tool in the viewer.)
  4. Repaints the 3D scene's colours to match. Except where cars were removed,
     nothing moves: every splat stays where it was, the same size and shape.

The result is one new file that you upload on our operator page, plus a
picture to judge it by.

Honest note: the «as new» AI works picture by picture. The 3D scene averages
the pictures, so the result is cleaner and newer-looking but softer than a
single AI picture — look at the before/after sheet before uploading.

Time and cost (1× A100 80 GB at about $1.59/hour, a 6-million-splat scene):
  first scene   about 2½–3 hours  →  about $4–5
                (about 40 minutes of that is the computer setting itself up
                 and downloading about 70 GB of AI models)
  second scene on the same pod: about 2 hours → about $3.
Put $15 in; you will have some left.


1. Make a RunPod account and add money (once)
----------------------------------------------
  a. Go to https://www.runpod.io and sign up.
  b. Billing → add $15 (card).


2. Start a GPU computer ("pod")
-------------------------------
  a. Left menu → Pods → «+ Deploy».
  b. GPU: choose «A100» 80 GB (PCIe or SXM — either). Quantity 1.
     Do not choose a smaller card: the «as new» AI needs 80 GB.
  c. Template: «PyTorch 2.8.0» (RunPod's own; "Prebuilt PyTorch 2.8 with
     CUDA 12.8").
  d. Storage: «Container Disk» 120 GB. No network volume is needed.
     Note: everything on this pod is deleted when you terminate it — that is
     fine, you will download the two result files first.
  e. Press «Deploy On-Demand». Wait until it says «Running» (1–3 minutes).


3. Paste ONE command
--------------------
  a. On the pod, press «Connect» → «Open Web Terminal» (or «Start Web
     Terminal», then «Connect to Web Terminal»). A black window opens.
  b. Paste this line and press Enter:

       curl -fsSL https://sarekooche.com/gpu/restore.sh | bash -s iranianplaza1

     (For the second scene, replace iranianplaza1 with that scene's id.)
  c. Wait. It prints what it is doing in plain English. The long parts are
     «Setting up NVIDIA Fixer» (first time only), «Renovating key views» and
     «Re-fitting colours». You can close the browser tab: it keeps running.
     To watch again later, open a new web terminal and type:
         tail -f /workspace/restore/iranianplaza1.log
  d. If anything stops it (a lost connection, for example), paste the SAME
     command again. It carries on where it stopped; finished steps are
     skipped.
  e. If NVIDIA Fixer cannot be set up on this computer, it says so and goes
     on without it. You still get a good result.

  At the end it prints «FINISHED», how long it took, about what it cost, and
  the two files.


4. Download the two files
-------------------------
  a. On the pod, «Connect» → «Connect to Jupyter Lab» (port 8888).
  b. In the left panel, open the folder «workspace», then «out».
  c. Right-click each file → «Download»:
       iranianplaza1-before-after.jpg   ← look at this first
       iranianplaza1-restored.ply       ← the new scene (large: about 0.5–2 GB)
  d. Open the .jpg. Three columns, 8 places in the scene:
       left   = before
       middle = the AI's picture (what it aimed for)
       right  = after (the restored 3D scene)
     If you don't like it, DON'T upload; just terminate the pod (step 6).


5. Put the restored scene on the site
-------------------------------------
  a. On a computer (not a phone — the page converts the file and needs about
     4 GB of memory), open https://sarekooche.com/operator/splats
  b. Section «1 · Upload scenes»: press «Choose Files» and pick
     iranianplaza1-restored.ply.
  c. IMPORTANT: in the «Scene id» box it guesses «iranianplaza1-restored».
     Change it to exactly:   iranianplaza1
     It then says «iranianplaza1 is already in the tour: its exits stay, its
     file is replaced» — that is what we want (route, exits, start and
     joins all stay).
  d. Leave «convert to .spz here» ticked. Leave the title empty.
  e. Press «Start». It uploads the .ply as the scene's new master, converts
     it, uploads the web copy and points the tour at it. Wait for «done».
  f. Section «2 · Tour — where visitors can go»: find «iranianplaza1» and
     press «Make the streamed copy (phone-safe, fast)» (or «Remake the
     streamed copy (fast)»). Wait for «done in … s».
  g. Press «View» next to it to walk the restored scene.


6. STOP AND TERMINATE THE POD (billing stops only then)
-------------------------------------------------------
  a. runpod.io → Pods → your pod → «Stop», then the bin icon «Terminate».
  b. Check the pod is gone from the list.
  Do this as soon as the two files are downloaded — even if you are going to
  do the second scene tomorrow. (Doing both scenes on the same pod, one after
  the other, saves the setup time.)


Switches (add after the scene id)
---------------------------------
  --no-cars       keep the vehicles
  --fixer off     skip NVIDIA Fixer (saves about 40 minutes the first time)
  --no-renovate   skip the «as new» AI (about 1 hour, about $1.60, cars out
                  and cleaned only)
  --edit-views 80 fewer AI key views (faster, a bit less even)
  --strength 0.8  stronger gentle clean-up (0.4 gentler; default 0.6)
  --source "LINK" use the scene's full-quality master: on /operator/splats,
                  «Files in R2», press «Copy 24 h download link» next to the
                  master .ply and paste it in place of LINK.
Example:
  curl -fsSL https://sarekooche.com/gpu/restore.sh | bash -s iranianplaza1 --fixer off

The original scene is never deleted: the old master and web copy stay in R2
(«Files in R2»).


Licences (commercial use)
-------------------------
- gsplat (rendering and colour fitting): Apache-2.0.
- Grounding DINO (finds cars and signs): Apache-2.0.
- SAM 2.1 (outlines them exactly): Apache-2.0.
- Qwen-Image-Edit-2511 («as new» AI): Apache-2.0.
- NVIDIA Fixer: code Apache-2.0; weights under the NVIDIA Open Model License,
  whose model card says commercial use is allowed. To be confirmed by counsel
  before launch.
- Our own code: the clean-up, the car removal and the colour fitting.
- Not used, on purpose: Difix, ArtiFixer, SUPIR, GaussianEditor (not for
  commercial use), Ultralytics YOLO (AGPL), and no AI ever redraws a shop
  sign or the goods in a window.
- An «as new» scene is an enhanced picture of the place: label it so
  (docs/research/splat-restoration.md §6).
