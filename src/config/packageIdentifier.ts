/**
 * Derives stable TypeScript identifiers from npm package names for app-mode codegen.
 */

const SCOPE_PATTERN = /^@[^/]+\//;

const stripScope = (packageName: string): string =>
  packageName.replace(SCOPE_PATTERN, "");

const segmentToCamelPart = (segment: string, isFirst: boolean): string => {
  if (segment.length === 0) {
    return "";
  }
  const lower = segment.toLowerCase();
  if (isFirst) {
    return lower;
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

const toCamelCaseFromSegments = (segments: readonly string[]): string => {
  const parts = segments.filter((s) => s.length > 0);
  if (parts.length === 0) {
    return "";
  }
  return parts
    .map((seg, i) => segmentToCamelPart(seg, i === 0))
    .join("");
};

const splitPackageBase = (base: string): string[] => {
  const segments: string[] = [];
  for (const part of base.split(/[-_./]+/)) {
    if (part.length > 0) {
      segments.push(part);
    }
  }
  return segments;
};

const ensureValidTsIdentifier = (candidate: string): string => {
  if (candidate.length === 0) {
    return "_package";
  }
  if (/^[a-zA-Z_][\w$]*$/.test(candidate)) {
    return candidate;
  }
  if (/^[0-9]/.test(candidate)) {
    return `_${candidate}`;
  }
  return candidate.replace(/[^\w$]/g, "_");
};

/**
 * Converts a package name to a camelCase identifier (scope stripped).
 * `@packages/media-core` → `mediaCore`
 */
export const packageNameToIdentifier = (packageName: string): string => {
  const base = stripScope(packageName);
  const segments = splitPackageBase(base);
  const camel = toCamelCaseFromSegments(segments);
  return ensureValidTsIdentifier(camel);
};

export type PackageIdentifierCollision = {
  readonly identifier: string;
  readonly packages: readonly string[];
};

/**
 * Detects duplicate identifiers across package names. `local` is reserved for the app package.
 */
export const LOCAL_PACKAGE_IDENTIFIER = "local";

export const findPackageIdentifierCollisions = (
  packageNames: readonly string[],
): readonly PackageIdentifierCollision[] => {
  const byId = new Map<string, string[]>();

  for (const pkg of packageNames) {
    const id = packageNameToIdentifier(pkg);
    const list = byId.get(id) ?? [];
    list.push(pkg);
    byId.set(id, list);
  }

  const collisions: PackageIdentifierCollision[] = [];
  for (const [identifier, packages] of byId) {
    if (packages.length > 1) {
      collisions.push({ identifier, packages });
      continue;
    }
    if (identifier === LOCAL_PACKAGE_IDENTIFIER) {
      collisions.push({ identifier, packages });
    }
  }

  return collisions;
};

export const formatPackageIdentifierCollisionError = (
  sourceLabel: string,
  collision: PackageIdentifierCollision,
): string => {
  const pkgList = collision.packages
    .filter((p) => !p.startsWith("(reserved"))
    .map((p) => JSON.stringify(p))
    .join(" and ");
  return `[ioc-config] ${sourceLabel} composedManifests produce duplicate package identifiers: ${JSON.stringify(collision.identifier)} from ${pkgList}`;
};
