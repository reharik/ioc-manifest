/**
 * @fileoverview Manifest schema version shared by codegen emission and runtime composition.
 * Bump only with a deliberate compatibility story (see docs/design/per-package-manifest.md §14.2).
 */
export const MANIFEST_SCHEMA_VERSION = 1 as const;

export type ManifestSchemaVersion = typeof MANIFEST_SCHEMA_VERSION;
