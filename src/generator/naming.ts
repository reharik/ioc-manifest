import { awilixCamelCase } from "../core/resolver.js";

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
