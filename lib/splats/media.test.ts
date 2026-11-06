// The walk videos are private and reached through /api/media (owner, 2026-11-06).
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { isPrivateVideoKey, isServableVideoKey, mediaPath, toMediaUrl } from "./media.ts";

test("every video under scenes/ is private, backups included; nothing else is", () => {
  for (const k of [
    "scenes/store-saraye-bamdad/walk-20261104-014600.mp4",
    "scenes/store-saraye-bamdad/walk-20261104-014600-phone.mp4",
    "scenes/store-saraye-bamdad/walk-20261104-014600-reverse.mp4",
    "scenes/store-x/walk-1.mp4.original",
    "scenes/store-x/walk-1.mp4.before-reflections",
    "scenes/shop/clip.MOV",
  ]) assert.equal(isPrivateVideoKey(k), true, k);
  for (const k of [
    "scenes/store-x/audio/sound-1.mp3",
    "scenes/store-x/door.jpg",
    "scenes/walks.json",
    "scenes/hall/hall.spz",
    "masters/shop/clip.mov",
    "stores/x/uploads/video/a.mp4",
    "scenes/store-x/notmp4video.json",
  ]) assert.equal(isPrivateVideoKey(k), false, k);
});

test("the public route signs videos only, never a backup or a strange key", () => {
  assert.equal(isServableVideoKey("scenes/store-x/walk-1.mp4"), true);
  assert.equal(isServableVideoKey("scenes/store-x/walk-1.mp4.original"), false);
  assert.equal(isServableVideoKey("scenes/../stores/x/a.mp4"), false);
  assert.equal(isServableVideoKey("scenes//a.mp4"), false);
  assert.equal(isServableVideoKey("scenes/x/a b.mp4"), false);
  assert.equal(isServableVideoKey("stores/x/uploads/video/a.mp4"), false);
});

test("old public addresses become the route's; others are left alone", () => {
  assert.equal(mediaPath("scenes/a/b.mp4"), "/api/media/scenes/a/b.mp4");
  assert.equal(toMediaUrl("https://pub-51101fa6.r2.dev/scenes/store-x/tour-1.mp4"), "/api/media/scenes/store-x/tour-1.mp4");
  assert.equal(toMediaUrl("https://pub-51101fa6.r2.dev/scenes/store-x/walk.mp4?r=3"), "/api/media/scenes/store-x/walk.mp4?r=3");
  assert.equal(toMediaUrl("https://pub-51101fa6.r2.dev/scenes/store-x/door.jpg"), "https://pub-51101fa6.r2.dev/scenes/store-x/door.jpg");
  assert.equal(toMediaUrl("/api/media/scenes/a/b.mp4"), "/api/media/scenes/a/b.mp4");
  assert.equal(toMediaUrl(""), "");
});
