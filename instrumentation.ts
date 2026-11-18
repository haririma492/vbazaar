/**
 * When the server starts: the Store Builder crew picks up where it stopped
 * (a step that was working when the last server went away runs again —
 * `lib/stores/crew.ts`). A short wait lets the server finish starting first.
 * Next compiles this for the edge too; the check keeps the crew out of that build.
 */
export async function register() {
  // The demo without internet (OFFLINE_DIR, `lib/splats/offline.ts`): nothing below can reach R2, so none of it
  // starts; the server only shows the folder.
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.OFFLINE_DIR) {
    const { kick } = await import("./lib/stores/crew");
    setTimeout(() => kick(), 15_000);
    // The Shadow agent carries on a walk a restart cut off (`lib/stores/reflect.ts`).
    const { resumeShadowAgent } = await import("./lib/stores/reflect");
    setTimeout(() => void resumeShadowAgent().catch((e) => console.error("[shadow] resume", e)), 20_000);
    // A Tidy agent run a restart cut off carries on (`lib/stores/tidy.ts`).
    const { resumeTidy } = await import("./lib/stores/tidy");
    setTimeout(() => void resumeTidy().catch((e) => console.error("[tidy] resume", e)), 50_000);
    // Walks still waiting for their walking speed (`lib/stores/lock.ts`).
    const { drainPace } = await import("./lib/stores/lock");
    setTimeout(() => void drainPace().catch((e) => console.error("[pace] resume", e)), 25_000);
    // Walks whose products were pinned by the old, rougher follow: followed again, free (`lib/stores/repin.ts`).
    const { queueRepin, walksToRepin } = await import("./lib/stores/repin");
    setTimeout(() => void walksToRepin().then(queueRepin).catch((e) => console.error("[repin] resume", e)), 35_000);
    // Stores whose product photos are waiting to be made from several frames (the Photo improver, `crew.ts`).
    const { drainPhotos } = await import("./lib/stores/crew");
    setTimeout(() => void drainPhotos().catch((e) => console.error("[photos] resume", e)), 40_000);
    // Walks whose motion is not measured (the Route optimizer's smoothness, `lib/stores/routeJob.ts`).
    const { queueSmooth, walksToSmooth } = await import("./lib/stores/routeJob");
    setTimeout(() => void walksToSmooth().then(queueSmooth).catch((e) => console.error("[smooth] resume", e)), 45_000);
    // Every store's agents run on their own (`lib/stores/refreshAll.ts`): the queue a restart cut off, and stores
    // tagged but never refreshed (no Shelf Tour yet).
    // ⚠️ No more (owner, 2026-11-16: "Refresh all agents" is obsolete since the pastry redesign): nothing is queued
    // or carried on at start.
    // A Website Explorer read a restart cut off carries on, and its products reach the store's list (`website.ts`).
    const { resumeWebsite } = await import("./lib/stores/website");
    setTimeout(() => void resumeWebsite().catch((e) => console.error("[website] resume", e)), 55_000);
    // A shelf kit run a restart cut off (photos to put up, sections to place, products to match: `kit.ts`).
    const { resumeKits } = await import("./lib/stores/kit");
    setTimeout(() => void resumeKits().catch((e) => console.error("[kit] resume", e)), 65_000);
    // A route plan a restart cut off is planned again (`routeJob.ts`).
    const { resumeRoute } = await import("./lib/stores/routeJob");
    setTimeout(() => void resumeRoute().catch((e) => console.error("[route] resume", e)), 70_000);
    // Walks still waiting for their reversed copy (`lib/stores/reverse.ts`).
    const { drainReverse } = await import("./lib/stores/reverse");
    setTimeout(() => void drainReverse().catch((e) => console.error("[reverse] resume", e)), 30_000);
  }
}
