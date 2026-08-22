/**
 * @fileoverview The `Named<T>` marker type: a deps property that demands one SPECIFIC
 * implementation rather than its contract's elected default.
 *
 * A deps property is one of exactly five declared things (see `docs/design/per-package-manifest.md`
 * §4.6). Two of them are spelled with a contract type, and before this marker they were spelled
 * IDENTICALLY:
 *
 * ```ts
 * type Deps = {
 *   authMiddleware: AuthMiddleware;         // the contract's elected default
 *   strictAuthMiddleware: AuthMiddleware;   // …that specific implementation? nothing said so
 * };
 * ```
 *
 * The second line was a bare implementation-key demand: legal only because the key happened to be
 * registered, and indistinguishable at the site from a typo, from an external, and from the first
 * line. `Named<T>` is the declaration that was missing — it says "this property names an
 * implementation, and its contract is `T`" — and with it in the language, the bare spelling becomes
 * a hard error rather than an accident that works.
 *
 * The marker is **transparent to TypeScript**: `Named<T>` IS `T`, so annotating with it changes
 * nothing about assignability, inference, or what the factory receives. It exists for the
 * generator, which reads it syntactically off the written annotation — by written name, with no
 * checker involvement, exactly as `Promise<T>` and `ScopeRoot<TContract, TLbv>` are read. The same
 * trade applies: a locally-declared `Named` shadows this one, which is consistent with v3's rule
 * that identity is what the author wrote.
 */

/**
 * Declares that a deps property names a specific implementation registration key whose contract is
 * `T`, rather than `T`'s elected default.
 *
 * @typeParam T - the contract the named implementation implements. Checked by the generator for
 *                EXACT identity against the implementation's own declared contract — not
 *                assignability, so a supertype does not satisfy it.
 *
 * @example
 * ```ts
 * import type { Named } from "ioc-manifest";
 *
 * type RequestPipelineDeps = {
 *   // The elected default of AuthMiddleware, whichever implementation that is.
 *   authMiddleware: AuthMiddleware;
 *   // The implementation registered as `strictAuthMiddleware`, whatever is elected.
 *   strictAuthMiddleware: Named<AuthMiddleware>;
 * };
 * ```
 */
export type Named<T> = T;
