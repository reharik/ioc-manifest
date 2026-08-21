/**
 * The other side of the same coin: an opener-shaped alias that NO scope root of this generation
 * produces — the shape left behind when a `ScopeRoot` annotation is removed and the consumer's
 * import is not.
 *
 * Indistinguishable from the same-generation case by import target alone (both name a file that
 * does not export the name), so the plan is what separates them: `openRetiredServiceScope` is in no
 * variant's opener set, and the stale-output rejection must still fire.
 */
import type { OpenRetiredServiceScope } from "./generated/ioc-registry.types.js";

/** What the stale-alias consumer builds. */
export interface RetiredController {
  login: (token: string) => string;
}

type RetiredControllerDeps = {
  openRetiredServiceScope: OpenRetiredServiceScope;
};

export const buildRetiredController = ({
  openRetiredServiceScope,
}: RetiredControllerDeps): RetiredController => ({
  login: (token: string) => {
    const { retiredService, dispose } = openRetiredServiceScope({
      requestId: token,
    });
    void dispose;
    return retiredService.authenticate(token);
  },
});
