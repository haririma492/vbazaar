/**
 * When the server starts: the Store Builder crew picks up where it stopped
 * (a step that was working when the last server went away runs again —
 * `lib/stores/crew.ts`). A short wait lets the server finish starting first.
 * Next compiles this for the edge too; the check keeps the crew out of that build.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { kick } = await import("./lib/stores/crew");
    setTimeout(() => kick(), 15_000);
    // The Shadow agent carries on a walk a restart cut off (`lib/stores/reflect.ts`).
    const { resumeShadowAgent } = await import("./lib/stores/reflect");
    setTimeout(() => void resumeShadowAgent().catch((e) => console.error("[shadow] resume", e)), 20_000);
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
    // Walks still waiting for their reversed copy (`lib/stores/reverse.ts`).
    const { drainReverse } = await import("./lib/stores/reverse");
    setTimeout(() => void drainReverse().catch((e) => console.error("[reverse] resume", e)), 30_000);
  }
}
