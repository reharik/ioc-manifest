/**
 * @fileoverview Manifest schema version shared by codegen emission and runtime composition.
 * Bump only with a deliberate compatibility story (see docs/design/per-package-manifest.md §14.2).
 *
 * v3 (ioc-manifest 3.0): adds the optional `kind: "class"` field to implementation metadata, and
 * changes group `baseTypeId` from an absolute machine path to a package-relative identifier.
 * Composition refuses v2 manifests outright — mixed-version composition was never supported, so
 * there is no cross-version reader.
 */
export const MANIFEST_SCHEMA_VERSION = 3 as const;

export type ManifestSchemaVersion = typeof MANIFEST_SCHEMA_VERSION;
