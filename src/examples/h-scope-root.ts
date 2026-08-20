/**
 * Lesson h — scope roots, their openers, and what divergence between variants means.
 *
 * `ScopeRoot<TContract, TLbv>` at the return annotation declares a request-/work-scoped boundary:
 * `TContract` is what is resolved FROM the scope once it is open, `TLbv` is the set of late-bound
 * values that enter AT the boundary. The lbv set is declared, never derived from the subtree — the
 * generator's job is to verify the declaration against what the subtree resolves, not to infer it.
 *
 * Generation emits one **opener** per variant, registered in the cradle under its own key:
 *
 * ```ts
 * const { requestReport, dispose } = openRequestReportScope({ viewer: { id: "u_1" } });
 * try {
 *   requestReport.render();
 * } finally {
 *   await dispose();
 * }
 * ```
 *
 * Two variants of one root contract are two boundaries into it, not two implementations competing
 * for a default slot — so `RequestReport` claims no cradle key and elects no default. A
 * scope-rooted contract is opener-only.
 *
 * The two variants below diverge on `viewer`, deliberately, and that divergence is what decides
 * whether the key is an external:
 *
 * - `requestReport` DECLARES it, so its opening sites supply a fresh viewer per open;
 * - `publicReport` does not, so it resolves whatever the container holds, through the parent chain.
 *
 * Because some variant consumes it from the container, the container must be asked to have one:
 * `viewer` stays in `IocExternals` and the composing app registers it. Had every variant that
 * touches `viewer` declared it, the declaration would speak for itself and the key would be
 * excluded from `IocExternals` — the config would never have to repeat what a variant already said.
 */
import type { ScopeRoot } from "../scopeRoots/scopeRoot.js";
import type { MediaStorage } from "./b-multiple-implementations.js";

/** The contract resolved from an opened report scope. */
export type RequestReport = {
  render: () => string;
};

/** Late-bound for one variant, a container constant for the other. */
export type Viewer = {
  id: string;
};

type RequestReportDeps = {
  /** Container-supplied: resolved through the parent chain, so it is not a late-bound value. */
  mediaStorage: MediaStorage;
  /** Supplied at every opening, which is exactly what the declaration below says. */
  viewer: Viewer;
};

/** Variant one: an authenticated boundary that carries its own viewer. */
export const buildRequestReport = ({
  mediaStorage,
  viewer,
}: RequestReportDeps): ScopeRoot<RequestReport, { viewer: Viewer }> => {
  return {
    render: () => `report for ${viewer.id} backed by ${mediaStorage.label}`,
  };
};

type PublicReportDeps = {
  /** Not declared below: this boundary inherits the container's viewer rather than carrying one. */
  viewer: Viewer;
};

/** Variant two: a public boundary with an empty lbv set. Same contract, different scope. */
export const buildPublicReport = ({
  viewer,
}: PublicReportDeps): ScopeRoot<RequestReport, Record<string, never>> => {
  return {
    render: () => `public report for ${viewer.id}`,
  };
};
