FROM node:20-slim
# ffmpeg: the Store Builder crew makes each 360° walk's web and phone copies and
# cuts views for the Tagger (`lib/stores/media.ts`); the walk page's «Cut» uses it too.
# python3 + OpenCV: a shelf's zoom photo is stitched from its three phone photos and cut into Deep Zoom tiles by
# `scripts/stitch/stack.py` (`lib/stores/gigapan.ts`). The headless wheel: no display libraries. The version is the
# one the stitcher was tested on.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip \
    && pip3 install --no-cache-dir --break-system-packages "numpy<3" "opencv-python-headless==4.10.0.84" \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# NEXT_PUBLIC_* values are baked in at build time, so Railway passes them as build args.
ARG NEXT_PUBLIC_SITE_URL=https://vbazaar.app
ARG NEXT_PUBLIC_SPLAT_BASE_URL
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ARG NEXT_PUBLIC_SAREKOOCHE_URL=https://sarekooche.com
ARG RAILWAY_GIT_COMMIT_SHA
# Build, then drop what only the build needs (dev deps, .next/cache, @next/swc-*),
# so the image Railway pushes on every deploy stays small.
RUN npm run build && npm prune --omit=dev \
    && rm -rf .next/cache node_modules/@next/swc-*
ENV NODE_ENV=production
EXPOSE 8080
CMD ["sh", "-c", "exec node_modules/.bin/next start -p ${PORT:-8080}"]
