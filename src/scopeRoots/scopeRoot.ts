/**
 * @fileoverview The `ScopeRoot` marker type: the declared site of a scope-root registration unit.
 *
 * A scope root is a request-/work-scoped boundary. `TContract` is the contract resolved *from* the
 * scope once it is open (an `IRouter`, a worker entry point); `TLbv` is the developer-declared set
 * of late-bound values that enter at the boundary (`{ viewerId: ViewerId; uow: UnitOfWork }`).
 *
 * **The lbv set is declared, never derived.** The tool's role is to verify the declaration against
 * the subtree, not to synthesize it from one — see `docs/design/scope-roots.md`.
 *
 * `TLbv` defaults to the EMPTY set, so `ScopeRoot<IRouter>` declares a boundary that carries no
 * late-bound values at all. That is not an inference: omitting the argument states the empty set as
 * definitely as writing `Record<string, never>` does, and the two spellings mean the same thing
 * everywhere downstream — same verification, same reports, same emitted opener.
 *
 * The marker is phantom: `TContract` intersected with a single optional property that is never
 * populated, so a factory that builds the contract returns it unchanged and the annotation still
 * type-checks. Nothing here exists at runtime, and the generator never loads this module — it
 * recognizes `ScopeRoot` at a contract site by written name, syntactically, exactly as it
 * recognizes `Promise<T>`.
 */

/**
 * Marks a factory's return annotation as a scope root.
 *
 * @typeParam TContract - the root contract resolved from the scope.
 * @typeParam TLbv - the declared late-bound values supplied when the scope is opened; omit it to
 *                   declare a boundary with none, whose opener takes no argument.
 *
 * @example
 * ```ts
 * export const buildAuthRouter = (
 *   deps: AuthRouterDeps,
 * ): ScopeRoot<IRouter, { viewerId: ViewerId; uow: UnitOfWork }> => makeRouter(deps);
 *
 * // A boundary that carries nothing in: `openPublicRouterScope()` takes no argument.
 * export const buildPublicRouter = (
 *   deps: PublicRouterDeps,
 * ): ScopeRoot<IRouter> => makeRouter(deps);
 * ```
 */
export type ScopeRoot<
  TContract,
  TLbv extends object = Record<string, never>,
> = TContract & {
  /**
   * Phantom carrier for the declared lbv set. Optional and never assigned: it exists only so that
   * `ScopeRoot<C, A>` and `ScopeRoot<C, B>` are distinct types, and so that a plain `C` remains
   * assignable to either.
   */
  readonly "~iocScopeRootLbv"?: TLbv;
};
