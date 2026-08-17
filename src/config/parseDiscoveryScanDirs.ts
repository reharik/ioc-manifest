import type { IocScanDirSpec } from "./iocConfig.js";
import { collectDiscoveryScanDirsIssues } from "./iocConfigSchema.js";

const renderRelativePath = (path: readonly (string | number)[]): string =>
  path.map((seg) => (typeof seg === "number" ? `[${seg}]` : `.${seg}`)).join("");

/**
 * Validates and normalizes authoring `scanDirs` into a list of specs (single string → one spec).
 * Validation is shared with the config schema via {@link collectDiscoveryScanDirsIssues}.
 */
export const parseDiscoveryScanDirs = (
  raw: unknown,
  sourceLabel: string,
): IocScanDirSpec[] => {
  const issues = collectDiscoveryScanDirsIssues(raw);
  if (issues.length > 0) {
    throw new Error(
      issues
        .map((issue) =>
          issue.standalone === true
            ? `[ioc-config] ${sourceLabel} ${issue.message}`
            : `[ioc-config] ${sourceLabel} discovery.scanDirs${renderRelativePath(issue.path)} ${issue.message}`,
        )
        .join("\n"),
    );
  }

  if (typeof raw === "string") {
    return [{ path: raw }];
  }

  return (raw as (string | IocScanDirSpec)[]).map((el) =>
    typeof el === "string"
      ? { path: el }
      : {
          path: el.path,
          ...(el.scope !== undefined ? { scope: el.scope } : {}),
        },
  );
};
