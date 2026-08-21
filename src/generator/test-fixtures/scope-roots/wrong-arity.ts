import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type { IRouter } from "./contracts.js";

/**
 * `ScopeRoot` with three type arguments: more than the marker has. Discovery treats this as a hard
 * error, never a silent skip — writing the marker at all is an unambiguous attempt to declare a
 * scope root, so an unreadable declaration is demanded rather than worked around.
 *
 * One argument is NOT this case: the lbv argument may be omitted, and the marker's own default
 * declares what that means (the empty set) — see `empty-lbv-arity-one.ts`.
 *
 * The annotation is intentionally ill-formed (tsc also rejects it), which is why the body is cast:
 * discovery reads the annotation syntactically and never type-checks or executes this file.
 */
export const buildBrokenRouter = (): ScopeRoot<
  IRouter,
  { viewerId: string },
  string
> => ({ handle: (p: string) => p }) as never;
