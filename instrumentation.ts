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
  }
}
