/**
 * Bundle membership by assignability to a named TypeScript interface/type alias.
 *
 * Matching uses the compiler's assignability rules (structural under the hood). Prefer a dedicated
 * contract-style interface as `baseInterface`; overly wide types (e.g. `{}`) could match unintended
 * contracts.
 *
 * Zero matches: expansion yields an empty bundle array (same as `read: []`). Assignability is
 * checked per discovered contract type: a base with the same name as a contract still matches that
 * contract. For a filter that matches nothing, use a dedicated base type that no factory return
 * type implements.
 */

/** Object form (primary API). */
export type IocBundleDiscoveryByBase = {
  baseInterface: string;
};

/** `{ baseInterface }` or shorthand string. */
export type IocBundleDiscoverySpec = IocBundleDiscoveryByBase | string;

/** Leaf node resolved at plan time to concrete contract names. */
export type IocBundleDiscoverMarker = {
  $discover: IocBundleDiscoverySpec;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isBundleDiscoverLeaf = (value: unknown): value is IocBundleDiscoverMarker => {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "$discover";
};

/** Config-time validation only (no TypeScript program). */
export const isValidDiscoverSpecValue = (value: unknown): boolean => {
  if (typeof value === "string") {
    return value.length > 0;
  }
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "baseInterface") {
    return false;
  }
  const base = value.baseInterface;
  return typeof base === "string" && base.length > 0;
};

export const parseDiscoverBaseInterface = (
  spec: unknown,
):
  | { ok: true; baseInterface: string }
  | { ok: false; message: string } => {
  if (typeof spec === "string") {
    if (spec.length === 0) {
      return { ok: false, message: "$discover shorthand must be a non-empty string" };
    }
    return { ok: true, baseInterface: spec };
  }
  if (!isRecord(spec)) {
    return { ok: false, message: "$discover value must be a string or { baseInterface: string }" };
  }
  const keys = Object.keys(spec);
  if (keys.length !== 1 || keys[0] !== "baseInterface") {
    return {
      ok: false,
      message:
        '$discover object form must be exactly { baseInterface: "TypeName" } (no other properties)',
    };
  }
  const base = spec.baseInterface;
  if (typeof base !== "string" || base.length === 0) {
    return { ok: false, message: "baseInterface must be a non-empty string" };
  }
  return { ok: true, baseInterface: base };
};
