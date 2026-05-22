import { MANIFEST_SCHEMA_VERSION } from "../../schemaVersion.js";
import type { ValidateContext, ValidationIssue } from "../types.js";

export const checkSchemaVersions = (ctx: ValidateContext): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  for (const slice of ctx.slices) {
    if (slice.manifestSchemaVersion === MANIFEST_SCHEMA_VERSION) {
      continue;
    }

    issues.push({
      category: "schema-version",
      severity: "error",
      summary: `${slice.packageLabel} declares manifestSchemaVersion ${String(slice.manifestSchemaVersion)} (runtime expects ${MANIFEST_SCHEMA_VERSION})`,
      details: [
        `Manifest: ${slice.manifestPath}`,
        "This usually means the package was built against an incompatible version of ioc-manifest.",
      ],
      suggestedFix:
        "Regenerate manifests with the same ioc-manifest version as this app, then re-run `ioc validate`.",
    });
  }

  return issues;
};
