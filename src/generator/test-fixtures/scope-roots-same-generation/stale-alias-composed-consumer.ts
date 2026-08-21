/**
 * A stale opener alias inside a COMPOSED deps type — the shape whose properties reach the claim
 * parsers only through their own declarations.
 *
 * The path that made same-generation openers resolvable must not become a way for a stale one to
 * slip past: reaching the property is what lets it be JUDGED against the plan, and this one is not
 * in it.
 */
import type { IClock } from "./contracts.js";
import type { OpenRetiredServiceScope } from "./generated/ioc-registry.types.js";

/** What the composed stale-alias consumer builds. */
export interface ComposedRetiredController {
  login: (token: string) => string;
}

type ComposedRetiredBaseDeps = { retiredClock: IClock };

type ComposedRetiredControllerDeps = ComposedRetiredBaseDeps & {
  openRetiredServiceScope: OpenRetiredServiceScope;
};

export const buildComposedRetiredController = ({
  retiredClock,
  openRetiredServiceScope,
}: ComposedRetiredControllerDeps): ComposedRetiredController => ({
  login: (token: string) => {
    const { retiredService, dispose } = openRetiredServiceScope({
      requestId: token,
    });
    void dispose;
    return `${retiredClock.now()}:${retiredService.authenticate(token)}`;
  },
});
