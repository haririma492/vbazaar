// The walks: doors along a 360° street walk into shops' own walk videos,
// and «Back to the street» landing at the door, facing the street.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PITCH, MAX_DOORS, addDoor, angleDiff, signAt, isSiteOnlyDoor, checkWalks, doorsAround, doorsNear, emptyWalks, isPhoneCopy, isWalkKey, keysNamed, mergeConflicts,
  isFlatDoor, isPhoneVideoKey, isVideoKey, looksFlat, mergeWalks, nextDoorId, parseWalks, phoneKeyOf, removeDoor, returnPoint, setStart, startOf, updateDoor, addItem, updateItem, removeItem, setTitle, itemAt, itemsAt, MAX_ITEMS, itemTime, setProjection, setAudio, specialSay, walkOf, wrapAngle, type Walks,
} from "./walks.ts";

const STREET = "scenes/street/street-v1.mp4";
const BAKERY = "scenes/bakery/bakery-v1.mp4";
const BUTCHER = "scenes/butcher/butcher-v2.mp4";

const built = (): Walks => {
  let w = emptyWalks();
  w = addDoor(w, STREET, { t: 42, yaw: 1.2, label: { en: "Bakery", fa: "نانوایی" }, to: BAKERY });
  w = addDoor(w, STREET, { t: 10, yaw: -1.5, label: { en: "Butcher" }, to: BUTCHER });
  return setStart(w, STREET);
};

test("walk keys are the uploader's scene .mp4 keys and nothing else", () => {
  assert.ok(isWalkKey(STREET));
  assert.ok(isWalkKey("scenes/store-01/Walk_V2.MP4"));
  for (const k of ["scenes/street/street.spz", "masters/street/a.mp4", "scenes/Street/a.mp4", "scenes/street/../a.mp4", "scenes/street/.a.mp4", "scenes/a/b/c.mp4", 42]) {
    assert.equal(isWalkKey(k), false, String(k));
  }
  assert.equal(phoneKeyOf(STREET), "scenes/street/street-v1-phone.mp4");
  assert.ok(isPhoneCopy(phoneKeyOf(STREET)));
  assert.equal(isPhoneCopy(STREET), false);
});

test("doors are kept in time order with ids from their labels; the start is a walk", () => {
  const w = built();
  assert.equal(w.start, STREET);
  assert.deepEqual(walkOf(w, STREET)!.doors.map((d) => [d.id, d.t]), [["butcher", 10], ["bakery", 42]]);
  assert.equal(nextDoorId(walkOf(w, STREET), "Bakery"), "bakery-2");
  assert.equal(nextDoorId(null, "Ali's  Bakery!"), "alis-bakery");
  assert.equal(nextDoorId(null, "نانوایی"), "door");
  assert.equal(setStart(w, null).start, undefined);
  assert.equal(setStart(w, "nope").start, undefined);
  // Round trip: what is saved is read back the same.
  assert.deepEqual(parseWalks(JSON.parse(JSON.stringify(w))), w);
});

test("strict reading: every bad entry is named and dropped", () => {
  const { walks, problems } = checkWalks({
    start: "scenes/x/y.spz",
    walks: {
      "not-a-key": { doors: [] },
      [STREET]: {
        title: { en: "Main street" },
        doors: [
          { id: "ok", t: 1, yaw: 7, label: { en: "Shop" }, to: BAKERY },
          { id: "ok", t: 2, yaw: 0, label: { en: "Twice" }, to: BAKERY },
          { id: "Bad Id", t: 2, yaw: 0, label: { en: "x" }, to: BAKERY },
          { id: "neg", t: -1, yaw: 0, label: { en: "x" }, to: BAKERY },
          { id: "nan", t: 1, yaw: Number.NaN, label: { en: "x" }, to: BAKERY },
          { id: "nolabel", t: 1, yaw: 0, label: { fa: "فقط" }, to: BAKERY },
          { id: "self", t: 1, yaw: 0, label: { en: "x" }, to: STREET },
          { id: "nowhere", t: 1, yaw: 0, label: { en: "x" }, to: "scenes/a/a.rad" },
          { id: "badback", t: 1, yaw: 0, label: { en: "x" }, to: BAKERY, back: { t: -2, yaw: 0 } },
        ],
      },
    },
  });
  assert.deepEqual(Object.keys(walks.walks), [STREET]);
  assert.equal(walks.start, undefined);
  const doors = walks.walks[STREET].doors;
  assert.deepEqual(doors.map((d) => d.id), ["ok"]);
  assert.ok(Math.abs(doors[0].yaw - (7 - 2 * Math.PI)) < 1e-12, "yaw wrapped into (−π, π]");
  assert.equal(problems.length, 10);
  assert.match(problems.join("\n"), /used twice/);
  assert.match(problems.join("\n"), /English label/);
  assert.match(problems.join("\n"), /leads to the walk it is on/);
  // Nothing at all is an empty set of walks, not an error.
  assert.deepEqual(checkWalks(null), { walks: { walks: {} }, problems: [] });
  assert.deepEqual(checkWalks({}), { walks: { walks: {} }, problems: [] });
});

test("at most 60 doors on one walk", () => {
  const doors = Array.from({ length: MAX_DOORS + 1 }, (_, i) => ({ id: `d${i}`, t: i, yaw: 0, label: { en: `D${i}` }, to: BAKERY }));
  const { walks, problems } = checkWalks({ walks: { [STREET]: { doors } } });
  assert.equal(walks.walks[STREET].doors.length, MAX_DOORS);
  assert.match(problems[0], /at most 60/);
});

test("angles wrap the short way round", () => {
  assert.equal(wrapAngle(Math.PI), Math.PI);
  assert.equal(wrapAngle(-Math.PI), Math.PI);
  assert.ok(Math.abs(wrapAngle(3 * Math.PI / 2) + Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(angleDiff(3.1, -3.1) - (6.2 - 2 * Math.PI)) < 1e-12);
});

test("a door is in reach within ±1.5 s while looking within ±60° of it, nearest first", () => {
  const walk = walkOf(built(), STREET);
  assert.deepEqual(doorsNear(walk, 42, 1.2).map((d) => d.id), ["bakery"]);
  assert.deepEqual(doorsNear(walk, 43.4, 1.2 + 1).map((d) => d.id), ["bakery"]);
  assert.deepEqual(doorsNear(walk, 43.6, 1.2), [], "too late");
  assert.deepEqual(doorsNear(walk, 42, 1.2 + 1.1), [], "looking away");
  assert.deepEqual(doorsNear(walk, 42, 1.2, { dt: 0.2, dyaw: 0.1 }).map((d) => d.id), ["bakery"]);
  assert.deepEqual(doorsNear(null, 42, 1.2), []);
  // Across the back seam: a door at 179° is in reach looking at −179°.
  const back = walkOf(addDoor(emptyWalks(), STREET, { t: 5, yaw: Math.PI - 0.01, label: { en: "Back" }, to: BAKERY }), STREET);
  assert.equal(doorsNear(back, 5, -Math.PI + 0.01).length, 1);
  // Two doors in reach: the nearer in time and angle comes first.
  let two = addDoor(emptyWalks(), STREET, { t: 20, yaw: 0.5, label: { en: "Far" }, to: BAKERY });
  two = addDoor(two, STREET, { t: 20.2, yaw: 0, label: { en: "Near" }, to: BUTCHER });
  assert.deepEqual(doorsNear(walkOf(two, STREET), 20.2, 0).map((d) => d.id), ["near", "far"]);
});

test("the shop's walk is preloaded from 6 s before its door", () => {
  const walk = walkOf(built(), STREET);
  assert.deepEqual(doorsAround(walk, 36.5).map((d) => d.id), ["bakery"]);
  assert.deepEqual(doorsAround(walk, 35.9), []);
  assert.deepEqual(doorsAround(walk, 12).map((d) => d.id), ["butcher"]);
});

test("back to the street: at the door, still facing the shops — unless overridden", () => {
  const w = built();
  const bakery = walkOf(w, STREET)!.doors.find((d) => d.id === "bakery")!;
  const r = returnPoint(bakery);
  assert.equal(r.t, 42);
  assert.ok(Math.abs(r.yaw - 1.2) < 1e-12);
  const moved = updateDoor(w, STREET, "bakery", { back: { t: 44, yaw: 0.3 } });
  assert.deepEqual(returnPoint(walkOf(moved, STREET)!.doors.find((d) => d.id === "bakery")!), { t: 44, yaw: 0.3 });
});

test("edit, delete and the keys a save must find in the bucket", () => {
  let w = built();
  w = updateDoor(w, STREET, "butcher", { label: { en: "Butcher", fa: "قصابی" }, t: 50 });
  assert.deepEqual(walkOf(w, STREET)!.doors.map((d) => d.id), ["bakery", "butcher"]);
  assert.deepEqual(keysNamed(w).sort(), [BAKERY, BUTCHER, STREET].sort());
  w = removeDoor(w, STREET, "bakery");
  assert.deepEqual(walkOf(w, STREET)!.doors.map((d) => d.id), ["butcher"]);
  assert.equal(removeDoor(w, "scenes/none/a.mp4", "x"), w);
});

test("saving merges: a door added elsewhere is kept, and this page's edits go in", () => {
  const base = built();
  // Elsewhere: a door added on the street, and a new walk with a door.
  let theirs = addDoor(base, STREET, { t: 70, yaw: 0, label: { en: "Tailor" }, to: "scenes/tailor/t.mp4" });
  theirs = addDoor(theirs, BAKERY, { t: 3, yaw: 3, label: { en: "Back room" }, to: "scenes/bakery/back.mp4" });
  // Here: the bakery relabelled, the butcher deleted, the start changed.
  let mine = updateDoor(base, STREET, "bakery", { label: { en: "Ali's Bakery" } });
  mine = removeDoor(mine, STREET, "butcher");
  mine = setStart(mine, BAKERY);
  const m = mergeWalks(base, mine, theirs);
  assert.deepEqual(walkOf(m, STREET)!.doors.map((d) => [d.id, d.label.en]), [["bakery", "Ali's Bakery"], ["tailor", "Tailor"]]);
  assert.deepEqual(walkOf(m, BAKERY)!.doors.map((d) => d.id), ["back-room"]);
  assert.equal(m.start, BAKERY);
  assert.deepEqual(mergeConflicts(base, mine, theirs), []);
  // Unchanged here: the stored start stays.
  assert.equal(mergeWalks(base, base, setStart(base, BUTCHER)).start, BUTCHER);
  // Nothing stored yet: mine is taken whole.
  assert.deepEqual(mergeWalks(emptyWalks(), base, emptyWalks()), base);
});

test("the same door changed here and elsewhere: this page's wins, and it is said", () => {
  const base = built();
  const theirs = updateDoor(base, STREET, "bakery", { t: 41 });
  const mine = updateDoor(base, STREET, "bakery", { t: 43 });
  const m = mergeWalks(base, mine, theirs);
  assert.equal(walkOf(m, STREET)!.doors.find((d) => d.id === "bakery")!.t, 43);
  assert.equal(mergeConflicts(base, mine, theirs).length, 1);
  // A walk deleted elsewhere but untouched here stays deleted.
  const { [STREET]: _gone, ...rest } = base.walks;
  const deleted = { ...base, walks: rest };
  assert.equal(walkOf(mergeWalks(base, base, deleted), STREET), null);
});

test("a shop filmed with an iPhone: a flat .mov the uploader kept privately may be a door's target", () => {
  const MOV = "scenes/x/x.mov";
  const PHONE = "masters/bakery/IMG_0042.MOV";
  assert.ok(isPhoneVideoKey(PHONE));
  assert.ok(isVideoKey(PHONE));
  assert.equal(isPhoneVideoKey(MOV), false);
  assert.equal(isPhoneVideoKey("masters/bakery/bakery.ply"), false);
  assert.equal(isVideoKey(MOV), false);
  const w = addDoor(emptyWalks(), STREET, { t: 3, yaw: 0, label: { en: "Bakery" }, to: PHONE });
  const { walks, problems } = checkWalks(JSON.parse(JSON.stringify(w)));
  assert.deepEqual(problems, []);
  const door = walkOf(walks, STREET)!.doors[0];
  assert.equal(door.to, PHONE);
  assert.ok(isFlatDoor(door), "a phone video is flat");
  // A flat .mp4 among the scenes: ticked by the operator.
  const ticked = checkWalks({ walks: { [STREET]: { doors: [{ id: "a", t: 1, yaw: 0, label: { en: "A" }, to: BAKERY, flat: true }, { id: "b", t: 2, yaw: 0, label: { en: "B" }, to: BAKERY, flat: "yes" }] } } }).walks;
  assert.deepEqual(walkOf(ticked, STREET)!.doors.map(isFlatDoor), [true, false]);
  // The start is always a 360° street walk.
  assert.equal(setStart(w, PHONE).start, undefined);
  // The shape tells: 2:1 is 360°, anything else flat.
  assert.equal(looksFlat(7680, 3840), false);
  assert.equal(looksFlat(3840, 1920), false);
  assert.equal(looksFlat(3840, 2160), true);
  assert.equal(looksFlat(1080, 1920), true);
  assert.equal(looksFlat(0, 0), true);
});

test("the sign sits on the door: pins are followed, the short way round, and kept in time order", () => {
  const door = { id: "shop", t: 10, yaw: 0, label: { en: "Shop" }, to: "scenes/shop/shop-v1.mp4", pins: [
    { t: 12, yaw: -3, pitch: 0.2 },
    { t: 8, yaw: 3, pitch: 0 },
  ] };
  const w = parseWalks({ walks: { "scenes/street/street-v1.mp4": { doors: [door] } } });
  const d = w.walks["scenes/street/street-v1.mp4"].doors[0];
  assert.deepEqual(d.pins!.map((p) => p.t), [8, 12]);
  // Halfway, across ±π: the short way round (3 → −3 passes π), not through 0.
  const mid = signAt(d, 10)!;
  assert.ok(Math.abs(Math.abs(mid.yaw) - Math.PI) < 1e-9);
  assert.ok(Math.abs(mid.pitch - 0.1) < 1e-9);
  assert.equal(signAt(d, 7), null);
  assert.deepEqual(signAt(d, 12.3), { yaw: wrapAngle(-3), pitch: 0.2 });
  // In reach while looking at it, from the first pin to the last.
  assert.equal(doorsNear(w.walks["scenes/street/street-v1.mp4"], 11.9, -3).length, 1);
  assert.equal(doorsNear(w.walks["scenes/street/street-v1.mp4"], 11.9, 0).length, 0);
});

test("a door without pins: its sign at its own heading, a little below the horizon", () => {
  const d = { id: "a", t: 5, yaw: 1, label: { en: "A" }, to: "scenes/a/a.mp4" };
  assert.deepEqual(signAt(d, 5.5), { yaw: 1, pitch: DEFAULT_PITCH });
  assert.equal(signAt(d, 7), null);
  const bad = checkWalks({ walks: { "scenes/street/s.mp4": { doors: [{ ...d, pitch: 3 }] } } });
  assert.equal(bad.problems.length, 1);
});

test("a door may open the shop's website — with its video, or on its own; https only", () => {
  const base = { id: "a", t: 1, yaw: 0, label: { en: "A" } };
  const ok = checkWalks({ walks: { [STREET]: { doors: [
    { ...base, url: "https://shop.example/menu" },
    { ...base, id: "b", to: BAKERY, url: "https://bakery.example" },
  ] } } });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.walks.walks[STREET].doors[0].to, undefined);
  assert.equal(isSiteOnlyDoor(ok.walks.walks[STREET].doors[0]), true);
  assert.equal(isSiteOnlyDoor(ok.walks.walks[STREET].doors[1]), false);
  assert.deepEqual(keysNamed(ok.walks), [STREET, BAKERY]);
  for (const url of ["http://shop.example", "javascript:alert(1)", "https://u:p@shop.example", "nope"]) {
    assert.equal(checkWalks({ walks: { [STREET]: { doors: [{ ...base, url }] } } }).problems.length, 1, url);
  }
  assert.equal(checkWalks({ walks: { [STREET]: { doors: [base] } } }).problems.length, 1);
});

test("with no start set, /vca/walk opens the street: the walk with doors no door leads into", () => {
  const SHOP = "scenes/ali/ali.mp4";
  let w = addDoor(emptyWalks(), STREET, { t: 5, yaw: 0, label: { en: "Ali" }, to: SHOP });
  w = addDoor(w, SHOP, { t: 2, yaw: 0, label: { en: "Back room" }, to: "scenes/back/back.mp4" });
  assert.equal(w.start, undefined);
  assert.equal(startOf(w), STREET);
  assert.equal(startOf(setStart(w, SHOP)), SHOP);
  assert.equal(startOf(emptyWalks()), null);
});

test("items you can pick up: kept with their pins in order, checked, merged", () => {
  const SHOP = "scenes/test/shop-video.mp4";
  let w = setTitle(emptyWalks(), SHOP, { en: "Ali's Market", fa: "بازار علی" });
  w = addItem(w, SHOP, { label: { en: "Saffron 2g", fa: "زعفران" }, price: "$12.99", pins: [{ t: 9, x: 0.7, y: 0.4 }, { t: 5, x: 0.3, y: 0.5 }] });
  w = addItem(w, SHOP, { label: { en: "Saffron 2g" }, pins: [{ t: 2, x: 0.5, y: 0.5 }] });
  const walk = walkOf(w, SHOP)!;
  assert.deepEqual(walk.title, { en: "Ali's Market", fa: "بازار علی" });
  assert.deepEqual(walk.items!.map((i) => i.id), ["saffron-2g-2", "saffron-2g"]);
  assert.deepEqual(walk.items![1].pins.map((p) => p.t), [5, 9]);
  // A round trip through JSON keeps them; a bad one is reported.
  assert.deepEqual(parseWalks(JSON.parse(JSON.stringify(w))), w);
  const bad = JSON.parse(JSON.stringify(w));
  bad.walks[SHOP].items[0].image = "http://example.com/a.jpg";
  bad.walks[SHOP].items[1].pins = [{ t: -1, x: 0, y: 0 }];
  assert.equal(checkWalks(bad).problems.length, 2);
  // Edit and delete; two pages adding items at once both keep theirs.
  const edited = updateItem(w, SHOP, "saffron-2g", { price: "$11.99" });
  assert.equal(walkOf(edited, SHOP)!.items!.find((i) => i.id === "saffron-2g")!.price, "$11.99");
  assert.deepEqual(walkOf(removeItem(w, SHOP, "saffron-2g"), SHOP)!.items!.map((i) => i.id), ["saffron-2g-2"]);
  const theirs = addItem(w, SHOP, { label: { en: "Tea" }, pins: [{ t: 20, x: 0.1, y: 0.1 }] });
  const mine = addItem(w, SHOP, { label: { en: "Rice" }, pins: [{ t: 30, x: 0.2, y: 0.2 }] });
  assert.deepEqual(walkOf(mergeWalks(w, mine, theirs), SHOP)!.items!.map((i) => i.id).sort(), ["rice", "saffron-2g", "saffron-2g-2", "tea"]);
  assert.ok(MAX_ITEMS >= 100);
});

test("an item's dot follows its pins, and only while they last", () => {
  const item = { id: "tea", label: { en: "Tea" }, pins: [{ t: 10, x: 0.2, y: 0.5 }, { t: 14, x: 0.6, y: 0.3 }] };
  assert.equal(itemAt(item, 9.4, false), null);
  assert.deepEqual(itemAt(item, 9.6, false), { x: 0.2, y: 0.5 });
  const mid = itemAt(item, 12, false)!;
  assert.ok(Math.abs(mid.x - 0.4) < 1e-12 && Math.abs(mid.y - 0.4) < 1e-12);
  assert.equal(itemAt(item, 14.6, false), null);
  // On a 360° walk, x is a direction: it goes the short way round.
  const round = { id: "r", label: { en: "R" }, pins: [{ t: 0, x: 3, y: 0 }, { t: 2, x: -3, y: 0 }] };
  assert.ok(Math.abs(Math.abs(itemAt(round, 1, true)!.x) - Math.PI) < 0.01);
  // One pin: shown round its moment.
  const one = { id: "o", label: { en: "O" }, pins: [{ t: 5, x: 0.5, y: 0.5 }] };
  assert.ok(itemAt(one, 7.9, false) && !itemAt(one, 8.1, false));
  assert.deepEqual(itemsAt({ doors: [], items: [item, one] }, 12, false).map((a) => a.item.id), ["tea"]);
});

test("no shelves (dropped 2026-10-12): an old walks.json with them still reads, without them", () => {
  const SHOP = "scenes/test/shop-video.mp4";
  const old = { walks: { [SHOP]: { doors: [],
    shelves: [{ id: "electronic", label: { en: "Electronic" }, t0: 0, t1: 8 }],
    items: [
      { id: "phone", label: { en: "Phone" }, shelf: "electronic", pins: [{ t: 3, x: 0.5, y: 0.5 }] },
      { id: "cable", label: { en: "Cable" }, shelf: "electronic", pins: [] },
    ] } } };
  const { walks, problems } = checkWalks(old);
  assert.deepEqual(problems, []);
  const walk = walkOf(walks, SHOP)!;
  assert.equal("shelves" in walk, false);
  assert.deepEqual(walk.items!.map((i) => [i.id, "shelf" in i, i.pins.length]), [["cable", false, 0], ["phone", false, 1]]);
  assert.equal(itemTime(walk.items![0]), 0);
  assert.equal(itemTime(walk.items![1]), 3);
});

test("a walk may say how its video holds its picture (a YouTube 360° download is 16:9)", () => {
  const K = "scenes/ax-man/tour.mp4";
  const w = setProjection(emptyWalks(), K, "eac");
  assert.equal(walkOf(w, K)!.projection, "eac");
  assert.deepEqual(parseWalks(JSON.parse(JSON.stringify(w))), w);
  assert.equal(walkOf(setProjection(w, K, null), K)!.projection, undefined);
  assert.equal(checkWalks({ walks: { [K]: { doors: [], projection: "fisheye" } } }).problems.length, 1);
  // Set here while someone else added a door: both kept.
  const theirs = addDoor(emptyWalks(), K, { t: 1, yaw: 0, label: { en: "Way out" }, to: STREET });
  assert.equal(walkOf(mergeWalks(emptyWalks(), w, theirs), K)!.projection, "eac");
});

test("a walk may have its own background sound, uploaded for walks", () => {
  const K = "scenes/ax-man/tour.mp4";
  const SOUND = "scenes/ax-man/audio/sound-20261018-101500.mp3";
  const w = setAudio(emptyWalks(), K, SOUND);
  assert.equal(walkOf(w, K)!.audio, SOUND);
  assert.deepEqual(parseWalks(JSON.parse(JSON.stringify(w))), w);
  assert.ok(keysNamed(w).includes(SOUND), "saving checks the sound is in the bucket");
  assert.equal(walkOf(setAudio(w, K, null), K)!.audio, undefined);
  for (const bad of ["https://example.com/a.mp3", "scenes/ax-man/signs/a.mp3", "scenes/ax-man/audio/sound-1.wav"]) {
    assert.equal(checkWalks({ walks: { [K]: { doors: [], audio: bad } } }).problems.length, 1, bad);
  }
  // Set here while someone else set the projection: both kept.
  const theirs = setProjection(emptyWalks(), K, "eac");
  const merged = walkOf(mergeWalks(emptyWalks(), w, theirs), K)!;
  assert.equal(merged.audio, SOUND);
  assert.equal(merged.projection, "eac");
});

test("an item on special: was and now, said aloud in English", () => {
  const K = "scenes/minesouta2/axman-4k-h264.mp4";
  let w = addItem(emptyWalks(), K, { label: { en: "Saw", fa: "اره" }, price: "$15.99", pins: [{ t: 3, x: 0.2, y: 0 }] });
  const id = walkOf(w, K)!.items![0].id;
  w = updateItem(w, K, id, { special: { was: "$15.99", now: "$12.99" } });
  const item = walkOf(w, K)!.items![0];
  assert.deepEqual(item.special, { was: "$15.99", now: "$12.99" });
  assert.deepEqual(parseWalks(JSON.parse(JSON.stringify(w))), w);
  assert.equal(specialSay(item), "Special! Saw. Now 12 dollars 99, was 15 dollars 99.");
  assert.equal(specialSay({ ...item, special: { was: "$6", now: "2/$5" } }), "Special! Saw. Now 2/$5, was $6.");
  assert.equal(specialSay({ ...item, special: undefined }), null, "only specials speak");
  assert.equal(walkOf(updateItem(w, K, id, { special: undefined }), K)!.items![0].special, undefined);
  assert.equal(checkWalks({ walks: { [K]: { doors: [], items: [{ id: "a", label: { en: "A" }, pins: [], special: { now: "$1" } }] } } }).problems.length, 1);
});
