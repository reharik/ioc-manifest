/**
 * @fileoverview Reads `IocExternals` property keys from composed packages for app-mode codegen.
 */
import fs from "node:fs";
import {
  packageNameToIdentifier,
  type PackageIdentifierCollision,
  findPackageIdentifierCollisions,
} from "../config/packageIdentifier.js";
import { parseInterfacePropertyNames } from "../validate/parseGeneratedSource.js";
import { resolvePackageExportPath } from "./resolveComposedPackageExport.js";
import type { ComposedPackageSpec } from "./writeComposedManifest.js";

const readFileUtf8 = (filePath: string): string =>
  fs.readFileSync(filePath, "utf8");

export const loadComposedPackageSpecs = (
  projectRoot: string,
  composedManifests: readonly string[],
  customConditions: readonly string[] | undefined,
): ComposedPackageSpec[] => {
  const collisions = findPackageIdentifierCollisions(composedManifests);
  if (collisions.length > 0) {
    throw new Error(
      `[ioc] composedManifests produce duplicate package identifiers: ${collisions
        .map((c: PackageIdentifierCollision) => c.identifier)
        .join(", ")}`,
    );
  }

  return composedManifests.map((packageName) => {
    const typesPath = resolvePackageExportPath(
      projectRoot,
      packageName,
      "./iocTypes",
      { customConditions },
    );
    const typesContent = readFileUtf8(typesPath);
    const externalProps = parseInterfacePropertyNames(
      typesContent,
      typesPath,
      "IocExternals",
    );
    const externalKeys = [...externalProps.keys()].sort((a, b) =>
      a.localeCompare(b),
    );

    return {
      packageName,
      identifier: packageNameToIdentifier(packageName),
      externalKeys,
    };
  });
};
