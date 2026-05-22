import type { ValidateContext, ValidationIssue } from "../types.js";

export const checkExternalsSatisfaction = (
  ctx: ValidateContext,
): ValidationIssue[] => {
  const supplierKeys = new Set<string>();
  for (const slice of ctx.slices) {
    for (const key of slice.cradleKeys) {
      supplierKeys.add(key);
    }
  }

  const issues: ValidationIssue[] = [];

  for (const slice of ctx.slices) {
    for (const [externalKey, { typeText }] of Object.entries(slice.externals)) {
      if (supplierKeys.has(externalKey)) {
        continue;
      }

      issues.push({
        category: "externals",
        severity: "error",
        summary: `Unsatisfied external: ${slice.packageLabel} demands ${JSON.stringify(externalKey)} (type: ${typeText})`,
        details: [
          "No manifest in composedManifests supplies this key in IocGeneratedCradle.",
        ],
        suggestedFix:
          `Register a factory for ${typeText} under key ${JSON.stringify(externalKey)} in this app, or compose another manifest that supplies it.`,
      });
    }
  }

  return issues;
};
