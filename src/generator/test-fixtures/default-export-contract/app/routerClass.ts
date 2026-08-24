/**
 * The same breach at the other contract site. A class unit's contract is its `implements` entry, and
 * it resolves through the same path — so the refusal has to reach it too, or the rule holds for
 * factories only.
 */
import Router from "@vendor/router";

export class AppRouterImpl implements Router {
  use(_path: string): this {
    return this;
  }

  routes(): (ctx: unknown) => void {
    return () => {};
  }
}
