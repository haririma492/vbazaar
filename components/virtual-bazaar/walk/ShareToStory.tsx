"use client";

/**
 * «SHARE TO STORY» (owner, 2026-11-06: the Instagram pathway). A shopper in a store's walk shares where they are: the
 * view on screen becomes a 9:16 picture (1080 × 1920) with the store's name and «vbazaar.app», handed to the phone's
 * share sheet, where Instagram (Story, a DM) is one tap away. The link (the walk, or the product whose card is open)
 * is copied first, so it can be pasted into Instagram's link sticker. Where the device cannot share a picture, it is
 * saved instead. Every visitor's share shows the store to their own followers.
 */

import { useState } from "react";

const W = 1080, H = 1920;

async function blobToImage(b: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(b);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** The view, the store's name and the bazaar's address on one 9:16 picture. */
async function storyCard(view: Blob, title: { en: string; fa?: string }): Promise<Blob | null> {
  const img = await blobToImage(view);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  if (!g) return null;
  // Behind: the same view, filling the frame, blurred and darkened.
  const cover = Math.max(W / img.width, H / img.height);
  g.filter = "blur(40px) brightness(0.45)";
  g.drawImage(img, (W - img.width * cover) / 2, (H - img.height * cover) / 2, img.width * cover, img.height * cover);
  g.filter = "none";
  // In front: the view itself, as large as fits between the words, with rounded corners.
  const box = { x: 60, y: 330, w: W - 120, h: H - 330 - 380 };
  const fit = Math.min(box.w / img.width, box.h / img.height, Infinity);
  const dw = img.width * fit, dh = img.height * fit;
  const dx = (W - dw) / 2, dy = box.y + (box.h - dh) / 2;
  g.save();
  g.beginPath();
  g.roundRect(dx, dy, dw, dh, 36);
  g.clip();
  g.drawImage(img, dx, dy, dw, dh);
  g.restore();
  g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = 3;
  g.beginPath(); g.roundRect(dx, dy, dw, dh, 36); g.stroke();
  // Words.
  g.fillStyle = "#FFF9EE";
  g.textAlign = "center";
  g.font = "600 44px system-ui, -apple-system, Segoe UI, sans-serif";
  g.fillText("I'm walking in", W / 2, 150);
  g.font = "800 76px system-ui, -apple-system, Segoe UI, sans-serif";
  g.fillText(title.en.slice(0, 26), W / 2, 240, W - 120);
  if (title.fa) {
    g.direction = "rtl";
    g.font = "700 52px Vazirmatn, Tahoma, system-ui, sans-serif";
    g.fillText(title.fa.slice(0, 30), W / 2, H - 260, W - 120);
    g.direction = "ltr";
  }
  g.font = "700 50px system-ui, -apple-system, Segoe UI, sans-serif";
  g.fillText("Walk in too · vbazaar.app", W / 2, H - 170);
  g.font = "500 34px system-ui, -apple-system, Segoe UI, sans-serif";
  g.fillStyle = "rgba(255,249,238,0.7)";
  g.fillText("The Virtual Bazaar · بازار مجازی", W / 2, H - 110);
  return new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
}

export default function ShareToStory({ snapshot, title, link, className = "" }: {
  snapshot: () => Promise<Blob | null>;
  title: { en: string; fa?: string };
  link: () => string;
  className?: string;
}) {
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const share = async () => {
    setBusy(true); setSaid(null);
    const url = link();
    try {
      const view = await Promise.race([snapshot(), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
      if (!view) throw new Error("The view could not be captured.");
      const card = await storyCard(view, title);
      if (!card) throw new Error("The picture could not be made.");
      const file = new File([card], "vbazaar-story.jpg", { type: "image/jpeg" });
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: title.en, text: url });
        setSaid("Link copied: paste it into Instagram's link sticker.");
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file); a.download = file.name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        setSaid("Picture saved, link copied: post it as your Story and add the link sticker.");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setSaid(`Not shared: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setTimeout(() => setSaid(null), 6000);
    }
  };
  return (
    <div dir="ltr" className={`flex flex-col items-end gap-1 ${className}`}>
      <button type="button" onClick={() => void share()} disabled={busy}
        className="rounded-full border border-pink-300/70 bg-gradient-to-r from-fuchsia-500/40 to-amber-400/40 px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-50">
        {busy ? "…" : "📸 Share to Story"}
      </button>
      {said && <span className="max-w-[16rem] rounded-lg bg-black/70 px-2 py-1 text-right text-[12px] text-white/85">{said}</span>}
    </div>
  );
}
