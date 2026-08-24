/**
 * The near neighbour that must KEEP working. `Router` here is a declaration in a file of this
 * project that happens to also be the default export — the contract site names it directly, with no
 * import clause between, so identity resolves to the real name `Router` and emission already knows
 * to reach it with `import type Router from "…"`. Refusing this too would be refusing the fix.
 */
export default class Router {
  use(_path: string): this {
    return this;
  }
}

export const buildLocalRouter = (): Router => new Router();
