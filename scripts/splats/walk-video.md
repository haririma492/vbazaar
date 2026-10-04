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
