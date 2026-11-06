import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTitle, positionAt, radioChannelOf, readChannelState, youTubeIdOf } from "./radio.ts";

const AT = Date.parse("2026-11-06T18:10:00Z");

test("channel 3 (a Nikoo channel) airing a file from our bucket", () => {
  const r = readChannelState(3, {
    ok: true, title: "YouTube video SB9ee_fPoCE", playerType: "video",
    mediaUrl: "https://assets.mokran.tv/slides-rehost/1781731613009-MEDIA-x.mp4",
    offsetSec: 4023, endsAt: "2026-11-06T19:23:54.604Z",
    upNext: [{ title: "Charles Aznavour - Comme ils disent (Audio Officiel)" }],
  }, AT);
  assert.equal(r.kind, "file");
  assert.equal(r.url, "https://assets.mokran.tv/slides-rehost/1781731613009-MEDIA-x.mp4");
  assert.equal(r.offsetSec, 4023);
  assert.equal(r.endsAt, Date.parse("2026-11-06T19:23:54.604Z"));
  assert.equal(r.now, null, "a placeholder title is no title");
  assert.equal(r.next?.en, "Charles Aznavour - Comme ils disent (Audio Officiel)");
});

test("channel 4 (the main broadcast) airing a YouTube video", () => {
  const r = readChannelState(4, {
    ok: true, mediaUrl: "https://www.youtube.com/watch?v=4y3Qul4Uo1Q", playerType: "youtube", offsetSec: 3310,
    currentItemDurationSec: 4763, currentItem: { titleEn: "Vintage Love Songs", titleFa: "آهنگ‌های عاشقانه وینتج" },
    upcomingItems: [{ titleFa: "اگه منو ول کنی ارزش نداره", artistFa: "خولیو ایگلسیاس", titleEn: "Se mi lasci non vale", artistEn: "Julio Iglesias" }],
  }, AT);
  assert.equal(r.kind, "youtube");
  assert.equal(r.youtubeId, "4y3Qul4Uo1Q");
  assert.equal(r.endsAt, AT + (4763 - 3310) * 1000);
  assert.equal(r.now?.fa, "آهنگ‌های عاشقانه وینتج");
  assert.equal(r.next?.fa, "اگه منو ول کنی ارزش نداره — خولیو ایگلسیاس");
});

test("what cannot be played here is `none`, with a reason, never a guess", () => {
  assert.equal(readChannelState(3, { ok: true, mediaUrl: "https://x.example/live.m3u8", playerType: "hls" }, AT).kind, "none");
  assert.equal(readChannelState(3, { ok: false }, AT).kind, "none");
  assert.equal(readChannelState(4, null, AT).kind, "none");
  assert.equal(readChannelState(3, { mediaUrl: "http://plain.example/a.mp4", playerType: "video" }, AT).kind, "none");
});

test("YouTube ids: host anchored", () => {
  assert.equal(youTubeIdOf("https://youtu.be/4y3Qul4Uo1Q?t=3"), "4y3Qul4Uo1Q");
  assert.equal(youTubeIdOf("https://www.youtube.com/embed/4y3Qul4Uo1Q"), "4y3Qul4Uo1Q");
  assert.equal(youTubeIdOf("https://youtube.com.evil.test/watch?v=4y3Qul4Uo1Q"), null);
  assert.equal(youTubeIdOf("https://www.youtube.com/watch?v=short"), null);
});

test("titles, channels, position", () => {
  assert.equal(cleanTitle("YouTube video oW4VJZvND-Q"), null);
  assert.equal(cleanTitle(" La Pared "), "La Pared");
  assert.equal(radioChannelOf("3"), 3);
  assert.equal(radioChannelOf(5), null);
  assert.equal(positionAt({ offsetSec: 100, at: AT }, AT + 2500), 102.5);
});
