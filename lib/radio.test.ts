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
  assert.equal(radioChannelOf("4"), 4);
  assert.equal(radioChannelOf("3"), null, "only channel 4");
  assert.equal(radioChannelOf(5), null);
  assert.equal(positionAt({ offsetSec: 100, at: AT }, AT + 2500), 102.5);
});

test("a phone gets the channel's next file programme, in channel order, round the list", async () => {
  const { nextFileProgramme } = await import("./radio.ts");
  const state = {
    currentItemIndex: 10,
    playlistItems: [
      { itemIndex: 9, url: "https://assets.mokran.tv/a.mp4", mediaType: "video", titleEn: "A" },
      { itemIndex: 10, url: "https://www.youtube.com/watch?v=4y3Qul4Uo1Q", mediaType: "video" },
      { itemIndex: 11, url: "https://www.youtube.com/watch?v=Nn3V7D3zmhk", mediaType: "video" },
      { itemIndex: 12, url: "https://video.mokran.tv/b.mp4", mediaType: "video", titleEn: "B", durationSec: 186 },
    ],
  };
  assert.equal(nextFileProgramme(state, null)?.url, "https://video.mokran.tv/b.mp4", "the first file after the one on air");
  assert.equal(nextFileProgramme(state, 12)?.url, "https://assets.mokran.tv/a.mp4", "round to the start");
  assert.equal(nextFileProgramme({ playlistItems: [{ itemIndex: 1, url: "https://youtu.be/4y3Qul4Uo1Q" }] }, null), null);
});

// ── Any channel, any music category (owner, 2026-11-13) ──
import { categoriesOf, interleave, radioSourceOf, readCatalogue, sourceInCatalogue, sourceQuery, tracksOfNonstop, tracksOfResolve } from "./radio.ts";

const CHANNELS = { ok: true, channels: [
  { id: "world-greats", channelNumber: 3, titleFa: "موسیقی جهان", titleEn: "World Music" },
  { id: "iran-new-pop", channelNumber: 1, titleFa: "موسیقی پاپ ایرانی", titleEn: "Iranian Pop Music" },
  { id: "Bad Id!", channelNumber: 9, titleEn: "x" },
] };
const MUSIC = { sections: [{ slug: "musiic", members: [
  { slug: "worldmusic", titleFa: "موسیقی جهان", titleEn: "World Music",
    groups: [{ id: "grp-jazz", label: "Jazz", labelFa: "جاز" }, { id: "grp-empty", label: "Empty", labelFa: "" }],
    categories: [
      { id: "cat-a", label: "Ella", labelFa: "الا", platform: "youtube", hasSource: true, groupId: "grp-jazz" },
      { id: "cat-b", label: "", labelFa: "Miles", platform: "internal", hasSource: true, groupId: "grp-jazz" },
      { id: "cat-ig", label: "Insta", labelFa: "", platform: "instagram", hasSource: true, groupId: "grp-jazz" },
      { id: "cat-noname", label: "", labelFa: "", platform: "internal", hasSource: true, groupId: "" },
      { id: "cat-loose", label: "Sinatra", labelFa: "", platform: "internal", hasSource: true, groupId: "" },
    ] },
  { slug: "iranmusic", titleFa: "موسیقی ایرانی", titleEn: "Iran Music", groups: [{ id: "grp-pop", label: "Pop", labelFa: "پاپ" }],
    categories: [{ id: "cat-p", label: "Ebi", labelFa: "ابی", platform: "youtube", hasSource: true, groupId: "grp-pop" }] },
  { slug: "podcasts", groups: [], categories: [{ id: "cat-x", label: "X", platform: "youtube" }] },
] }] };

test("the catalogue: main broadcast added as 4, channels by number, Instagram and nameless categories left out", () => {
  const c = readCatalogue(CHANNELS, MUSIC);
  assert.deepEqual(c.channels.map((x) => x.id), ["iran-new-pop", "world-greats", "main"]);
  assert.deepEqual(c.sections.map((s) => s.member), ["iranmusic", "worldmusic"]);
  const w = c.sections[1];
  assert.deepEqual(w.groups.map((g) => g.id), ["grp-jazz", ""], "an empty group is not offered; loose categories are «Others»");
  assert.deepEqual(w.groups[0].categories.map((x) => x.id), ["cat-a", "cat-b"]);
  assert.equal(w.groups[0].categories[1].en, "Miles", "a name in one language stands for both");
  assert.deepEqual(w.groups[1].categories.map((x) => x.id), ["cat-loose"]);
  assert.deepEqual(readCatalogue(null, "nonsense").sections, []);
});

test("a choice is saved only as nikoo.tv has it, under nikoo.tv's names", () => {
  const c = readCatalogue(CHANNELS, MUSIC);
  assert.deepEqual(sourceInCatalogue(c, "channel", "world-greats"), { kind: "channel", id: "world-greats", fa: "موسیقی جهان", en: "World Music" });
  assert.equal(sourceInCatalogue(c, "channel", "nope"), null);
  assert.deepEqual(sourceInCatalogue(c, "music", "grp-jazz", "worldmusic"), { kind: "music", member: "worldmusic", id: "grp-jazz", fa: "جاز", en: "Jazz" });
  assert.equal(sourceInCatalogue(c, "music", "cat-a", "worldmusic")?.en, "Ella");
  assert.equal(sourceInCatalogue(c, "music", "cat-a", "iranmusic"), null, "a category of the other section");
  assert.equal(sourceInCatalogue(c, "music", "cat-ig", "worldmusic"), null);
  assert.deepEqual(categoriesOf(c, "worldmusic", "grp-jazz"), ["cat-a", "cat-b"]);
  assert.deepEqual(categoriesOf(c, "worldmusic", "cat-loose"), ["cat-loose"]);
  assert.deepEqual(categoriesOf(c, "worldmusic", "cat-p"), []);
});

test("a walk's stored radio: 4 and the old 3 are the main broadcast; a choice is checked", () => {
  assert.equal(radioSourceOf(4)?.id, "main");
  assert.equal(radioSourceOf(3)?.id, "main");
  assert.equal(radioSourceOf(null), null);
  assert.equal(radioSourceOf({ kind: "channel", id: "../etc" }), null);
  assert.equal(radioSourceOf({ kind: "music", member: "podcasts", id: "cat-a" }), null);
  assert.equal(radioSourceOf({ kind: "music", member: "worldmusic", id: "world-greats" }), null, "music is a cat- or grp- id");
  const s = radioSourceOf({ kind: "music", member: "worldmusic", id: "grp-jazz", fa: "جاز", en: "Jazz", extra: 1 });
  assert.deepEqual(s, { kind: "music", member: "worldmusic", id: "grp-jazz", fa: "جاز", en: "Jazz" });
  assert.equal(sourceQuery(s!), "m=worldmusic&c=grp-jazz");
  assert.equal(sourceQuery(radioSourceOf(4)!), "ch=main");
});

test("another channel's state is read as channel 3's was; a live stream is joined where it is", () => {
  const r = readChannelState("iranian-nostalgia", { ok: true, title: "Viguen - Mahtab", playerType: "video",
    mediaUrl: "https://video.mokran.tv/x.mp4", offsetSec: 131, endsAt: "2026-11-06T18:11:00Z" }, AT);
  assert.equal(r.kind, "file");
  assert.equal(r.offsetSec, 131);
  assert.equal(r.now?.en, "Viguen - Mahtab");
  const live = readChannelState("iran-international", { ok: true, isLive: true, playerType: "youtube",
    mediaUrl: "https://www.youtube.com/watch?v=5JDxjsAVaGk", offsetSec: 1476, endsAt: "2026-11-06T18:30:00Z" }, AT);
  assert.equal(live.kind, "youtube");
  assert.equal(live.offsetSec, 0);
  assert.equal(live.endsAt, null);
  const hls = readChannelState("farsi-news", { ok: true, isLive: true, playerType: "video", mediaUrl: "https://x.example/main.m3u8" }, AT);
  assert.equal(hls.kind, "none");
});

test("a category's tracks: YouTube ids from the non-stop list; files and YouTube videos from its own videos", () => {
  assert.deepEqual(tracksOfNonstop({ ok: true, tracks: [{ videoId: "P0rCiKggBHI" }, { videoId: "bad" }, {}] }), [{ kind: "youtube", id: "P0rCiKggBHI" }]);
  assert.deepEqual(tracksOfNonstop({ ok: false, reason: "not a YouTube source" }), []);
  assert.deepEqual(tracksOfResolve({ categories: [{ videos: [
    { id: "MEDIA#1", postUrl: "https://assets.mokran.tv/a.mp4?X-Amz-Signature=old", videoUrl: "https://assets.mokran.tv/a.mp4" },
    { id: "yt:8Ko4rLxepf4", postUrl: "https://www.youtube.com/watch?v=8Ko4rLxepf4" },
    { id: "ig:Dfp", postUrl: "https://www.instagram.com/p/Dfp/", imageUrl: "https://video.mokran.tv/x.jpg" },
    { id: "x", videoUrl: "http://insecure.example/a.mp4" },
  ] }] }), [{ kind: "file", url: "https://assets.mokran.tv/a.mp4" }, { kind: "youtube", id: "8Ko4rLxepf4" }]);
  assert.deepEqual(tracksOfResolve(null), []);
});

test("a group's singers take turns, no track twice, up to the limit", () => {
  const y = (id: string) => ({ kind: "youtube" as const, id });
  assert.deepEqual(interleave([[y("a1"), y("a2"), y("a3")], [y("b1")], [y("a1"), y("c2")]], 10).map((t) => (t.kind === "youtube" ? t.id : "")), ["a1", "b1", "a2", "c2", "a3"]);
  assert.equal(interleave([[y("a1"), y("a2")], [y("b1"), y("b2")]], 3).length, 3);
});

test("the main broadcast says isLive while it plays an ordinary video: still joined at its second", () => {
  const r = readChannelState("main", { ok: true, isLive: true, playerType: "youtube", mediaUrl: "https://www.youtube.com/watch?v=4y3Qul4Uo1Q",
    offsetSec: 50, currentItemDurationSec: 200 }, AT);
  assert.equal(r.offsetSec, 50);
  assert.equal(r.endsAt, AT + 150_000);
});
