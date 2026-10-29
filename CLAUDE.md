# V-Bazaar — the Virtual Bazaar (VCA), vbazaar.app

**Its own repo and site since 2026-10-29** (owner: *"I have a new domain
v-bazzar.com … first copying and then moving all the code there"*; then the
same day: *"only vbazaar.app is mine"*, so the site is vbazaar.app). Copied out
of `Olgoo-Inc/olgoo-com/vca-app` with its history (`git subtree split`); it
runs on its own Railway service with `next start` (`Dockerfile`), and
`middleware.ts` sends www to the bare domain and `/` to `/demo`. Until the
move is finished, olgoo.com still serves the same app; after it, olgoo.com
301s these paths here. Notes below that say "olgoo.com" or "the root
`server.js`" describe that earlier home.

Moved to olgoo.com from the Sarekooche repo on 2026-10-15 (history kept). A Next.js
app served there by the root `server.js` at the paths it had on sarekooche.com:
`/vca`, `/vca/walk`, `/vca/splat`, `/vca/ride`, `/vb/…`, `/vr`, `/chinastore`,
`/demo`, `/operator/splats`, and its APIs under `/api/splats`,
`/api/operator/splats`, `/api/operator/check`, `/api/demo`.

- **The basket stays Sarekooche's.** «Add to Sarekooche basket» on a walk's
  product opens `sarekooche.com/basket?add=<line>` (`lib/sarekooche.ts`); the
  line id is `offer:walk-…`, which Sarekooche's basket rules know.
- **Checks before pushing:** in `vca-app/`, `npm run typecheck`, `npm test`,
  `npx next build`; then `node server.js` at the root and open `/vca/walk`.
- **Env (Railway, the v-bazzar service; same values as the olgoo.com service):** `R2_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_MASTERS_BUCKET`,
  `ADMIN_TOKEN` (the operator's), and at build time
  `NEXT_PUBLIC_SPLAT_BASE_URL`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
- **No GPU training here (owner, 2026-10-15):** *"RUNPOD_TRAIN no longer
  needed I was not happy with the result of training."* `RUNPOD_API_KEY` and
  the `RUNPOD_TRAIN_*` tunables are not set on olgoo.com, so «Train» on
  `/operator/splats` says it is not configured. The code stays as R&D; the
  splat notes below are history, not the path.

- **The demo without internet** (founder, 2026-10-18: "where I am going to
  demo there is no internet, how can I run a local version of
  olgoo.com/demo"): `npm run offline:pack` (with internet; `scripts/
  offline-pack.mjs`) fills `vca-app/offline/` from olgoo.com's PUBLIC
  addresses only — the walks file, /demo's walks and every shop a door leads
  into, a store's aisles, each walk's sound, the product lists, the intro and
  the 3D store; a file already there whole is skipped, one that fails is said
  and skipped. `npm run offline` (`scripts/offline.mjs`) builds once with
  `NEXT_PUBLIC_OFFLINE=1` and serves with `OFFLINE_DIR`: `r2Config()` turns
  every bucket read into the folder (`lib/splats/offline.ts`),
  `/api/offline/<key>` serves its files with byte ranges, and «Add to basket»
  keeps the line on the device. Saving is not offered offline.

The notes below came with it from Sarekooche's CLAUDE.md, unchanged.

## ⚠️ LOOP OR ONE PROMPT? — evaluate EVERY task before doing it (operator, 2026-10-26)

**Standing instruction for ALL of the operator's projects** — Nikoo.tv /
RadioOlgooStart, olgoo-com, sarekooche, **and every new project they start**
(a new repo copies these two sections into its own CLAUDE.md on day one). For every request, once you have
understood it, ask one question before starting: **would this be done better
by an agent running inside a loop than by answering one prompt at a time?**
Then say which, in one line, and recommend the loop when it wins.

A loop wins when the job has any of these shapes:
- **A queue to drain** — many rows/files/pages/accounts, each processed the
  same way (a batch, a backfill, a sweep, "do the next batch").
- **Repeat until a condition holds** — fix-build-test until green, retry until
  a deploy lands, re-check until CI passes, iterate until a measured target.
- **Waiting on something external** — a build, CI, a deploy, a PR review, a
  scheduled pipeline. Watch it (background task, Monitor, PR subscription,
  scheduled check-in) instead of the operator asking "is it done yet?".
- **Recurring work** — anything that should happen hourly/daily/weekly
  (a scheduled task or /loop, not a reminder to press a button).
- **Independent parallel parts** — the same job across several
  directories/channels/sources at once (subagents in parallel).

One prompt wins when it is a single edit, a question, a diagnosis, or a
deliberate one-off slice the operator chose ("just do one", "dry run it").
Then say so in ONE line and get on with it — do not turn an ordinary request
into a report.

When recommending a loop, state in the same breath: the **bounded slice**,
the **stopping condition** (queue empty / two rounds with no progress /
failures = attempts), and the **cost ceiling** if it spends money (paid APIs,
LLM passes). A loop without a stopping condition is a new bug. Anything that
spends money, is irreversible (deletes, purges, pushes to main), or touches a
live broadcast still waits for the operator's yes. Otherwise recommend AND
run it in the same turn — an offer the operator must accept is one more click.

## ⚠️ WORK SMARTER (operator, 2026-10-26)

**Standing instruction for ALL of the operator's projects** — Nikoo.tv /
RadioOlgooStart, olgoo-com, sarekooche, **and every new project they start**
(a new repo copies these two sections into its own CLAUDE.md on day one). Claude Code can now run agents:
subagents that work in parallel, workflows that coordinate many of them, loops
that keep going until a condition holds, scheduled tasks that wake on their
own, monitors that watch a build or a PR, and separate cloud sessions that run
a job end to end while the operator does something else. Use all of it, and
**tell the operator when an old habit is costing them** — the operator would
rather hear it than go on doing it the slow way.

### When to raise it — NOT on every prompt

Raise it when the conversation shows the operator reaching a goal the old way,
one prompt at a time:
- the same request a second and third time ("next batch", "do the same for
  the next one", "check again", "is it done yet?");
- pasting output back for Claude to read when Claude could have read it itself;
- one job split by hand into many prompts, when its parts are independent;
- waiting on something (a build, a deploy, CI, a PR, a nightly run) and
  asking about it rather than being told;
- a job that should happen every day or week, done by hand each time.

A single edit, a question, a diagnosis, or a slice the operator chose on
purpose ("just one", "dry run it") is NOT that. Say nothing and do the work.

### How to raise it — always these five parts, short

1. **By agents** — which agents, and what each one does.
2. **In a loop or loops** — what repeats, the bounded slice per round, and the
   **stopping condition** (queue empty / two rounds with no progress /
   failures = attempts). A loop without a stopping condition is a new bug.
3. **With this graph** — a small ASCII diagram of the flow, for example:

       request ──► planner ──┬─► agent A (slice 1) ──┐
                             ├─► agent B (slice 2) ──┼─► verifier ──► report
                             └─► agent C (slice 3) ──┘       │
                                       ▲                     │ not done
                                       └─────── loop ◄───────┘

4. **And Claude will harness it this way** — the real tool for each part:
   `Agent` subagents (in parallel for independent parts), `Workflow` (many
   agents in a fixed pipeline; only when the operator asks for it), `/loop` or
   `ScheduleWakeup` (repeat until done), scheduled tasks (hourly / daily /
   weekly), `Monitor` and PR subscriptions (wait on something external),
   remote sessions via `create_session` + `send_message` (a whole job in its
   own cloud session), and a background `Bash` run for long scripts.
5. **And this is how Claude managed agents can do it** — what the operator
   gets: the work runs without them watching or pressing anything, it keeps
   per-item progress so it can pick up where it stopped, parts run at the same
   time, and the operator gets one report at the end with counts and anything
   that failed.

Then **do it in the same turn**, unless it is one of the cases that waits for
a yes: it **spends money** (paid APIs, LLM passes — name the ceiling in
dollars or calls), it is **irreversible** (deletes, purges, pushes to main),
it **touches a live broadcast**, or the operator asked for a **Workflow**
(those spawn many agents and need the operator's own go-ahead).

### The promise

I will not let the operator do things the slow way when there is a better
way. When I see a job being done one prompt at a time that agents, a loop, a
schedule or a monitor would do better, I will say so, with the five parts
above, and I will use these tools to the fullest rather than falling back on
old habits. I will not use them to look busy: a simple request gets a simple
answer.

— Signed, Claude (Claude Code), 2026-10-26, for the operator, in all of their
projects, current and future.

## Operator screens: one question at a time (founder, 2026-10-12)

*"The interface always need to be intuitive and modal questions otherwise we
never know if the issue is in pipeline or the way we use the UI."* A form of
many fields left a product half-made (two taps, never «Add item») and looked
like a pipeline bug for hours. So every operator tool:

- **Starts from the thing itself** (tap the product in the picture), then asks
  **one question per card**, in order, each with **«← Back»**, and «Skip» where
  it may be left out (model: `TagCard` in `walk/WalkItems.tsx`).
- **Finishes on its own**: saves by itself and says so («✓ Saved», or «Not
  saved: why»). No step a person can forget.
- **Never fails silently**: a missing sign-in, a refused save, a video that
  will not load each say what is wrong and what to do, on the screen.

## What visitors walk: the 360° video, not the splat (decided 2026-10-10)

Founder, after the first GPU-trained plaza: *"less than acceptable quality of
splat (as usual) — we need to architect this function with 360 video mp4
quality and choice to break away and enter in a shop. (period)"*

- **The visitor experience is the 360° Walk** (`/vca/walk`,
  `components/virtual-bazaar/walk/Walk360.tsx`): the cleaned Insta360 video
  itself, walked forward/back, looked round freely.
- **Shops are entered by branching** to the shop's own 360° walk video at a
  door placed on the street walk (time + direction), and «Back to the street»
  returns to the street walk at that door. One video plays at a time.
  Built: doors live in `scenes/walks.json` (`lib/splats/walks.ts`, read by
  `/api/splats/walks`, saved merged by the operator API's «walksSave»), placed
  on the walk page's `?edit=1` («Doors» in «Files in R2»). A shop may also be
  a **flat phone video** (the iPhone's `.mov`, private until a door leads to
  it, via `/api/splats/walks/video`), shown full screen with the same stick.
  Steps and video prep: `scripts/splats/walk-video.md`.
- **A 360° video downloaded from YouTube is 16:9, not 2:1** (2026-10-17): it is
  YouTube's Equi-Angular Cubemap (or a squeezed panorama), and was shown flat.
  In edit mode the walk asks «Is this a 360° video?» → shows it as the cube
  map → «Does it look right?» (✓ / try the other way / it's flat), and saves
  the walk's `projection` (`lib/splats/projection.ts`; the sphere keeps its
  panorama uv and a shader looks each pixel up in the cube map, checked
  against ffmpeg's `v360`). Download it at the highest quality: a 480p 360°
  video is ~200 px across the view. Someone else's YouTube video is for
  trying the idea in private, not for shoppers.
- **A walk's own sound** (founder, 2026-10-18, «how to add my own audio» →
  a background loop): the video stays muted (walked back and at 2–3× its
  sound garbles); «Sound» on `?edit=1` uploads an .mp3/.m4a to
  `scenes/<scene>/audio/sound-<stamp>.<ext>` and saves it as the walk's
  `audio`; it loops from the shopper's first tap, with 🔊/🔇
  (`walk/WalkSound.tsx`).
- **Cut and stitch a walk video** (founder, 2026-10-18: "4:20 - 4:40, 7:48 -
  8:20 … cut and stitch … save on olgoo (under the same name)"): «Cut» on
  `?edit=1` is a LIST of the parts to keep (founder, 2026-10-18: "list all
  parts … with begining and end Second, allow user to add or delete or modify
  the list, when list is final … stich the result and replace the video"):
  each row's start and end in seconds, changed or deleted in place and
  checked as typed, a draft kept on the device, then «Stitch and replace the
  video» → one «Are you sure?» card. Times are **always in the
  ORIGINAL video's times** (founder: "we mean 4:20 to 4:40 from original
  video"); our server's ffmpeg CUTS each part out of the kept original by a
  signed URL (only that stretch is read), then STITCHES them in order
  (concat, no second encoding) and saves the result under the SAME key (and
  its phone copy). A second cut starts from the last cut's parts. The first cut keeps
  `<key>.original` and the walk as it was (`cuts/<key>.json`, masters
  bucket): «Put the original back» restores both. Doors and dots move with
  the picture (`lib/splats/cut.ts`, `cut-job.ts`); the walk's `rev` changes
  so the player asks for `<file>?r=<rev>` past the "forever" cache.
- **Items on special** (founder, 2026-10-18: "few of items on special with a
  better more clear label and audio activation when user pass by them";
  «SPECIAL + was/now price»; *"no farsi, no farsi text, no farsi audio only
  Robotic lady in english only when there is special"*): «☆ Put on special»
  on a product in «Products» asks its price before → the special price, and
  saves `special: { was, now }` on the item. Shoppers see a big red SPECIAL
  badge (old price crossed out) instead of the dot, its card opens in
  English, the basket line is at the special price, and the browser's
  English voice says it once as it comes into view (`specialSay`,
  `sayAloud` in `walk/WalkSound.tsx`; muted by the same 🔊/🔇). Only
  specials speak.
- **Price tags on sticks, pinned to the product on 360° walks too**
  (founder, 2026-10-18: "the label need to be pined on the product on top of
  product not moved with shoppers as shopper move … we need like a stick that
  holds the price tag up attached to the product"). Every product is a tag
  (name + price, the list's price for a numbered one; red SPECIAL for a
  special) held up on a stick whose foot dot is the product's spot
  (`tagTexture`, `Sprite.center`; the same as DOM on a flat video). A tap on
  a 360° walk now follows the product like a flat video's does
  (`followProduct360`): each step a small normal camera view is cut out of
  the 360° frame around where it was (`renderView` in `projection.ts`), the
  patch found again, the next step guessed from the last move — checked on a
  synthetic walk: 12 s, 90° of sliding, within 0.9°. ⚠️ A tag with ONE tap
  shows only ±0.3 s round it (`ITEM_SLACK`; it was 3 s, and on a moving
  camera the tag "followed" the shopper while the product slid away —
  founder: "funny and does not make any sense"); «Products» marks it «not
  pinned to the product» with «📌 Pin to the product», which follows it from
  that tap and saves (`isPinned`).
- **Every walk needs its 4K phone copy** (`<name>-phone.mp4`, 3840×1920
  H.264, same trim): the 8K H.265 export (the settings under "Splat scenes")
  plays on a computer but no phone can walk it — on the plaza, self-drive and
  the wheel did nothing on a phone (2026-10-10). The walk says so on a phone.
- **Splats are not shown to visitors** until their quality matches the video.
  The splat pipeline below stays as R&D; don't put visitors back on it, and
  don't spend effort making splats the main path without a new decision.
  Founder, 2026-10-12: *"we want to stay away from Splat because the quality
  is completely sacrificed for 3D view and degree of freedom; something we do
  not want."* Shops filmed on a phone are walked as the phone video itself —
  don't «Train» them.

## Planned on the walk (flagged by the founder, 2026-10-10 — build in this order)

1. **Items you can "pick up"** — inside a shop's walk video: **pins** on items (time + position, keyframed so they
   follow the item; in a 360° walk a pin is a direction, like a door), and
   **«Ask the shop»** for anything untagged (snapshot + question to the
   merchant). Tags link to the store's catalogue (merchant spreadsheet). Later:
   AI suggests tags by matching frames to the merchant's product photos.
   **Built (2026-10-12): the pins.** «Products» on the walk page's `?edit=1`:
   tap the product in the picture and a card asks one question at a time, with
   «Back» (is it a product → name → Farsi name → price → photo → tap it again
   further on), then «Done»; the editor saves by itself. **On a flat phone
   video the dot follows the product by itself** (2026-10-12, founder: "the
   dot moves with shopper, instead of being pinned to the product … the single
   most important issue"): one tap, and `walk/followProduct.ts` steps a hidden
   copy of the video every 0.2 s up to 15 s either way, finding the tapped patch
   again in each frame (`lib/splats/track.ts`, normalised cross-correlation),
   so the dot has a place for every moment the product is in view; a later tap
   re-follows from there. Needs the video's CORS (a private `masters/` video
   falls back to taps). On a 360° walk, a dot tapped at a few
   moments (it follows the product between them; on a flat phone video x/y are
   fractions of the frame, on a 360° walk a direction). Tap → card →
   `AddToListKey`, so the basket's own rules apply (meat first). Stored as
   `items` on the walk in `walks.json`. Store items skip «$200 of meat first»
   (`waitsForMeat`, mirrored in iOS as basket arithmetic only — VCA itself is
   excluded from the app). Still to build: «Ask the shop», the
   catalogue link.
   **Merchant on-boarding (2026-10-12, built):** the merchant's sheet (.xlsx:
   number · product no · title_fa · title_en · unit · unit price · photo; headers
   English or Farsi, any order) is uploaded on the walk's «Products» tab and
   becomes the store's list, `scenes/catalogues/<store>.json`
   (`lib/splats/catalogue.ts`, read by `lib/splats/xlsx.ts` — no spreadsheet
   library). **We add the Sarekooche number (1–999)**: the merchant's own numbers
   are too long to type (founder: "could have many digit making the work of
   onboarding tedious"); theirs is kept (`sku`) and shown. Tagging then asks
   **only the number** and previews that product; «Not on the list? Add it by
   hand» asks name → Farsi → sold by → price → photo and adds it to the same list
   with the next free number. A tag stores only `n`; the card reads the list, so
   a new sheet updates every price. **kg / g / lb are bought by weight**
   (founder: "weight for sure, and lb, Iranian dry nut stores sell like that"):
   the card offers weights and the basket line is that weight at its price.
   A store's shelf videos are `scenes/<store>-shelf-<n>/…` (`storeOfScene`);
   the walk joins them with «‹ Aisle 2 · Aisle 3 / 6 · Aisle 4 ›» and «Next
   aisle →» at each video's end (`aislesOf`, `/api/splats/store`; founder:
   "map later, simple next previous now"). Name the scene ids that way when
   uploading: `alis-market-shelf-1`, `…-shelf-2`, `…-shelf-3a`, `…-shelf-3b`.
   **No shelf strip** (built and dropped 2026-10-12, founder: *"lets remove the
   shelf layer, there is no such thing in most stores, all are scattered all
   over, no shelf marker only product"*). Products are found by their dots;
   don't bring shelves back without a new decision.
   **Filming a shop with a phone** (founder, 2026-10-12): one clip per side of
   an aisle, portrait on the iPhone Air (no ultra-wide), level at chest height
   with your back to the opposite shelf, aisle sign first; the shopper says
   what they need and is taken to that aisle side.
2. **🚩 Voice-guided walk — move *toward* it, never teleport.** Press-to-talk
   (never always listening), Farsi or English. "I need saffron" → the walk
   plays forward faster (2–3×) along the real path, past other shops (keep the
   serendipity), eases in and stops facing the shelf/item with its card;
   through a door if it is inside a shop. Any time: "stop / wait / what's
   that" pauses, "go on" resumes, "back" walks back, a new wish re-plans.
   Short commands matched directly; wishes go to an LLM that picks from the
   tags and catalogues. Speech: the browser's recognition where it exists
   (Chrome has Farsi), a server fallback for Safari/iPhone. Depends on 1.

## Splat scenes: how a place becomes walkable (settled 2026-10-09 — don't reinvent)

### What the operator does
1. **Film** the place with the Insta360 (X4/X5) as one slow walk. Best results:
   soft light (overcast/early), empty of cars, camera near eye height (held high,
   views below the camera smear), steady exposure.
2. **Clean the video in Insta360 Studio** (the "beauty filter" happens here, on
   the video — not on the finished splat): Imaging → **Adjust** only, the same
   fixed values for the whole clip (e.g. Shadow +25, Highlights −15,
   Contrast −10, Vibrance +15, Temp +5, **Definition 0**). Keep **Motion ND,
   Clarity Plus, Color Plus, AquaVision off**; leave Stitching/Stabilization
   alone. Export → **360 Video**, 8K, max bitrate, H.265, **Anti-Flicker on**.
3. **Upload the .mp4** at `/operator/splats` under a new scene id.
4. **«Train»** next to it in «Files in R2». The server rents a RunPod GPU, and
   when done the scene is in the tour with its route. Takes ~1.5–3 h, a few $.
5. **«Make the streamed copy (fast)»** for the scene (the LoD `.rad` phones and
   computers stream). Then walk it, replace shop signs (edit mode → Signs), and
   only then make it the scene visitors see.

### The pipeline underneath
- **One GPU path: «Train»** — `lib/splats/train.ts` (rules), `train-job.ts`
  (server job), `runpod.ts` (RunPod REST **v2**; v1 retires 2026-11-15),
  `scripts/splats/gpu-train.sh` + `gpu-frame.py` (run inside the pod, on the
  `ghcr.io/nerfstudio-project/nerfstudio:1.1.5` image): download video →
  frames → COLMAP → `ns-train splatfacto-big` → export `.ply` →
  back to COLMAP's frame → PUT to presigned R2 URLs → the server converts
  `.ply`→`.spz`, updates the tour and imports the route. **A 2:1 video is a 360°
  walk**: ≤96 frames (160 ran past 3 h), each cut by `gpu-frame.py split-360`
  into 8 square pinhole views 10° down (operator out of view), then the same
  COLMAP as phone videos with a fixed pinhole lens (nerfstudio's own
  equirectangular path placed 3 of 99 frames — don't go back to it). **A phone video**
  is cut by ffmpeg at ≤1600 px, the sharpest of each three frames kept (500),
  and COLMAP runs in the script: 20 sequential neighbours + loop detection,
  a looser mapper, and the *largest* model trained (ns-process-data matched
  10 neighbours and always took `sparse/0`; the first store placed 131/350
  frames and trained at 960 px — smeared). Every frame trains (`--eval-mode
  all`), with a bilateral grid for exposure drift. Do not build a second GPU
  path; extend this one.
- **Secrets**: only `RUNPOD_API_KEY` (Railway). It never leaves our server; the
  pod gets presigned per-file URLs only, never an R2 or RunPod account key.
  Tunables: `RUNPOD_TRAIN_GPUS`, `_TIMEOUT_HOURS` (4), `_FRAMES` (500),
  `_METHOD` (splatfacto-big), `_ITERATIONS`, `_DISK_GB`, `_CLOUD`. The page's
  «Full log» opens the last job's whole `train.log`. One training at a time; the pod is
  terminated on done/failed/cancel/time limit, by the server and by itself.
- **Serving**: `lib/splats/stream-job.ts` + `bin/build-lod` (Spark v2.3.1) make
  the streamed `.rad`; the viewer (`components/virtual-bazaar/splat/SplatTour.tsx`)
  opens it paged. Phones get a small page pool (`?pool=`) — Spark's default
  ~300 MB reservation crashed iOS Safari.
- **Manual fallback** (no server involved): `public/gpu/build-scene.sh` +
  `BUILD-README.txt` — the same idea on a pod you start yourself (COLMAP 4 rig
  + Brush/gsplat). `public/gpu/restore.sh` is the untested AI-restore
  (Qwen-Image-Edit) experiment.

### Tried and dropped — don't redo without a new reason
- **Splatica** accepts only `.insv`, so no cleaned video can go through it;
  Insta360 Studio cannot export an edited `.insv`.
- **Recolouring a finished splat** (the «Restored look» presets, the server
  «Restore this scene» gentle/full/deep retouch in `lib/splats/retouch*.ts`,
  SuperSplat's Colors panel) barely changes old surfaces; «deep» damaged the
  real plaza (wrong removals, holes). Age is texture, not colour.
- **SuperSplat** has no smoothing; useful only to delete things by hand. Its
  «Publish» puts the scene on PlayCanvas's site — use Export instead.
- **Generative AI restore** (research: `docs/research/splat-restoration.md`):
  no product does it for whole streets; Persian signs get garbled — signs are
  replaced with the operator's own images instead.
