# Restored ("beauty-filtered") bazaar splats: what is real, what it costs, what to ship

*Research note, 2026-10-08. Scope: Insta360 walk → Splatica reconstruction (.ply, 3–9 M splats) → `scripts/splats/convert.mjs` (.spz) → Spark 2.3.1 `build-lod` (.rad) → browser/iOS viewer.*

---

## 1. Executive summary

**The goal is to make streets look brand new while they stay the same, walkable place.** That is not one problem but four. They have very different maturity levels:

| Sub-problem | What it means for us | Maturity (Oct 2026) |
|---|---|---|
| **A. Grade**: pleasant light, colour, contrast | One "look" for the whole scene | **Solved.** It is deterministic, cheap and needs no GPU |
| **B. Clean-up**: floaters, fog, blur, glare, shimmer | Reconstruction artefacts | **Mostly solved.** Filters plus NVIDIA Fixer (commercial licence) plus better training settings |
| **C. Surface tidy**: stains, patches, uneven asphalt, grimy walls | Low-frequency blotches on flat surfaces | **Doable without AI** (3D bilateral smoothing on detected planes). Generative help is optional |
| **D. Renovation**: "brand-new asphalt", shiny bricks, graffiti/litter gone, crisp signage | Semantic re-painting | **Research-grade.** No method is proven at city-block scale. Every published 3D editor is shown on rooms and objects at about 512 px |

**Hype vs proven.** Papers such as Instruct-GS2GS, GaussianEditor, DGE and GaussCtrl edit *object-centric or room-scale* scenes at 512×512 from roughly 40 views. Their results are often soft and over-saturated. None demonstrates a 5–9 M-splat, several-hundred-metre street. The usable building blocks are real, though:

- multi-view-consistent editing tricks (depth conditioning, cross-view attention)
- single-step "fixer" diffusion models
- temporally consistent video restoration
- per-image appearance/bilateral-grid absorption during training

A "restored bazaar" is therefore an **engineering pipeline we assemble**, not a product we can buy. No vendor checked (Luma, Polycam, Postshot, KIRI, Scaniverse, Teleport, World Labs, SuperSplat, Spark) offers generative restoration of an existing capture. They offer manual cleanup and colour sliders at most.

**Key design rule: freeze geometry, edit only colour.** Any generative step should be distilled back into the splats with **positions, scales, rotations and opacities frozen**, so that only colours (SH0 and maybe SH1) are optimised. The place then stays geometrically identical and walkable *by construction*. Multi-view inconsistency in the edits degrades to mild colour blur on surfaces, which is exactly the "clean" look we want, instead of floaters.

### RECOMMENDED PIPELINE

**This week: ship it, no GPU, ~$0/scene, minutes of CPU**
1. **Floater and junk cleanup** with PlayCanvas `splat-transform` (MIT): `-N` (NaN), `-F` (floaters), `-V opacity,gt,0.05`, drop over-large splats (`-V scale_0,lt,…`), and crop with `-B`. Add it in front of `convert.mjs`.
2. **Scene "look" grade (the 3D equivalent of an Instagram filter)**, added to `convert.mjs` as `--grade <preset>`. Apply white balance, exposure, an S-curve, vibrance and lifted shadows as a 3D LUT on each splat's DC colour (SH0), and scale higher SH bands consistently. Preset per street.
3. **Cut view-dependent glare.** Keep `--sh 1` (already the default), or use `--sh 0` for very glossy, wet or shimmering scenes. This removes most "sparkle" and specular smears on shopfront glass and wet stone.
4. **Capture discipline (the largest free win):** overcast or early-morning light, locked exposure and white balance, slow walk, shoot before shops open (less litter and fewer people), and a second pass for occluded areas.

**This month: ~$5–25 of GPU per scene, 2–4 engineer-weeks**
5. **Surface tidy (non-generative):** detect ground and façade planes (RANSAC on splat centres, with normals taken from the shortest covariance axis). On those planes, run an edge-preserving **bilateral filter of DC colour over 3D neighbours**, damp low-frequency blotches (stains, patches, wet spots) and keep fine micro-texture. Optionally re-tone asphalt and pavers toward a target "new" colour. This alone gives much of the "brand-new asphalt" effect and is fully deterministic.
6. **Self-host reconstruction with gsplat (Apache-2.0)** so that enhancement can happen *before* and *during* training. Use Splatica's `cameras.json` and frames, or re-solve poses. Turn on `post_processing="bilateral_grid"` (or `"ppisp"`) and `app_opt`, which absorb per-frame exposure/ISP differences, including those introduced by restoration models.
7. **Restore source frames conservatively before training:** denoise, deblur, de-compress and colour-normalise with **SeedVR2 (Apache-2.0)** or Topaz (paid licence), using *fidelity-first* settings, the same grade on every frame, and no creative/generative upscaling. Mask people and vehicles (SAM 2-class segmenter) so they are not reconstructed. Expect a crisper, cleaner splat. Do **not** expect graffiti or litter to vanish.
8. **Artefact repair with NVIDIA Fixer** (code Apache-2.0; weights under the NVIDIA Open Model License, which the model card says permits commercial use). Render novel and off-path views, fix them, and distil back with geometry frozen. Do *not* use Difix/ArtiFixer weights (non-commercial).

**This quarter: R&D bet, ~$20–80 of GPU per scene, 6–10 engineer-weeks, uncertain quality**
9. **Masked generative "renovation" on surfaces only:**
   - Segment ground and walls and the defects on them: graffiti, litter, stains, cracks.
   - Edit renders with a **depth/edge-conditioned, commercially licensed** editor, applied with cross-view consistency (DGE/GaussCtrl-style attention, or a video model such as **Wan 2.1 VACE**, Apache-2.0, run along the walking path).
   - Distil back **colour-only** into the frozen geometry.
   - Gate it behind a per-scene human review, and keep signage and shop goods *out* of the edit mask, because generative models mangle Persian/Arabic/Latin lettering and would misrepresent merchandise.

**Do not do:** run Runway Aleph, Luma Modify or Kling on the walk video and re-reconstruct. These tools cap output at about 1080p, accept clips of 5–30 s, and re-synthesise geometry and parallax. The output is not pixel-consistent enough for 3DGS, and it costs $50+ per 3-minute walk for a worse reconstruction (see §3).

### Cost per scene (3–5 min Insta360 walk, 3–9 M splats)

| Tier | Steps | GPU | Cost/scene | Wall-clock |
|---|---|---|---|---|
| Week | 1–4 | none (CPU, existing server) | **≈ $0** | 1–5 min |
| Month | 5 (CPU) | none | ≈ $0 | 5–20 min (Python/numba kNN on 9 M points) |
| Month | 6–7 (restore frames + gsplat retrain) | 1× L40S/A100/H100 | **≈ $5–20** (RunPod: L40S $0.79/h, H100 from $1.99/h) | 2–6 h |
| Month | 8 (Fixer render→fix→distil) | 1× H100 | **≈ $3–10** | 1–3 h |
| Quarter | 9 (masked generative renovation) | 1× H100 (80 GB) | **≈ $20–80** + human review time | 6–24 h |
| Hosted alternative for step 7 | fal.ai SeedVR2 at $0.001/MP | none | ≈ $10 for 600 frames of 5.7K equirect (16.6 MP each); ≈ $90 if all 5,400 frames of 3 min @30 fps | minutes |

Prices are on-demand list prices reported for 2026 (RunPod, Modal, Lambda, fal). They are approximate and change often (see §5).

### Licence risk in one line
**Avoid** anything that builds on the Inria `diff-gaussian-rasterization` (non-commercial):
- GaussianEditor (S-Lab non-commercial)
- DGE (no licence; built on GaussianEditor)
- TIP-Editor (no licence; Inria rasteriser)
- SR-GS (Inria licence)

**Also avoid** SUPIR (non-commercial without a paid licence), Difix and ArtiFixer weights (NVIDIA research-only), and FLUX.1 [dev]-family weights (non-commercial; verify).

**Safe:**
- gsplat, Nerfstudio, Fixer code (Apache-2.0)
- Instruct-GS2GS, Instruct-NeRF2NeRF (MIT)
- GaussCtrl (BSD-3, but its SD 1.5 / ControlNet weights are CreativeML OpenRAIL-M: commercial use allowed with use restrictions)
- SeedVR2, Wan 2.1/2.2, VACE (Apache-2.0)
- Real-ESRGAN (BSD-3)
- SpotLessSplats (Apache-2.0), WildGaussians (MIT), FastSplatStyler (MIT)
- Spark (MIT), SuperSplat and splat-transform (MIT)

---

## 2. Editing / restoring an existing 3DGS scene with generative models

### 2.1 How they all work, and why it is hard for us
Almost every method uses the same loop: **render training views → edit them with a 2D diffusion model → re-optimise the splats on the edited views**. They differ in how they make the 2D edits agree across views:
- **Iterative dataset update** (Instruct-NeRF2NeRF / Instruct-GS2GS): edit one view at a time and let the 3D fit average the disagreement. This is slow, blurry and tends to over-saturate.
- **Depth/ControlNet conditioning plus cross-view attention** (GaussCtrl).
- **Spatio-temporal attention with epipolar constraints** (DGE).
- **Video diffusion along a camera path** (V2Edit, 3DGS-Enhancer, ArtifactWorld, GaussVid).

Problems specific to us:
- **Scale.** Our scenes have hundreds to thousands of views and 5–9 M splats. The methods default to about 40 views at 512 px. Chunking is our engineering problem.
- **Resolution.** InstructPix2Pix "performs significantly worse" above 512 px and OOMs (Instruct-GS2GS README), so street detail is lost.
- **Identity.** Prompt-driven editors hallucinate. Shop signs, goods and lettering will change, which is commercially and legally risky for a marketplace.
- **Geometry.** Full re-optimisation moves, adds and removes splats. Freezing geometry (colour-only distillation) is the mitigation, and none of the repos does it by default.

### 2.2 Method-by-method

| Method | Type | Code | Licence (commercial?) | Compute (as reported) | Quality / consistency | Fit for a city block |
|---|---|---|---|---|---|---|
| **Instruct-NeRF2NeRF** (ICCV 23) | NeRF, iterative IP2P edits | yes | **MIT** ✔ | 45 min–2 h per edit (per GaussianEditor's benchmark) | Soft, often over-saturated; consistent only through averaging | Poor (NeRF, slow) |
| **Instruct-GS2GS** | 3DGS port of IN2N on Nerfstudio splatfacto/gsplat | yes | **MIT** ✔ (gsplat Apache-2.0; IP2P weights: check) | ~15 GB VRAM; 5–7.5k extra iterations; ≤512 px images | Same as IN2N; best for global style ("make it autumn") | Works only with chunking; detail loss at 512 px |
| **GaussianEditor** (CVPR 24) | 3DGS, semantic-tracked Gaussians + IP2P/SDS | yes | **S-Lab License 1.0: non-commercial** ✘ (+ Inria rasteriser) | "within 20 min on a single V100" for object-scale scenes | Good local edits | Licence blocks it |
| **DGE** (ECCV 24, Oxford VGG) | Multi-view consistent IP2P edit (spatio-temporal attention + epipolar), then direct 3DGS fit | yes | **No licence file** (all rights reserved), built on GaussianEditor → ✘ | ~4 min per edit; 512×512 crops by default | Best consistency of the 2024 crop | Licence blocks it; borrow the *idea* |
| **GaussCtrl** (ECCV 24, Oxford/MBZUAI) | Depth-conditioned ControlNet + attention latent alignment over all views | yes | **BSD-3** ✔; SD 1.5 weights OpenRAIL-M; original SD 1.5 checkpoint withdrawn (authors mirror one) | 24 GB A5000; default 40 views (4×10); `load-all` for all views | Good geometric consistency thanks to depth | Most re-usable design; needs re-engineering for scale |
| **TIP-Editor** (SIGGRAPH 24) | Text+image-prompted local edits, SD 2.0 fine-tuned | yes | **No licence** + Inria rasteriser ✘ | n/a | Good for inserting objects | Not our use case |
| **ViCA-NeRF** | NeRF (nerfacto), view-consistency-aware | yes | **No licence** ✘ | n/a | — | NeRF; skip |
| **3DitScene** | Single-image → 3D scene editing | yes | **No licence** ✘ | n/a | — | Wrong input (single image) |
| **EditSplat** (CVPR 25) | Multi-view fusion guidance + attention-guided trimming | paper | unverified | n/a | Improved consistency vs. IGS2GS | Watch |
| **V2Edit** (2025) | Training-free *video* diffusion editor, render-edit-reconstruct | project page | unverified | n/a | Handles bigger edits; limited by base video model | Interesting for walk paths |
| **Tinker** (2025), **DisCo3D**, **CoreEditor**, **Edit3r**, **TRACE** (2026), **"Look Before You Edit"** (2026) | Newer multi-view-consistent editors (some built on Wan) | mixed | unverified | n/a | Best published consistency so far | All shown on room/object scenes; none at street scale |

### 2.3 Repair / enhancement (not "editing")

| Method | What it does | Licence | Notes |
|---|---|---|---|
| **Difix3D+** (NVIDIA, CVPR 25 oral, best-paper candidate) | Single-step diffusion that removes 3DGS/NeRF render artefacts; used offline (fix pseudo-views → distil) and as a real-time post-filter | Code/weights **NVIDIA non-commercial** ✘ | ~0.22 s/image H100, 0.36 s A100 (FP32) per model card |
| **NVIDIA Fixer** (Difix successor, Cosmos-Predict-based, 2025) | Same idea, trained for AV/robotics scenes (streets!) at 576×1024 | Code **Apache-2.0**; weights NVIDIA Open Model License, card says "commercial/non-commercial use" ✔ (verify) | **Best commercially usable artefact fixer.** Repairs blur and floaters only. It does not "renovate" |
| **ArtiFixer** (NVIDIA, Wan 2.1 14B, autoregressive) | Video-model artefact repair, ~3 dB over prior | Code Apache-2.0, **weights research-only** ✘ | Watch for a commercial release |
| **3DGS-Enhancer** (NeurIPS 24), **GSFix3D** (2025), **GS-Diff** (2025), **GaussVid** (2026), **ArtifactWorld** (2026) | Video-diffusion priors to enhance sparse-view/unbounded 3DGS | mostly research | Confirms that *video* priors beat per-image priors for consistency |
| **SRGS** (2024) / **IE-SRGS** (AAAI 26), **GaussianSR** (SDS), **SuperGS**, **SplatSuRe**, **MVGSR** (Dec 2025) | 3DGS super-resolution | SR-GS repo = **Inria licence** ✘; others unverified | Gains are modest, and they mostly re-use the *real* high-res detail already in input frames. Our 5.7K Insta360 input is already the ceiling; SR adds little but hallucinated text |
| **Deblurring**: BAD-Gaussians (ECCV 24), MoBGS, EBAD-Gaussian | Model camera motion blur during training | research licences | Better to avoid blur at capture (shutter speed) and deblur frames (§3) |
| **Transient removal**: SpotLessSplats (Apache-2.0), WildGaussians (MIT), Splatfacto-W, gsplat `app_opt` | Ignore moving people/cars and per-image lighting | ✔ | Removes *moving* things only. Litter, graffiti and stains are static and stay |
| **Relighting** (LumiGauss, WACV 25, code public; GaRe ICCV 25; OSDR-GS; R3GW 2026) | Intrinsic decomposition of outdoor scenes from many lighting conditions | research | Need multi-condition photo collections; our single walk is under-constrained. Not production |
| **Style/appearance transfer**: FastSplatStyler (MIT, < 2 min on consumer HW, works on a bare .ply), CLIPGaussian, SGSST | Re-colour a splat from a reference image | FastSplatStyler ✔ | Useful for a *look* (warmer, cleaner palette), but it stylises texture too. Test at low strength |

---

## 3. The alternative: restore the source video, then reconstruct

**Does per-frame inconsistency break reconstruction?** Partly, and it depends on what kind of inconsistency:
- **Colour/exposure/tone differences between frames:** harmless *if* the trainer models them (per-image appearance embedding, bilateral grid, PPISP). gsplat has all three (`app_opt`, `post_processing="bilateral_grid"|"ppisp"`). A NeurIPS 2025 paper shows multi-scale bilateral grids *reduce floaters* caused by photometric inconsistency.
- **Texture/detail differences (hallucinated bricks, letters, cracks that differ per frame):** harmful. 3DGS averages them into blur or encodes them as view-dependent SH "shimmer" and floaters. The literature says this repeatedly: per-frame restoration causes "multi-view inconsistencies like flickering", and generative image restorers produce "blurred textures and inaccurate lighting" after reconstruction (underwater 3DGS study, R-Splatting). Video SR models still show temporal inconsistency (RealBasicVSR and others).
- **Geometric changes (moved edges, re-synthesised parallax):** fatal. They produce double surfaces and pose-solve failures.

**What works in practice:**
1. **Fidelity-first restoration, not generation.** Use denoise, deblur, de-JPEG and mild sharpening. **SeedVR2** (ByteDance, Apache-2.0, one-step diffusion video restoration, temporally aware) or Topaz with "precise"/low-creativity models; Real-ESRGAN (BSD-3) only for mild cases. Avoid SUPIR (non-commercial, and highly creative).
2. **Apply one grade to all frames** (same LUT), so the grade itself causes no inconsistency.
3. **Restore what the reconstruction actually consumes.** For Insta360, that is the perspective/cubemap crops, or equirect with seam padding. Most models are trained on perspective video, and a 5.7K equirect frame (16.6 MP) is costly.
4. **Let the trainer absorb the remainder:** gsplat with bilateral grid + `app_opt` + MCMC strategy + antialiasing.
5. **Mask transients** (people, scooters, cars) with a segmenter, or use a robust loss (SpotLessSplats).
6. **Video inpainting for static clutter** (Wan 2.1 VACE inpainting, Apache-2.0, masked compositing keeps unmasked pixels) is plausible for *small* items such as a bin bag or a poster. Inpainted regions disagree across clips, so treat them as "low-confidence" pixels (down-weight them in the loss) or fix them after reconstruction in 3D (§4).

**Hosted video-to-video models (Runway Aleph, Luma Ray "Modify/Video-to-Video", Kling O1 edit):**
- Output is ≤1080p.
- Clip lengths are 5–30 s (Luma: source ≤18 s, 200 MB).
- They re-render the whole frame, including geometry.
- They cost about **$0.28/s** (Aleph, third-party reported) and about $0.11/s (Kling O1, aggregator).

A 3-minute walk costs about $20–50 and comes back as dozens of independently generated clips with seams. **Not suitable as reconstruction input.** They are fine for a *marketing trailer*, not for the walkable scene.

**Topaz Video** (desktop ~$59–74/mo or perpetual ~$299; API credit-based: Starlight Precise 2.5 ≈ 26 frames/credit at 1080p, credits $0.08–0.12, *all third-party reported*) is the practical commercial choice when we do not want to self-host. SeedVR2 via fal.ai costs $0.001/MP.

---

## 4. Cheap, non-generative wins (operate directly on the .ply)

These are deterministic and fully consistent by construction. They are also cheap, and they belong next to `scripts/splats/convert.mjs`, which already has `--sh` and `--opacity`.

1. **Per-splat colour grading.** The DC colour is `0.5 + 0.28209·f_dc`. Apply a 3D LUT or curves (white balance, exposure, S-curve, vibrance, shadow lift, highlight roll-off) to the DC colour and write it back. Scale `f_rest` (SH1–3) by the same per-channel gain so view-dependent colour stays coherent, or drop it. SuperSplat already exposes temperature/saturation/brightness/black-/white-point/tint (now per-selection, and bakeable), which is handy for prototyping a preset by eye.
2. **Opacity / scale cleanup.** splat-transform `-F/--filter-floaters` (voxel-based), `-N`, `-V opacity,gt,x`, plus our own rule to remove splats whose largest scale exceeds a few metres (sky blobs, haze) or with extreme anisotropy. Use `-C` cluster-keep to drop disconnected junk.
3. **SH reduction to remove glare.** Degree 0 removes all view-dependent sparkle, which is the cheapest de-glare and de-shimmer available. Degree 1 is a good default (smaller files; Spark streams faster). For wet floors or shop glass, drop SH only on those regions (by plane mask) and keep it elsewhere.
4. **Plane detection + re-colouring.**
   - Normal per splat = the axis of the smallest scale.
   - RANSAC/region-growing on centres gives ground and façade planes.
   - Per plane: compute a smoothed colour field (kNN or voxel average, 0.3–1 m), separate **detail = colour − smooth**, then set **colour' = target_tone(smooth) + k·detail** with k≈0.6–0.9. This evens out stains, wet patches and patchy repairs while keeping texture, which is the "brand-new asphalt" look.
5. **Spatial bilateral smoothing over neighbouring splats** (on surfaces only): weights are spatial (σ≈5–20 cm along the plane) × range (colour difference) × normal agreement. Lane markings, kerbs and tile edges survive; grime blotches fade.
6. **Defect masks → neighbour fill.**
   - Render views from `cameras.json` (splat-transform can render `.webp` from a camera; gsplat on GPU is faster).
   - Segment "graffiti / stain / litter / crack" with an open-vocabulary segmenter.
   - Back-project the votes onto splats.
   - On flat surfaces, replace masked splats' colour with the plane's local median and reduce opacity of 3D "litter" blobs that protrude from the ground plane.

   This is a 3D inpaint without any generative model, and it is fine for flat walls and floors.
7. **Runtime tweaks in Spark** (no re-bake): `SplatEditSdf` shapes (box/plane/sphere…) with `MULTIPLY`/`SET_RGB`/`ADD_RGBA` blend, or a Dyno `worldModifier` GLSL per-splat colour function. Useful for per-shop highlight and A/B-testing looks. Bake offline for production so phones pay nothing per frame.

Engineering cost for 1–3: about 2–3 days, Node or Python (numpy) on the existing server. For 4–6: about 2–3 weeks (Python + scipy/pykdtree/open3d; Open3D is MIT). iOS impact: none, as long as baking happens before `.spz`/`.rad`; the app streams the same files.

---

## 5. Commercial / hosted options

| Vendor | Splat editing/cleanup | Generative restoration of an *existing* capture? | Notes |
|---|---|---|---|
| **Splatica** (our provider) | (no public info found) | Unknown | Ask: (a) can we get undistorted frames + poses (we already parse `cameras.json`)? (b) can we upload *pre-processed* frames? (c) do they offer appearance embeddings / floater filtering? |
| **SuperSplat** (PlayCanvas, MIT, browser) | Selection tools (rect/box/sphere/brush/lasso), delete floaters, crop, colour panel (tint, temperature, saturation, brightness, black/white point, transparency, bake), SH-band export, video export | No | Best free manual tool; good for look prototyping |
| **splat-transform** (PlayCanvas, MIT CLI/lib) | Floater filter, value/box/sphere filters, SH filtering, decimation, render-to-webp, SOG/LOD | No | Automatable, so it goes in our pipeline |
| **Spark 2.3.1** (World Labs, MIT) | `SplatEdit` SDF recolour/opacity/displace, Dyno shaders, `build-lod` | No | What we already run |
| **Postshot** (Jawset, Windows, v1 Aug 2025) | Local training, crop, mask import, ACES colour | Not found | Tiered paid licences; free tier can't export PLY (reported) |
| **KIRI Engine, Polycam, Scaniverse (Niantic), Teleport (Varjo)** | Capture + basic brush/crop cleanup | Not found | Capture apps; no AI restoration found |
| **Luma AI** | Pivoted to video generation (Ray 3.x Modify) | Video only (≤1080p, ≤18 s source) | Not for reconstruction |
| **World Labs Marble** | Generates *new* worlds from prompts/images; Chisel editor; SPZ/PLY export (paid; commercial rights on Pro) | Generates, doesn't restore | Could make *stylised* concept versions; not the real street |
| **NVIDIA Omniverse NuRec + Fixer** | Reconstruction + artefact fixing for AV/robotics | Repair only | Fixer is the commercially licensed piece |
| **Adobe "Project New Depths"** (MAX teaser) | Radiance-field editor | Unconfirmed | Watch |
| **Nerfstudio / gsplat** (Apache-2.0) | Full training stack incl. splatfacto-W, bilateral grid, PPISP, app_opt, pose-opt, MCMC | Hosts Instruct-GS2GS & GaussCtrl | Our self-hosted base |

**Cloud GPU (on-demand, 2026, approximate):**

| Provider | H100 80GB | A100 80GB | L40S 48GB | RTX 4090 | Notes |
|---|---|---|---|---|---|
| RunPod | from $1.99/h | $1.19/h | $0.79/h | $0.34/h (community) | per-second billing; secure cloud higher |
| Modal | ≈ $3.95/h | ≈ $2.50/h | ≈ $1.95/h | — | serverless per-second, scale-to-zero, $30/mo free credit |
| Lambda | ≈ $2.86–3.29/h PCIe; $3.99/GPU-h SXM (8× nodes) | — | — | — | no egress fees |
| fal.ai | — | — | — | — | per-call: SeedVR2 video $0.001/MP |
| Replicate | per-second GPU billing; hosts Real-ESRGAN, SeedVR2 cogs | | | | prices not re-verified for this note |

Recommendation: use **RunPod L40S/H100 for batch jobs** (gsplat retrain, Fixer, restoration). Use **Modal** if we want an on-demand "Enhance" button on `/operator/splats` that scales to zero.

---

## 6. Risks and honesty notes

- **Misrepresentation.** A "restored" bazaar is a marketing render of the place, not the place. Label it ("enhanced") and keep the raw scene available. Never let a generative step touch shop signage, prices or goods.
- **Text hallucination.** Generative SR and editing mangles Persian/Arabic and small Latin lettering. Keep signage out of masks. If signage must be crisper, use real higher-resolution photos (a second still-photo pass) rather than generation.
- **Licences.** Most 3DGS-editing research code is non-commercial or unlicensed. Re-implement ideas on gsplat (Apache-2.0) instead of forking those repos. Verify Fixer's weight licence (NVIDIA Open Model License) and IP2P/SD weights (OpenRAIL-M use restrictions) with counsel before launch.
- **Quality ceiling.** Restoration cannot invent detail the camera didn't see. Capture quality (light, shutter speed, coverage) is the biggest lever and costs nothing.
- **CLAUDE.md note.** All proposed work is server-side processing of scene files. The iOS app consumes the same `.spz`/`.rad`, so no app change is needed unless we add an "enhanced/original" toggle (then it needs a screen in `ios/Sarekooche/Features/`).

---

## 7. Sources

**3DGS editing**
- Instruct-GS2GS: https://github.com/cvachha/instruct-gs2gs (MIT, README VRAM/resolution notes)
- Instruct-NeRF2NeRF: https://github.com/ayaanzhaque/instruct-nerf2nerf (MIT)
- GaussianEditor: https://github.com/buaacyw/GaussianEditor (S-Lab License 1.0) · paper https://arxiv.org/abs/2311.16037 · CVPR PDF https://openaccess.thecvf.com/content/CVPR2024/papers/Wang_GaussianEditor_Editing_3D_Gaussians_Delicately_with_Text_Instructions_CVPR_2024_paper.pdf
- DGE: https://github.com/silent-chen/DGE · https://arxiv.org/abs/2404.18929 · https://www.ecva.net/papers/eccv_2024/papers_ECCV/html/9386_ECCV_2024_paper.php
- GaussCtrl: https://github.com/ActiveVisionLab/gaussctrl (BSD-3) · https://arxiv.org/html/2403.08733v2 · https://radiancefields.com/papers/gaussctrl-multi-view-consistent-text-driven-3d-gaussian-splatting-editing
- TIP-Editor: https://github.com/zjy526223908/TIP-Editor
- ViCA-NeRF: https://github.com/Dongjiahua/VICA-NeRF
- 3DitScene: https://github.com/zqh0253/3DitScene · https://zqh0253.github.io/3DitScene/media/3ditscene.pdf
- EditSplat: https://arxiv.org/html/2412.11520
- V2Edit: https://arxiv.org/abs/2503.10634 · https://immortalco.github.io/V2Edit/
- Tinker: https://arxiv.org/pdf/2508.14811 · DisCo3D: https://arxiv.org/pdf/2508.01684 · Edit3r: https://arxiv.org/pdf/2512.25071 · TRACE: https://arxiv.org/pdf/2604.01207 · Look Before You Edit: https://arxiv.org/pdf/2607.19777 · 3D-LATTE: https://arxiv.org/pdf/2509.00269
- 3DSceneEditor: https://ziyangyan.github.io/3DSceneEditor/ · EditAnyScene: https://cveu.github.io/src/extended_abstract_2025/12.pdf

**Repair, SR, deblur, transients, relighting, style**
- Difix3D+: https://arxiv.org/abs/2503.01774 · https://openaccess.thecvf.com/content/CVPR2025/html/Wu_DIFIX3D_Improving_3D_Reconstructions_with_Single-Step_Diffusion_Models_CVPR_2025_paper.html · https://github.com/nv-tlabs/Difix3D (NVIDIA non-commercial licence) · https://huggingface.co/nvidia/difix
- NVIDIA Fixer: https://github.com/nv-tlabs/Fixer (Apache-2.0) · https://huggingface.co/nvidia/Fixer · https://radiancefields.com/nvidia-releases-omniverse-nurec-fixer-at-neurips · https://developer.nvidia.com/blog/how-to-enhance-3d-gaussian-reconstruction-quality-for-simulation/
- ArtiFixer: https://huggingface.co/nvidia/ArtiFixer · https://github.com/nv-tlabs/ArtiFixer · https://alphasignal.ai/news/nvidia-s-artifixer-beats-prior-3d-scene-reconstruction-by-3-db
- 3DGS-Enhancer: https://arxiv.org/abs/2410.16266 · GSFix3D: https://arxiv.org/pdf/2508.14717 · GS-Diff: https://arxiv.org/html/2504.01960v1 · GaussVid: https://arxiv.org/html/2608.21849 · ArtifactWorld: https://arxiv.org/html/2604.12251 · RestorGS: https://openaccess.thecvf.com/content/CVPR2025/papers/Qiao_RestorGS_Depth-aware_Gaussian_Splatting_for_Efficient_3D_Scene_Restoration_CVPR_2025_paper.pdf · diffusion-repair caution blog: https://tharunkumar.xyz/blog/3dgs-restoration
- SRGS: https://arxiv.org/abs/2404.10318 · code https://github.com/XiangFeng66/SR-GS (Inria licence) · IE-SRGS: https://arxiv.org/abs/2511.22233v1 · GaussianSR: https://arxiv.org/abs/2406.10111 · SuperGS: https://arxiv.org/html/2410.02571v2 · SplatSuRe: https://arxiv.org/html/2512.02172v1 · MVGSR: https://www.alphaxiv.org/abs/2512.15048.md · Gradient-aware upscaling (ICCV 25): https://arxiv.org/html/2503.14171v2
- BAD-Gaussians: https://arxiv.org/pdf/2403.11831
- SpotLessSplats: https://arxiv.org/abs/2406.20055v1 · https://github.com/lilygoli/SpotLessSplats (Apache-2.0) · WildGaussians: https://github.com/jkulhanek/wild-gaussians (MIT)
- Bilateral grids: https://arxiv.org/html/2506.05280v4 (NeurIPS 25) · https://arxiv.org/html/2507.15748v1 · gsplat trainer flags: https://github.com/nerfstudio-project/gsplat/blob/main/examples/simple_trainer.py
- LumiGauss: https://openaccess.thecvf.com/content/WACV2025/papers/Kaleta_LumiGauss_Relightable_Gaussian_Splatting_in_the_Wild_WACV_2025_paper.pdf · https://github.com/joaxkal/lumigauss · GaRe: https://openaccess.thecvf.com/content/ICCV2025/html/Bai_GaRe_Relightable_3D_Gaussian_Splatting_for_Outdoor_Scenes_from_Unconstrained_ICCV_2025_paper.html · OSDR-GS: https://www.ijcai.org/proceedings/2025/0111.pdf · R3GW: https://arxiv.org/html/2603.02801
- FastSplatStyler: https://arxiv.org/abs/2508.05813v2 · https://github.com/davidmhart/FastSplatStyler (MIT) · CLIPGaussian: https://arxiv.org/abs/2505.22854 · SGSST: https://arxiv.org/abs/2412.03371v2 · TranSplat: https://arxiv.org/abs/2503.22676v1
- Awesome 3DGS index: https://mrnerf.github.io/awesome-3D-gaussian-splatting/

**Frame/video restoration and video-to-video**
- Per-frame inconsistency in 3DGS: https://arxiv.org/pdf/2509.17789 (underwater, restoration→reconstruction) · https://arxiv.org/html/2505.01235 · https://arxiv.org/html/2511.21697v1
- SeedVR / SeedVR2: https://github.com/ByteDance-Seed/SeedVR (Apache-2.0) · https://huggingface.co/ByteDance-Seed/SeedVR2-7B · fal.ai pricing https://fal.ai/models/fal-ai/seedvr/upscale/video
- SUPIR licence: https://github.com/Fanghua-Yu/SUPIR/blob/master/LICENSE · Real-ESRGAN: https://github.com/xinntao/Real-ESRGAN (BSD-3)
- Wan 2.1: https://github.com/Wan-Video/Wan2.1 · Wan 2.2: https://github.com/Wan-Video/Wan2.2 · VACE: https://github.com/ali-vilab/VACE (Apache-2.0) · ComfyUI VACE inpainting: https://comfy.org/workflows/video_wan_vace_inpainting-a1bb55d904c9/
- Runway Aleph pricing (third-party): https://www.atlascloud.ai/blog/tips/runway-aleph · Luma Modify (third-party): https://www.atlascloud.ai/blog/tips/luma-modify-video · Kling: https://muapi.ai/comparison/kling-o1-standard-video-edit · https://costbench.com/software/ai-media-apis/kling-api/
- Topaz: https://community.topazlabs.com/t/release-3-26-2026/101667 · https://costbench.com/software/ai-video-generators/topaz-video-ai/ · https://www.myarchitectai.com/blog/topaz-ai-pricing
- Topaz-before-splat anecdote: https://x.com/XRarchitect/status/1954275846296068336

**Tools and vendors**
- Spark: https://github.com/sparkjsdev/spark (MIT) · https://sparkjs.dev/docs/splat-editing/
- SuperSplat: https://github.com/playcanvas/supersplat (MIT) · https://developer.playcanvas.com/user-manual/supersplat/editor/color-and-appearance/ · https://radiancefields.com/supersplat-2-5-released · https://radiancefields.com/supersplat-releases-v2-7-with-sogs-support · https://digitalproduction.com/2025/11/21/supersplat-2-14-adds-full-video-export
- splat-transform: https://github.com/playcanvas/splat-transform (MIT)
- gsplat: https://github.com/nerfstudio-project/gsplat (Apache-2.0) · Nerfstudio: https://github.com/nerfstudio-project/nerfstudio (Apache-2.0)
- Inria 3DGS licence: https://github.com/graphdeco-inria/gaussian-splatting/blob/main/LICENSE.md
- Postshot: https://3dvf.com/en/gaussian-splatting-postshot-is-finally-out-of-beta-try-it-out-now/ · https://bookstack.hku.nl/books/3d-scan/page/gaussian-splatting-online-and-local
- Tool roundups: https://realhorizons.ai/blog/gaussian-splatting-software/ · https://www.splatmart.com/blog/best-3dgs-software-2026 · https://www.utsubo.com/blog/gaussian-splatting-guide · ArtisanGS: https://arxiv.org/html/2602.10173v1 · industry newsletter: https://radiancefields.substack.com/p/november-in-gaussian-splatting-industry
- World Labs Marble export: https://docs.worldlabs.ai/marble/export/gaussian-splat.md
- Splatware (similarly-named hosted platform; we found no public info on "Splatica"): https://radiancefields.com/splatware-expands-its-gaussian-splatting-platform-with-new-training-models-and-360%C2%B0-workflows

**GPU pricing**
- RunPod: https://www.runpod.io/gpu-cloud/pricing · https://www.hivenet.com/post/runpod-pricing-complete-guide-to-gpu-cloud-costs
- Modal: https://www.spheron.network/blog/modal-gpu-pricing-2026-per-second-billing/ · https://www.budgetforge.dev/tools/modal-pricing-2026
- Lambda: https://www.spheron.network/blog/lambda-cloud-h100-pricing-2026/ · https://intuitionlabs.ai/articles/h100-rental-prices-cloud-comparison

*Verification notes:*
- Licences for the GitHub repos were read from their LICENSE files on 2026-10-08. "No licence" means none was found in the repo root.
- Vendor prices marked "reported" come from third-party pages, because several vendor sites were unreachable from the research environment. Re-check them before budgeting.
- Compute numbers are the papers' own, on their (smaller) scenes.
