/**
 * @fileoverview Generation-time error for configured groups that resolve to zero members. An empty
 * group is never a correct emission: the cradle entry types as `ReadonlyArray<never>` (collection)
 * or an empty object, generation "succeeds", and the container boots into a no-op — nothing warns
 * until the runtime silently does no work. The usual cause is a discovery failure upstream (no
 * factory return type nominally extends the base, or the factories were skipped entirely), so
 * codegen fails loud here instead of emitting a manifest with a hollow group.
 *
 * Two legitimate empty-group shapes are exempt:
 * - app mode, when the group key also appears in a composed package's manifest — its members
 *   arrive at runtime via `composeManifests` group-root merging, so a locally-empty root is fine;
 * - an explicit `groups.<name>.allowEmpty: true` opt-in in ioc.config.
 */
import type { IocConfig } from "../config/iocConfig.js";
import type {
  IocGroupRootManifest,
  IocGroupsManifest,
} from "../core/manifest.js";

const isEmptyGroupRoot = (root: IocGroupRootManifest): boolean =>
  Array.isArray(root.members)
    ? root.members.length === 0
    : Object.keys(root.members).length === 0;

const formatEmptyGroupError = (
  groupKey: string,
  root: IocGroupRootManifest,
): string =>
  `[ioc] Group ${JSON.stringify(groupKey)} (baseType ${JSON.stringify(root.baseType)}, kind ${JSON.stringify(root.kind)}) resolved to zero members. ` +
  `An empty ${root.kind === "collection" ? "collection group emits ReadonlyArray<never>" : "object group emits an empty object"} in the cradle and the container boots into a no-op. ` +
  `Likely causes, most frequent first: ` +
  `(1) no discovered factory returns a type nominally extending ${JSON.stringify(root.baseType)}; ` +
  `(2) a factory does, but its return annotation is a bare union — unions have no extends heritage for assignability to walk, so its members never match; give each implementation its own contract interface extending its union arm; ` +
  `(3) the base type name is misspelled in ioc.config. ` +
  `Run \`ioc --discovery\` for the per-export skip list. ` +
  `If zero members is genuinely intended, set groups.${JSON.stringify(groupKey)}.allowEmpty: true in ioc.config.`;

/**
 * Throws (never warns) for each group root in the generated manifest whose `members` is empty —
 * `[]` for `kind: "collection"`, `{}` for `kind: "object"` — aggregating all offenders into one
 * error.
 *
 * Skipped when the emptiness is legitimate:
 * - `groups.<name>.allowEmpty: true` (the dedicated suppression), or
 * - the group key appears in `composedGroupNames` (app mode: the group root exists in a composed
 *   package manifest, so members merge in at runtime via `composeManifests`).
 */
export const validateNonEmptyGroupsAtCodegen = (
  groupsManifest: IocGroupsManifest | undefined,
  config: IocConfig | undefined,
  composedGroupNames?: ReadonlySet<string>,
): void => {
  if (groupsManifest === undefined) {
    return;
  }

  const errors: string[] = [];

  for (const [groupKey, root] of Object.entries(groupsManifest)) {
    if (!isEmptyGroupRoot(root)) {
      continue;
    }
    if (config?.groups?.[groupKey]?.allowEmpty === true) {
      continue;
    }
    if (composedGroupNames?.has(groupKey) === true) {
      continue;
    }

    errors.push(formatEmptyGroupError(groupKey, root));
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n\n"));
  }
};
