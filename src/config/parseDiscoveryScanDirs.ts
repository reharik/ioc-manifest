import type { IocLifetime, IocScanDirSpec } from "./iocConfig.js";

const IOC_LIFETIMES = new Set<IocLifetime>(["singleton", "scoped", "transient"]);

const isIocLifetime = (value: unknown): value is IocLifetime =>
  typeof value === "string" && IOC_LIFETIMES.has(value as IocLifetime);

/**
 * Validates and normalizes authoring `scanDirs` into a list of specs (single string → one spec).
 */
export const parseDiscoveryScanDirs = (
  raw: unknown,
  sourceLabel: string,
): IocScanDirSpec[] => {
  if (typeof raw === "string") {
    if (raw.length === 0) {
      throw new Error(
        `[ioc-config] ${sourceLabel} discovery.scanDirs must be a non-empty string when a string is used`,
      );
    }
    return [{ path: raw }];
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      `[ioc-config] ${sourceLabel} discovery.scanDirs must be a non-empty string, string[], or object[]`,
    );
  }

  const out: IocScanDirSpec[] = [];
  const allowedKeys = new Set(["path", "importPrefix", "importMode", "scope"]);

  for (let i = 0; i < raw.length; i += 1) {
    const el = raw[i];
    if (typeof el === "string") {
      if (el.length === 0) {
        throw new Error(
          `[ioc-config] ${sourceLabel} discovery.scanDirs[${i}] must be a non-empty string`,
        );
      }
      out.push({ path: el });
      continue;
    }

    if (typeof el !== "object" || el === null || Array.isArray(el)) {
      throw new Error(
        `[ioc-config] ${sourceLabel} discovery.scanDirs[${i}] must be a string or an object with path`,
      );
    }

    const rec = el as Record<string, unknown>;
    for (const k of Object.keys(rec)) {
      if (!allowedKeys.has(k)) {
        throw new Error(
          `[ioc-config] ${sourceLabel} discovery.scanDirs[${i}] has unknown property ${JSON.stringify(k)}`,
        );
      }
    }

    const p = rec.path;
    if (typeof p !== "string" || p.length === 0) {
      throw new Error(
        `[ioc-config] ${sourceLabel} discovery.scanDirs[${i}].path must be a non-empty string`,
      );
    }

    const importPrefix = rec.importPrefix;
    if (importPrefix !== undefined) {
      if (typeof importPrefix !== "string" || importPrefix.length === 0) {
        throw new Error(
          `[ioc-config] ${sourceLabel} discovery.scanDirs[${i}].importPrefix must be a non-empty string when set`,
        );
      }
    }

    const importMode = rec.importMode;

    const scopeRaw = rec.scope;

    let scope: IocLifetime | undefined;
    if (scopeRaw !== undefined) {
      if (!isIocLifetime(scopeRaw)) {
        throw new Error(
          `[ioc-config] ${sourceLabel} discovery.scanDirs[${i}].scope must be singleton | scoped | transient when set`,
        );
      }
      scope = scopeRaw;
    }

    if (importPrefix !== undefined) {
      if (importMode !== "root" && importMode !== "subpath") {
        throw new Error(
          `[ioc-config] ${sourceLabel} discovery.scanDirs[${i}].importMode must be "root" or "subpath" when importPrefix is set`,
        );
      }
      out.push({
        path: p,
        importPrefix,
        importMode,
        ...(scope !== undefined ? { scope } : {}),
      });
    } else {
      if (importMode === "root") {
        throw new Error(
          `[ioc-config] ${sourceLabel} discovery.scanDirs[${i}].importMode cannot be set to "root" without importPrefix`,
        );
      }
      out.push({
        path: p,
        ...(scope !== undefined ? { scope } : {}),
      });
    }
  }

  return out;
};
