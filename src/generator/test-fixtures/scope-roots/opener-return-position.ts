/**
 * REJECTED: an opener alias in a RETURN position.
 *
 * The deps sanction is exactly that — a deps sanction. A contract site feeds the cradle's supply
 * type and is read member-by-member to build it, so a generated type there is resolved out of prior
 * output no matter which generated type it is. The opener's own cradle entry is written by emission;
 * nothing may re-supply it from a factory.
 */
import type { OpenConsumedRouterScope } from "./generated/ioc-registry.types.js";

export const buildReturnedOpener = (): OpenConsumedRouterScope => (lbv) => ({
  consumedRouter: { handle: (path: string) => `${lbv.requestId}:${path}` },
  dispose: async () => {},
});
