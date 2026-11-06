# The Store Builder crew

**In two sentences:** for every store we film, the crew turns the operator's
uploads (an Insta360 360° walk, the product workbook, product photos, a photo
of the real door) into a walkable shop in the bazaar, with a price tag pinned
on each product and the store's door on the hallway. It runs on vbazaar.app's
own server as each file arrives. A new store waits for the operator's
«Publish».

- **Owner:** the operator (V-Bazaar). Built 2026-10-30.
- **Code:** `lib/stores/` (the rules are plain code with tests: `store.ts`,
  `bazaar.ts`, `tagging.ts`, `workbook.ts`; the server side: `crew.ts`,
  `ai.ts`, `media.ts`, `messages.ts`, `bucket.ts`, `auth.ts`), the routes
  `app/api/stores/`, and the screens `components/stores/` plus `app/stores/`.
- **Screens:**
  - `/stores` is the operator's list.
  - `/stores/new` is the intake, one question per card.
  - `/stores/<slug>` is the store's own page, opened with the store's
    password or the admin token.
  - `/stores/areas` covers outside, the lobby, the hallway and its door spots.

```
 intake (one question per card) ──► store record + password (masters bucket, private)
        │ uploads: 360° MP4 · workbook · photos · door photo   (in parts, resumable)
        ▼
 ┌─────────────┬──────────────────┐
 ▼             ▼                  ▼
 Video       Catalogue ──────► Photo matcher
 (web+4K)      └───────┬──────────┘
 └─────────────┬───────┘
               ▼
            Tagger ──► Placer (next free spot on the hallway; door up on «Publish»)
               ▼
            Checker ──► report on /stores/<slug>

 Catalogue (products found in the video) ──► WEBSITE STEP (every store, existing and new; again after every new list)
     store's website ──► Website Explorer ──► /stores/<slug>/website (+ CSV)
                              ├─► product list (merged, the site's products added)
                              └─► Matcher: each product found in the video ⇄ its website product (Haiku compares the
                                  photos) → the video's product keeps its lights and gets the site's name, price,
                                  description and photos; the website copy leaves the list ──► Free Tour + Shelf Tour cards
               │   ▲
  owner/operator   │ new round: only the steps a change touches (`REDO`)
  message box  ▼   │
            Messages agent
```

## The agents

| Agent | Job | Inputs → outputs | Uses | Model |
|---|---|---|---|---|
| Video | The upload becomes a walk browsers can play | the master `.mp4` → `scenes/store-<slug>/walk-<stamp>.mp4` (H.264, at most 5760 wide, CRF 18, keyframe every 10 frames) plus `-phone.mp4` (3840 wide) | ffmpeg | none |
| Catalogue | The workbook becomes the store's product list | `.xlsx` (every sheet, pictures placed on rows or in cells) → `scenes/catalogues/store-<slug>.json` | `workbook.ts` | none |
| Photo matcher | Each photo is joined to its product | photos → `product.photo`, by file name or photo list first, then by looking (taken at confidence ≥ 0.7) | Claude vision, one request per photo, JSON schema | Opus 5.5, effort low |
| Tagger | Each product in the video gets its light and outline | full-size walk + list → walk `items` (`auto-<n>-<k>`, each with `size`, its outline) | 16 shelf views (8 directions × 2 heights, 50°) every 3 s in one Claude request, JSON schema with boxes round each product or group of its copies; then followed frame by frame on a 2048-wide panorama to a fraction of a pixel (`tagging.ts`, `track.ts`) | Opus 5.5, effort medium |
| Product finder (no list) | Every product for sale in the video is listed, named and pictured | the same looks → the store's list (`by: "video"`) + photos + items | as the Tagger, asked for EVERY title or product, a run of copies as one, an unreadable title described by its look for the owner to name | Opus 5.5, effort medium |
| Re-pinner | Walks pinned by the old follow are followed again from Claude's own sightings | walk `items` → the same items, steadier pins; `Walk.pinned = 2` | `repin.ts`; no AI, runs once per walk when the server starts | none |
| Photo improver | Every product's photo is made from several frames at its sharpest moment, for every store | the walk + its lights → `product.photo` (1024 px, the product boxed) | `photoFuse.ts` + `fuse.ts`: 8 moments measured for sharpness, the frames round the sharpest lined up to a fraction of a pixel and averaged inside the product's box; queued after the products are found or re-pinned (`photos/pending.json`), carried on after a restart | none |
| Route optimizer | A smooth forward route through the walk: no walking back, no second passes, every product still shown | the walk + its lights → a proposal (`stores/<slug>/route.json`) and a preview video; on the owner's yes, the walk editor's cut | `route.ts` (plan, tested) + `routeJob.ts`: motion read off the floor and the horizon 5 times a second; joins moved to the most alike pair of moments that still cut what the plan cuts; a join that cannot be seamless dips to black for 0.3 s each side (the length, and every light's time, unchanged). Smoothness too: each walk's motion kept (`Walk.motion`); the player evens the speed and eases sharp turns from it (`lib/splats/motion.ts`) | none |
| Map builder | A 2D map of the store: where each shelf stands, persistent shelf ids, and the Shelf Tour's order by the layout (not by the filming) | the motion (the Route optimizer's reader, kept in `stores/<slug>/motion.json`), every sighting and light step, the Shelf finder's shelves → `stores/<slug>/map.json` (shelves `S1…`, products placed, the camera's path, the entrance, the order, what to review) | `storeMap.ts` (tested) + `mapJob.ts`: dead reckoning, repeated visits found by panorama matching and the drift spread back, each product triangulated from the rays of a moving camera (or estimated, and said so), partial views of one bookcase merged; `orderShelvesByMap` in the Shelf Tour builders. «Store map» card. Research and next steps: `docs/research/cv-spatial.md` | none |
| Title reader | Each found book's title (and author) as printed, a list beside the products | 12 moments of each book measured for sharpness, the 5 sharpest close-ups (1024 px) from the recording → `stores/<slug>/titles.json`; «Book titles» card, CSV | `titles.ts`; one request a book; «Re-read the partial titles» sends only the partly read ones to Opus | **Haiku 5.5** (re-read: Opus 5.5) |
| Spine reader | Every spine in the owner's phone photos of the shelves | «shelf» uploads → each photo at full size (up to 6000 px) in overlapping 1568 px tiles; a tile with a partly read title is read again as four enlarged quarters → `stores/<slug>/shelf-titles.json`, merged with the title reader's in the list | `shelfTitles.ts`, `shelfTitlesRules.ts` (tested); never guesses a title | **Haiku 5.5** |
| **Website Explorer** | Everything the store's own website says about its products, put on the store's page so both tours use it | the store's website (its details) → `stores/<slug>/website.json` (names EN/FA, price and sale price, sizes, every photo at the largest size the site serves, the site's shelf, the description split into English and Persian), shown at `/stores/<slug>/website` with a CSV; then **merged into the store's product list** (`websiteMerge.ts`: added `by: "website"`, or refreshed only where the owner has not changed a field; nothing removed), each main photo copied into our bucket (1600 px, on white), and the Tagger run again so the products get their lights in the Free Tour and the Shelf Tour. The Photo improver keeps a website product's photo | `websiteRules.ts` (tested), `website.ts`, `websiteMerge.ts` (tested): robots.txt first; Shopify `/products.json` or WooCommerce's Store API when the site is one; else the sitemap's product pages, each read through the JSON the page's own scripts ask for (found in its scripts), else JSON-LD, else share tags. One request at a time, 0.4 s apart, resumable. A path robots.txt disallows is read only after the operator answers that this is the store's own site and the store agreed | none |
| **Website matcher** (end of the Website step) | Each product found in the video gets its website product's facts | the list's `by: "video"` products (a photo cut from the walk, what it looked like) + the website's → the video product with the site's name, price, description, the store's photo first and the video's cut after; the website copy leaves the list; verdicts in `stores/<slug>/website-match.json` (asked once) | `websiteMatchRules.ts` (tested: a word shortlist, the join), `websiteMatch.ts`, `ai.ts` `sameProduct`; taken at confidence ≥ 0.75 | **Haiku 5.5** (well under a cent a product) |
| **Store widget** (not an agent: fixed code) | A preview of the store in the Virtual Bazaar on the store's OWN website, for every store | `/widget.js` frames `/w/<slug>`: the Shelf Tour's sneak preview of the Free Tour (its first 20 s as a forward view, with music 1, silent until 🔊; made on our server, `widgetPreview.ts`), else the Shelf Tour's silent loop, else the door and product photos in turn, the store's name, the bazaar's mark, one key «Walk into our store» → `/w/<slug>/go` (counted) → the Free Tour on vbazaar.app (until published: «Coming soon», the key opens the home page). Never the walk, the tours or the basket on their site. Views and clicks by day and by site: `stores/<slug>/widget-stats.json`. The code, a preview and the counts are on the store's page for the operator; the owner sees them when the operator ticks «The store's owner sees this card» | `widgetRules.ts` (tested), `widget.ts` | none |
| **Tidy agent** | Clutter in the store's walk (a sweater on a desk, papers, an old chair, boxes, cleaning things) hidden behind one of the store's products on a made-up stand, standing where the clutter stood; a list of what it removed at the end of the store's page | the walk (from its door on, one moment every ≥ 4 s, 6 views round the camera looking a little down) → each piece boxed with what it stands on, followed through the walk like a light, grouped into objects → `Walk.covers` (product `n`, its pins, a composed PNG: a white card with the product's photo on a riser on a table, a plinth on the floor, nothing on a wall) + a photo of each object as filmed; `stores/<slug>/tidy-state.json` (resumable), `tidy-kept.json` (spots the owner brought back, left alone later). The video is never changed: «Bring it back» takes a cover off exactly | `tidyRules.ts` (tested), `tidy.ts`, `ai.ts` `findJunk` (things for sale, fixtures and people are never clutter; sightings below 0.7 dropped); started by the operator on the store's page, at most $2 a run from the store's budget; the player draws a cover under the lights and a tap opens the product's card | Opus 5.5, effort medium |
| Placer | The store's door goes on the hallway | door photo, spot → a door on the hallway walk, with `image` and `size` | none | none |
| Checker | Writes the report and finds what is missing | everything → `report` on the record | none | none |
| Messages | Does what the owner or operator writes, then answers | the thread → catalogue, tag, detail and walk changes | Claude with tools (`messages.ts`; cutting the video is for the operator only) | Opus 5.5, effort medium |

The areas' walks (outside, lobby, hallway) go through the same Video agent.
Each walk carries on into the next one (`Walk.next`), and the first area is
where shoppers start.

## Success criteria (rule 7)

- The video plays on a computer and on a phone. The Checker confirms both
  copies exist.
- Every product in the list has a price, or the report names it.
- Every uploaded photo is joined to a product, or the report names it.
- A product's light stays on the product as the camera walks past.
  `tagging.test.ts` follows fine book spines within 0.1° in every frame (the
  old follow: 0.31°); `walks.test.ts` walks an aisle past 12 books and keeps
  each light within 0.2° on average.
- Copies of one title side by side are one product, and a tap anywhere on
  them opens it (`itemHitAt`).
- A wrong tag is worse than a missing one. The prompt says so, and sightings
  below 0.6 are dropped.
- No more than $15 of AI per store (raised from $5 by the owner, 2026-11-04). The request that would pass it is not
  made; the step stops and says so on the page. When a long walk's looks
  would not fit, every 2nd (3rd…) moment is looked at instead, so the whole
  walk is still seen (`strideFor`), and the report says so.

**Test cases:** `npm test` covers `lib/stores/*.test.ts`: the step order and
redo rules, the intake checks, a real workbook with a placed picture and a
photo-list sheet, the file-name matching, the tagger's aim (checked against
ffmpeg's `v360`), following, keeping tracks, the spots, the joins and the door
photo.

**Still to add:** the first real store's photos and views, with the right
answers, as the test set for the two vision prompts. Re-run it after any
prompt or model change.

## When things fail (rule 17)

| What | What happens | Who acts |
|---|---|---|
| ffmpeg or the bucket fails | The step is `failed` and is tried again, up to 3 times. Then the page says «needs you» with the error. | Operator: «Run again» |
| The upload is an `.insv` | It is refused at upload, with the Insta360 Studio export steps | Operator |
| The video is not 2:1 | The Video step is `needs-you`: "not a 360° walk" | Operator re-exports |
| No product sheet found | The Catalogue step is `needs-you` and names the header it needs | Operator or owner |
| `ANTHROPIC_API_KEY` missing | The AI steps are `needs-you` and name the variable | Operator: Railway |
| The budget ($15) used | Photos stop being matched (the rest are listed); the Tagger stops looking and keeps what it found | Operator decides |
| The server restarts mid-step | The step that was `working` runs again (`nextStep`). Outputs have new names and are only recorded at the end, so a half-made run leaves nothing behind. | none |
| The website explorer meets a path robots.txt disallows that holds the prices | It stops and asks on `/stores/<slug>/website`: «Is this the store's own website, and has the store agreed?» Yes reads it (the answer is kept with the result); No reads only the allowed pages (no prices) | Operator |
| A product page or photo will not load | Listed under «pages not read»; the rest go on. «Carry on» retries what is left | Operator |
| A Claude request is refused | Server-side fallback (`fallbacks: "default"`). Then that photo or moment is skipped. | none |

**How to stop it:** remove `ANTHROPIC_API_KEY` (the AI steps stop) or stop the
service. A single store stops when its uploads are removed. Nothing runs on a
timer; the crew only wakes on an upload, a message, «Publish» or a server
start.

## Human sign-off (rule 18)

- **Publishing a new store** (shoppers see it) waits for the operator's
  «Publish».
- **Cutting a video** is for the operator only. The original stays kept, and
  «Put the original back» restores it.
- **Spending** is capped at $15 per store (approved by the owner at $5 on 2026-10-30, raised to $15 on 2026-11-04).

## Managed Agents or not (rules 1 and 3, decided 2026-10-30)

The docs were read on 2026-10-30 (overview: the four objects, the beta header
`managed-agents-2026-04-01`, not eligible for Zero Data Retention).

- **Video, Catalogue, Placer and Checker are not agents.** They are fixed code
  (ffmpeg, workbook parsing, JSON). In a sandbox they would sit idle and copy
  multi-GB files in and out of our private bucket. They stay on our server,
  so this runner is not a copy of the harness: it orders fixed code, not model
  turns.
- **The Photo matcher and the Tagger** make one structured request per photo
  or per moment. That is the Messages API's single-call tier, not an agent
  loop.
- **The Messages agent is the one real agent** (model-driven tool use), and
  it is the candidate for Managed Agents. Its tools change our bucket, so they
  would be custom tools answered by this server from the session's events.
  The SDK's tool runner is used meanwhile; no hand-written loop.

**Next step:** move the Messages agent to a Managed Agent. Define it once in
Git and sync it with `ant apply`, with one session per store and its
`session_id` kept on the record. Then delete sessions when a store is closed
(rule 9).

## Where it does not yet follow the rules

- **Rule 6:** the prompts are short, but the "how to read a product list"
  know-how lives in them, not in a Skill.
- **Rule 10:** spending per store is tracked. Request ids and per-step cost
  are not logged yet.
- **Rule 11:** prompts and tools are in Git, but a store's record does not yet
  say which commit built it.
- **Rule 12:** reading text (the title reader, the spine reader) runs on Claude
  Haiku 5.5 (owner, 2026-11-06: *"Make the best use of Haiku this is the
  poor-man-model so lets call it often"*): ~40x cheaper, so it is called more
  (more close-ups, full-size photos, a zoom pass on partly read titles), and a
  title it could not read can be re-read by Opus on the operator's press.
  Finding and boxing products stays on Opus 5.5 until the test set shows Haiku's
  boxes are as good: a wrong box puts a light on the wrong book. Haiku has no
  server-side fallback on a refusal: that one picture is skipped.
- **Rule 19:** there is no test bucket. Everything writes to the production
  buckets. Try new versions on a store that has not been published.
