// vbazaar.app/<store> — the link's preview card (owner, 2026-11-23: "make this link to show the front door of the
// pastry store + the name rendered on the link"). When the address is shared (WhatsApp, Instagram, Facebook, Slack…)
// the card shows the store's FRONT DOOR photo with its name, English and Farsi, rendered on it. The photo is the
// walk's `doorPhoto` (else the door's own picture, else the store's door upload); with none, a plain card with the
// name. Not indexed (the page is noindex). Read live each time: a new door photo shows without a redeploy.
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { readStore } from "@/lib/stores/bucket";
import { readWalks } from "@/lib/splats/r2";
import { doorPhotoOf } from "@/lib/splats/walks";
import { SLUG_RE } from "@/lib/stores/store";
import { RESERVED_SLUGS } from "@/lib/stores/productLink";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Virtual Bazaar store";

/** Farsi and Latin glyphs: Vazirmatn (SIL OFL 1.1, `app/fonts/Vazirmatn-OFL.txt`). */
async function nameFont(): Promise<ArrayBuffer | null> {
  try {
    const bytes = await readFile(path.join(process.cwd(), "app/fonts/Vazirmatn-Bold.ttf"));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

/** The photo as a data address, so the image renders from the server's own copy (no browser CORS on the picture). */
async function photoData(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const type = r.headers.get("content-type") || "image/jpeg";
    if (!type.startsWith("image/")) return null;
    const b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
    return `data:${type};base64,${b64}`;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: { store: string } }) {
  const slug = decodeURIComponent(params.store).toLowerCase();
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) notFound();
  const s = await readStore(slug).catch(() => null);
  if (!s?.out.walk) notFound();

  const walks = await readWalks().catch(() => null);
  const door = await photoData(walks ? doorPhotoOf(walks, s.out.walk) : undefined)
    ?? await photoData(s.out.doorImage);

  const en = s.name.en || "";
  const fa = s.name.fa || "";
  const font = await nameFont();
  const fonts = font ? [{ name: "Vazirmatn", data: font, weight: 700 as const, style: "normal" as const }] : [];

  return new ImageResponse(
    (
      <div style={{ display: "flex", position: "relative", width: "100%", height: "100%", background: "#1c1610", fontFamily: font ? "Vazirmatn" : "sans-serif" }}>
        {door && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={door} width={1200} height={630} style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, objectFit: "cover" }} />
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "40px 60px 44px",
            background: door ? "linear-gradient(to top, rgba(20,14,8,0.92) 0%, rgba(20,14,8,0.72) 55%, rgba(20,14,8,0) 100%)" : "#1c1610",
            color: "#fbf6ea",
          }}
        >
          {fa && <div style={{ display: "flex", fontSize: 92, fontWeight: 700, lineHeight: 1.15 }}>{fa}</div>}
          {en && <div style={{ display: "flex", fontSize: 50, fontWeight: 700, marginTop: 6, color: "#e9d9b5" }}>{en}</div>}
          <div style={{ display: "flex", fontSize: 26, marginTop: 18, color: "#c9b48a" }}>vbazaar.app · بازار مجازی</div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
