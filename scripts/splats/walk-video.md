# A 360° walk video for `/vca/walk`

1. **Insta360 Studio** → open the walk → *Export* → **360° video**, H.264,
   resolution **3840×1920** (4K: what phones decode smoothly). Keep the
   camera's direction locked to the walking direction (FlowState on).
2. **Re-encode for the web** (keyframe every 10 frames, so walking *back*
   is smooth; no sound; playable while it downloads):

   ```
   ffmpeg -i export.mp4 -vf scale=3840:1920 -c:v libx264 -preset slow -crf 20 -g 10 -pix_fmt yuv420p -an -movflags +faststart walk-v1.mp4
   ```

   `-crf 18` is sharper and bigger, `-crf 23` smaller and softer.
3. **Upload** `walk-v1.mp4` at `/operator/splats` with a scene id (e.g.
   `worldonyonge-walk`), then press **Walk** next to it in *Files in R2*.

A new version is a new file name (`walk-v2.mp4`): scene files are cached for a year.

⚠️ A new version of a walk that has doors needs its doors placed again (or
the old file kept): doors belong to one file's timeline (`scenes/walks.json`).

## The lighter copy for phones (optional)

A phone (any touch screen) plays `<name>-phone.mp4` instead of `<name>.mp4`
when that file is uploaded **into the same scene folder**: the walk page asks
for it once (a HEAD request) and falls back to the original when it is not
there. Make it **from the same export, with the same trim**, so the doors'
times and directions fit both:

```
ffmpeg -i walk-v1.mp4 -vf scale=3840:1920 -c:v libx264 -preset slow -crf 22 -g 10 -pix_fmt yuv420p -an -movflags +faststart walk-v1-phone.mp4
```

Upload it at `/operator/splats` with the same scene id. Nothing is transcoded
on the server. When the main file is already 4K (as step 1 says), the phone
copy is only worth it at a higher `-crf` (smaller) or `scale=2880:1440`; an
8K original (from the Insta360 Studio settings in CLAUDE.md) needs it — no
phone decodes 8K smoothly.

## Doors into shops

On `/operator/splats`, «Doors» next to a walk (or `/vca/walk?v=…&edit=1`
with the admin token) opens the walk with the door editor:

1. Walk (stick or the bar) to the moment the shop's door is beside you, and
   turn until the door is in the middle of the screen.
2. **Door here** — it takes this moment and this direction.
3. Type the English label (and the Persian one, if you like), choose the
   shop's video in **Leads to**, tick **Flat video** if the shop was filmed
   with a phone (a `.mov` from the phone is ticked by itself), **Add door**.
4. **Set as the street walk visitors start on** (once, on the street walk),
   then **Save**. Visitors opening `/vca/walk` start on that walk and see
   «Step inside» within 1.5 s and 60° of the door.

A shop's video is either another 360° walk (`.mp4`, prepared like the
street) or **a phone video** of the inside. A phone video is shown flat,
full screen, with the same stick (forward plays, back steps back). The
iPhone's own `.mov` is kept privately by the uploader and shown to visitors
only once a door leads to it; it is usually HEVC, which Safari plays and
Chrome often does not. For every browser, export the phone video as H.264
`.mp4` («Most Compatible» on the iPhone, or
`ffmpeg -i IMG_0042.MOV -c:v libx264 -crf 20 -g 10 -pix_fmt yuv420p -an -movflags +faststart shop-v1.mp4`)
and upload that instead. Film with **HDR Video off** (Settings → Camera →
Record Video): an HDR clip re-encoded this way comes out washed out, and
browsers show HDR inconsistently.
