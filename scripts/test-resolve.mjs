// `npm test` runs lib/**/*.test.ts with Node's own TypeScript (strip types).
// Node needs an import's file ending; the app's code (built by Next) writes
// imports without one. This lets a tested module import another as the app does.
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    try { return await next(spec, ctx); } catch (e) {
      if (!/^\\.{1,2}\\//.test(spec) || /\\.[cm]?[jt]s$/.test(spec)) throw e;
      return next(spec + ".ts", ctx);
    }
  }
`));
