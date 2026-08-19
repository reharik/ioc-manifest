import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type { IRouter } from "./contracts.js";

/**
 * `ScopeRoot` with one type argument: the declared late-bound-value set is missing. Discovery
 * treats this as a hard error, never a silent skip — the declaration is the one thing the tool
 * refuses to infer.
 *
 * The annotation is intentionally ill-formed (tsc also rejects it), which is why the body is cast:
 * discovery reads the annotation syntactically and never type-checks or executes this file.
 */
export const buildBrokenRouter = (): ScopeRoot<IRouter> =>
  ({ handle: (p: string) => p }) as never;
