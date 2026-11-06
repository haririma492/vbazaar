/**
 * A misspelt word corrected EVERYWHERE in the buckets (owner, 2026-11-06: "change all occurances of "gal(l)ery" to
 * "gallery" everywhere even as part of email address everywhere !!!"): every object key holding it, and every
 * text file (the store record, the index, walks.json, catalogues, tours…) mentioning it. Pure; imports nothing.
 */

/** The replacement in the case it replaces: lower stays lower, Capital stays Capital, UPPER stays UPPER. */
export function fixWord(text: string, from: string, to: string): string {
  if (!from) return text;
  const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return text.replace(re, (m) => {
    if (m === m.toUpperCase() && m !== m.toLowerCase()) return to.toUpperCase();
    if (m[0] === m[0].toUpperCase() && m[0] !== m[0].toLowerCase()) return to[0].toUpperCase() + to.slice(1);
    return to;
  });
}

/** A file read and rewritten as text: never a video, a picture or a sound. */
export function isTextKey(key: string): boolean {
  return /\.(json|txt|vtt|srt|csv|html?|md|xml|log)$/i.test(key);
}
