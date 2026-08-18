/**
 * @fileoverview Package-relative form of a type declaration file path (schema v3).
 *
 * Group base-type identifiers used to embed the absolute path of the declaring file, which made
 * every generated manifest machine-specific: two developers regenerating the same package produced
 * different committed output, and any diamond-hoisted dependency produced a *third* value, which is
 * the reason `groupBaseTypeAliases` had to exist as an escape hatch at all.
 *
 * The package-relative form is `<packageName>/<path within that package>`: the name from the
 * nearest enclosing `package.json`, plus the POSIX path from that manifest's directory to the
 * declaration file. It is identical on every machine and unambiguous across packages, including
 * two packages that declare the same type name at the same inner path.
 *
 * What it deliberately does NOT collapse: the same logical type reached through different package
 * layouts (`@acme/contracts/src/Storage.ts` from a workspace source build vs.
 * `@acme/contracts/dist/Storage.d.ts` from a published one). Those remain distinct ids, and
 * `groupBaseTypeAliases` remains the way to declare them equivalent — the escape hatch is narrower
 * now, not gone.
 */
import fs from "node:fs";
import path from "node:path";

/** dir → package name (or null when that dir holds no named `package.json`). */
const packageNameByDir = new Map<string, string | null>();

const readPackageName = (dir: string): string | null => {
  const cached = packageNameByDir.get(dir);
  if (cached !== undefined) {
    return cached;
  }

  let name: string | null = null;
  try {
    const raw = fs.readFileSync(path.join(dir, "package.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { name?: unknown }).name === "string" &&
      (parsed as { name: string }).name.length > 0
    ) {
      name = (parsed as { name: string }).name;
    }
  } catch {
    name = null;
  }

  packageNameByDir.set(dir, name);
  return name;
};

const toPosix = (value: string): string => value.replace(/\\/g, "/");

export type OwningPackage = {
  readonly packageName: string;
  readonly packageRoot: string;
};

/** Nearest ancestor directory holding a `package.json` with a non-empty `name`. */
export const findOwningPackage = (
  absFile: string,
): OwningPackage | undefined => {
  let dir = path.dirname(path.resolve(absFile));

  for (;;) {
    const name = readPackageName(dir);
    if (name !== null) {
      return { packageName: name, packageRoot: dir };
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
};

/**
 * `<packageName>/<posix path within the package>` for a declaration file.
 *
 * Falls back to the POSIX absolute path when the file has no enclosing named `package.json` — a
 * case that cannot arise for a file TypeScript resolved from a real project, kept only so the
 * function is total.
 */
export const packageRelativeDeclarationPath = (absFile: string): string => {
  const resolved = path.resolve(absFile);
  const owner = findOwningPackage(resolved);
  if (owner === undefined) {
    return toPosix(resolved);
  }

  const within = toPosix(path.relative(owner.packageRoot, resolved));
  if (within.length === 0 || within.startsWith("..")) {
    return toPosix(resolved);
  }

  return `${owner.packageName}/${within}`;
};

/** Test seam: drops the `package.json` lookup cache. */
export const clearPackageRelativePathCache = (): void => {
  packageNameByDir.clear();
};
