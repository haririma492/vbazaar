# Fonts kept in the repo

Google Fonts' own latin `.woff2` files, loaded with `next/font/local` so a
build never fetches from Google. (`next/font/google` fetches at build time;
on 2026-10-09 Railway's build got an answer it could not parse and failed
with «Cannot read properties of null (reading '1')» in `/chinastore`.)

| File | Font | Used by |
| --- | --- | --- |
| `cormorant-garamond-latin.woff2`, `-italic-latin.woff2` | Cormorant Garamond v21, variable 300–700 | `app/chinastore/page.tsx` |
| `bodoni-moda-500-italic-latin.woff2` | Bodoni Moda v28, italic 500 | `app/page.tsx` (the co-op line under the badge) |

Both are under the SIL Open Font License 1.1, which allows bundling them.
Only the latin subset is kept — what the pages asked Google for.
