# Computer Vision and Spatial Mapping for the bookshop (2026-11-05)

The operator's brief, "OLGOO VCA — Computer Vision and Spatial Mapping", and how it
maps onto what the Store Builder crew already does. The brief says to reuse what
works and not to duplicate it, so this compares each part with the existing code
before adding anything. The first store is Saraye Bamdad, the bookshop.

## What was built (Part 2, first version)

**The store map** (`lib/stores/storeMap.ts`, tested; job `mapJob.ts`; card
«Store map» on `/stores/<slug>`). It is free: it uses no AI.

1. **The camera's path.** The Route optimizer's motion reader already measures how
   the camera moved, 5 times a second: the floor's slide ahead and sideways, and
   the horizon's turn. The map sums those readings into a position and a heading
   (dead reckoning). The distances are estimated metres, because the floor's
   slide is scaled by the camera's assumed height.
2. **Repeated visits.** The map takes one small panorama a second. When two
   moments are at least 15 s apart and the path puts them within 2 m of each
   other, their panoramas are compared at every turn. A match of 0.88 or more
   means the camera was in the same place, and the drift between the two
   moments is spread back over that stretch.
3. **Each product on the floor.** Each sighting, and each step of a product's
   light, is a ray from the camera in the direction the product was seen. The
   rays from a moving camera cross where the product stands. The map solves for
   that point by least squares, and only accepts it when there is a real
   baseline, a real spread of angles, a sane distance and small residuals.
   Otherwise the product is estimated at 1.2 m along its ray, the map marks it
   as estimated, and it goes on the review list.
4. **Shelves.** Each of the Shelf finder's shelves becomes a segment on the
   floor, fitted to its products and facing the camera that saw it. Two
   segments of one bookcase are merged when they are collinear, touching and
   facing the same way. That is how the map handles a partial view of a shelf
   it has already seen.
5. **Persistent Shelf IDs** (`S1`, `S2`…). A shelf keeps its ID from the last
   map when it shares at least half its products with a shelf there. Failing
   that, it keeps the ID of a shelf standing in the same place.
6. **The tour's order.** The tour starts at the entrance and always goes on to
   the nearest shelf, measured by where a shopper would stand in front of it.
   The route is then shortened (2-opt). The Shelf Tour and its "shelf and
   level" stills now follow this order when a map exists (`orderShelvesByMap`),
   so the photographer's route no longer sets the shopper's.
7. **Review list.** It names shelves with few products placed, products placed
   from one view only, and products with no name.

**Not yet on the map:** the checkout counter, display tables, signs and
section labels. Each needs a detector the crew does not run yet (see below).

**Known limits:**
- Dead reckoning drifts by a few percent of the distance walked.
- Heading drift is not corrected; only the position is, at a recognised
  repeated visit.
- The loop threshold (0.88) is a first setting. It has not yet been measured
  on a real walk.

## Part 1: what each suggested tool would add here

| Brief asks | Already in the crew | Suggested tool | Recommendation |
|---|---|---|---|
| Frame extraction, perspective crops (never OCR on panorama edges) | Yes. Every look is a perspective view cut with ffmpeg `v360` (16 shelf views every 3 s; one square-on picture per shelf in the Shelf finder; close-ups for titles) | n/a | Keep. Optionally add moments when the camera turns (the motion reading shows it). |
| Object detection: bookcases, shelves, books | Yes, through Claude vision. It boxes every product and every run of copies; boxes under 0.6 confidence are dropped; shelves and levels come from the boxes (`levels.ts`) | YOLO | Not now. Ultralytics YOLO is **AGPL-3.0**, which for a web service means publishing our code or buying their licence. It needs the 200–500 annotated images the brief mentions, and a GPU to train. On Railway's CPU, YOLO could still be worth having later as a free pre-filter, if per-store AI cost becomes the limit. |
| Fixtures: counters, signs, displays, entrances | Entrance only (`entryOf`, where products start beside the camera) | YOLO / vision-language model | **Next step:** ask Claude for fixtures in the Shelf finder's existing look (one schema change, about $0.30–0.50 a store). That puts the counter, displays and signs on the map. Waiting for the operator's yes, because it spends. |
| Segmentation (SAM 3) | Not used. Boxes plus the shelf rows | SAM 2 (Apache-2.0) / SAM 3 (check Meta's licence) | Not now. It needs a GPU to be practical, and the brief itself says to use it selectively. The places it would help most are a shelf's board edges and occlusions, where the levels are approximate. |
| OCR: titles, authors, signs | Yes, through Claude vision (`titles.ts`). It uses the 3 sharpest close-ups, returns "cannot read" rather than a guess, and never writes over a name | PaddleOCR (Apache-2.0), Google Cloud Vision | Keep Claude as the reader, because it handles Farsi and English spines together. PaddleOCR (CPU, free) is the candidate for a second opinion and a confidence score per line of text. Test it on 50 Saraye Bamdad close-ups before adopting it. |
| Visual understanding (sections: children's, fiction…) | Partly. Each product carries what the crew saw | Vision-language model | Ask for the section in the same fixture request as above. Keep it separate from confirmed evidence (a `seen` versus `inferred` field). |
| Data structure (frame, timestamp, box, confidence, shelf ID, review) | Split across files: `sightings.json`, `shelf-sightings.json` (time, direction, size, confidence), `titles.json`, walk `items`. Now also `map.json` (shelf IDs, positions, review) | n/a | Fine for one store. Add an image quality score per sighting when the Photo improver's sharpness measure is kept. Segmentation masks will only come with segmentation. |
| Camera position and movement | Yes, the motion reader. Now also the map's path, with loop correction | OpenCV feature matching, COLMAP (BSD), ORB-SLAM3 (GPLv3) | COLMAP is only worth trying if the 2D map's drift proves too large. It must be fed perspective views cut from the 360°, never raw equirectangular frames; the earlier splat work did exactly that on a GPU (`scripts/splats/gpu-train.sh`) and placed most frames. The owner dropped the GPU path (2026-10-15), so this would need a new decision. ORB-SLAM3's GPLv3 has the same problem as YOLO's licence. |
| Original INSV kept unchanged | Yes. The `raw` upload stays in the private bucket, for the agents only | n/a | Keep. |

## How to check the map on Saraye Bamdad

1. On `/stores/saraye-bamdad` (operator), go to the «Store map» card and press
   «Build the store map». The first run reads the camera's motion (a few
   minutes); later runs reuse it.
2. Look at the drawing. Check that each yellow line is a real bookcase where you
   remember it, that the green numbers make a sensible walk from the entrance,
   and how many shelves were merged.
3. Rebuild the Shelf Tour (Shelf Tour card). Its shelves now play in the map's
   order.
4. Then decide: fixtures in the Shelf finder's look (spends), and whether the
   drift needs COLMAP.
