import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText, codeOf, e164, isConvId, mayText, outgoingText, readReply, TEXT_LIMIT } from "./textRules.ts";

test("e164: North American numbers become +1…", () => {
  assert.equal(e164("647-219-6606"), "+16472196606");
  assert.equal(e164("(416) 569 6780"), "+14165696780");
  assert.equal(e164("1 416 569 6780"), "+14165696780");
  assert.equal(e164("+44 20 7946 0958"), "+442079460958");
  assert.equal(e164("12345"), null);
  assert.equal(e164(""), null);
});

test("codeOf: four letters, the same for the same conversation", () => {
  const c = codeOf("abc123def456");
  assert.match(c, /^[A-Z]{4}$/);
  assert.equal(codeOf("abc123def456"), c);
  assert.notEqual(codeOf("abc123def457"), c);
  assert.ok(isConvId("abc123def456"));
  assert.ok(!isConvId("short"));
});

test("readReply: a #CODE picks the conversation", () => {
  assert.deepEqual(readReply("#abcd Yes we have it"), { code: "ABCD", text: "Yes we have it" });
  assert.deepEqual(readReply("  #WXYZ: 12 dollars"), { code: "WXYZ", text: "12 dollars" });
  assert.deepEqual(readReply("Yes, open till 9"), { code: null, text: "Yes, open till 9" });
  assert.ok(outgoingText("Nuttime", "abc123def456", "hi").includes(`#${codeOf("abc123def456")}`));
});

test("cleanText and mayText", () => {
  assert.deepEqual(cleanText("  hello   there "), { text: "hello there" });
  assert.ok("error" in cleanText("   "));
  assert.ok("error" in cleanText("x".repeat(501)));
  const now = Date.now();
  const msgs = Array.from({ length: TEXT_LIMIT }, () => ({ from: "shopper" as const, text: "a", at: new Date(now - 1000).toISOString() }));
  assert.equal(mayText({ id: "x", slug: "s", to: "+1", messages: msgs }, now), false);
  assert.equal(mayText({ id: "x", slug: "s", to: "+1", messages: msgs.slice(1) }, now), true);
  assert.equal(mayText(null, now), true);
});
