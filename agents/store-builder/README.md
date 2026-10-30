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
| Tagger | Price tags are pinned on the products in the video | phone copy + list → walk `items` (`auto-<n>-<k>`) | 6 views every 3 s in one Claude request, JSON schema with boxes; then the product is followed frame by frame (`track.ts`) | Opus 5.5, effort medium |
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
- A product the Tagger tags stays on the product as the camera walks past.
  `tagging.test.ts` follows a synthetic product within 1.5°.
- A wrong tag is worse than a missing one. The prompt says so, and sightings
  below 0.6 are dropped.
- No more than $5 of AI per store. The request that would pass it is not
  made; the step stops and says so on the page.

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
| $5 used | Photos stop being matched (the rest are listed); the Tagger stops looking and keeps what it found | Operator decides |
| The server restarts mid-step | The step that was `working` runs again (`nextStep`). Outputs have new names and are only recorded at the end, so a half-made run leaves nothing behind. | none |
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
- **Spending** is capped at $5 per store, approved by the owner on 2026-10-30.

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
- **Rule 12:** all three AI uses run on Opus 5.5 until the test set exists.
  Then try Sonnet 5.5 or Haiku 5.5 for the Photo matcher.
- **Rule 19:** there is no test bucket. Everything writes to the production
  buckets. Try new versions on a store that has not been published.
