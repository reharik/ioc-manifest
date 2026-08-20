import { awilixCamelCase } from "../core/resolver.js";
import type { DiscoveredScopeRoot } from "./types.js";

/**
 * The contract's access key — the cradle property its elected default is reachable under.
 * `MediaStorage` → `mediaStorage`; `APIClient` → `apiClient`.
 *
 * Same {@link awilixCamelCase} rule the two unit kinds use for their registration keys, and for
 * the same reason: convention default election matches an implementation key against this key, so
 * a contract and an implementation that camelCase differently would never convention-match and
 * would emit two cradle spellings of one acronym.
 */
export const contractNameToDefaultRegistrationKey = (
  contractName: string,
): string => awilixCamelCase(contractName);

/**
 * Group access keys are camelCase; the exported per-group type alias is the same key
 * with an uppercased first letter (`channels` → `Channels`).
 */
export const groupKeyToTypeAliasName = (key: string): string =>
  key.length === 0 ? key : key.charAt(0).toUpperCase() + key.slice(1);

/**
 * Cradle key of a scope-root variant's emitted opener: `authRouter` → `openAuthRouterScope`.
 *
 * Derived from the VARIANT identity (which is the factory identity — never a type parameter) with
 * the same {@link awilixCamelCase} rule every other key in the library uses, so an acronym variant
 * spells the same way here as it does in the cradle (`apiRouter` → `openApiRouterScope`).
 */
export const variantNameToOpenerKey = (variantName: string): string =>
  awilixCamelCase(`open_${variantName}_scope`);

/**
 * The exported type alias for an opener: the opener key with an uppercased first letter
 * (`openAuthRouterScope` → `OpenAuthRouterScope`), matching the group-alias rule.
 */
export const openerKeyToTypeAliasName = (openerKey: string): string =>
  groupKeyToTypeAliasName(openerKey);

/**
 * The opener cradle keys THIS generation will emit, one per discovered variant.
 *
 * Derived from the variant identities alone, through {@link variantNameToOpenerKey} — the same rule
 * `buildScopeRootOpeners` uses — so the demand walk (which runs before openers are planned) reads
 * the same key set the emitter will write, with no ordering hazard and nothing to drift.
 */
export const openerKeysForScopeRoots = (
  scopeRoots: readonly DiscoveredScopeRoot[] | undefined,
): string[] =>
  (scopeRoots ?? []).map((variant) => variantNameToOpenerKey(variant.variantName));

/**
 * Emitted opener alias name → opener cradle key, for the openers named by {@link openerKeysForScopeRoots}.
 *
 * This map IS the enumeration the `openerAliasReference` form is recognized against: a bare
 * reference to a name in it, imported from the generated registry-types file, names that opener.
 * A name outside it is not an opener reference and stays unclaimed.
 */
export const openerKeysByTypeAliasName = (
  openerKeys: readonly string[],
): Map<string, string> =>
  new Map(openerKeys.map((key) => [openerKeyToTypeAliasName(key), key]));

/**
 * True for a name shaped like an emitted opener alias (`Open…Scope`).
 *
 * Deliberately a SHAPE test and nothing more. It is used only to sharpen a rejection: a name with
 * this shape, imported from the generated registry file, that no opener of the current generation
 * claims, is almost always a reference to an opener a PREVIOUS run emitted — for which "regenerate"
 * is better advice than "demand the individual keys". It never admits a reference; only
 * {@link openerKeysByTypeAliasName} does that.
 */
export const looksLikeOpenerTypeAliasName = (name: string): boolean =>
  /^Open[A-Za-z0-9]+Scope$/.test(name);
