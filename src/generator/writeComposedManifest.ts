/**
 * @fileoverview Emits `ioc-composed.ts` for app-mode packages.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  LOCAL_PACKAGE_IDENTIFIER,
  packageNameToIdentifier,
} from "../config/packageIdentifier.js";
import type { ComposedRegistrationOverrides } from "../runtime/composedOverrides.js";

export type ComposedPackageSpec = {
  readonly packageName: string;
  readonly identifier: string;
};

export type WriteComposedManifestInput = {
  readonly generatedDir: string;
  readonly composedPackages: readonly ComposedPackageSpec[];
  readonly overrides: ComposedRegistrationOverrides | undefined;
};

const capitalizeIdentifier = (id: string): string =>
  id.length === 0 ? id : id.charAt(0).toUpperCase() + id.slice(1);

const buildManifestImportLines = (
  specs: readonly ComposedPackageSpec[],
): string[] => {
  const lines: string[] = [
    `import { iocManifest as ${LOCAL_PACKAGE_IDENTIFIER}Manifest } from "./ioc-manifest.js";`,
  ];
  for (const spec of specs) {
    lines.push(
      `import { iocManifest as ${spec.identifier}Manifest } from "${spec.packageName}/iocManifest";`,
    );
  }
  return lines;
};

const buildCradleImportLines = (
  specs: readonly ComposedPackageSpec[],
): string[] => {
  const lines: string[] = [
    `import type { IocGeneratedCradle as ${capitalizeIdentifier(LOCAL_PACKAGE_IDENTIFIER)}Cradle } from "./ioc-registry.types.js";`,
  ];
  for (const spec of specs) {
    const cap = capitalizeIdentifier(spec.identifier);
    lines.push(
      `import type { IocGeneratedCradle as ${cap}Cradle } from "${spec.packageName}/iocTypes";`,
    );
  }
  return lines;
};

const buildExternalsImportLines = (
  specs: readonly ComposedPackageSpec[],
): string[] => {
  const lines: string[] = [];
  for (const spec of specs) {
    const cap = capitalizeIdentifier(spec.identifier);
    lines.push(
      `import type { IocExternals as ${cap}Externals } from "${spec.packageName}/iocTypes";`,
    );
  }
  return lines;
};

const buildComposedManifestsArray = (
  specs: readonly ComposedPackageSpec[],
): string => {
  const names = [
    `${LOCAL_PACKAGE_IDENTIFIER}Manifest`,
    ...specs.map((s) => `${s.identifier}Manifest`),
  ];
  return `[${names.join(", ")}]`;
};

const buildAppCradleType = (specs: readonly ComposedPackageSpec[]): string => {
  const parts = [
    `${capitalizeIdentifier(LOCAL_PACKAGE_IDENTIFIER)}Cradle`,
    ...specs.map((s) => `${capitalizeIdentifier(s.identifier)}Cradle`),
  ];
  return parts.join(" & ");
};

const buildExternalsAssertionLines = (
  specs: readonly ComposedPackageSpec[],
): string[] => {
  const appCradle = "AppCradle";
  const lines: string[] = [];
  for (const spec of specs) {
    const cap = capitalizeIdentifier(spec.identifier);
    lines.push(
      `type _${cap}ExternalsSatisfied =`,
      `  ${cap}Externals extends Pick<${appCradle}, keyof ${cap}Externals> ? true : never;`,
    );
  }
  return lines;
};

const serializeOverridesLiteral = (
  overrides: ComposedRegistrationOverrides | undefined,
): string => {
  const hasContracts =
    overrides?.contracts !== undefined &&
    Object.keys(overrides.contracts).length > 0;
  const hasPackages =
    overrides?.composedPackageNames !== undefined &&
    overrides.composedPackageNames.length > 0;

  if (!hasContracts && !hasPackages) {
    return "export const composedRegistrationOverrides = {} as const satisfies ComposedRegistrationOverrides;";
  }

  const contractLines: string[] = ["export const composedRegistrationOverrides = {"];

  if (hasPackages) {
    const names = overrides!.composedPackageNames!.map((n) =>
      JSON.stringify(n),
    );
    contractLines.push(`  composedPackageNames: [${names.join(", ")}],`);
  }

  if (!hasContracts) {
    contractLines.push(
      "} as const satisfies ComposedRegistrationOverrides;",
    );
    return contractLines.join("\n");
  }

  contractLines.push("  contracts: {");
  const contractNames = Object.keys(overrides.contracts).sort((a, b) =>
    a.localeCompare(b),
  );

  for (const contractName of contractNames) {
    const entry = overrides.contracts[contractName]!;
    contractLines.push(`    ${JSON.stringify(contractName)}: {`);
    if (entry.defaultImplementation !== undefined) {
      contractLines.push(
        `      defaultImplementation: ${JSON.stringify(entry.defaultImplementation)},`,
      );
    }
    if (entry.sourceOverride !== undefined) {
      const keys = Object.keys(entry.sourceOverride).sort((a, b) =>
        a.localeCompare(b),
      );
      contractLines.push("      sourceOverride: {");
      for (const k of keys) {
        contractLines.push(
          `        ${JSON.stringify(k)}: ${JSON.stringify(entry.sourceOverride[k])},`,
        );
      }
      contractLines.push("      },");
    }
    contractLines.push("    },");
  }

  contractLines.push(
    "  },",
    "} as const satisfies ComposedRegistrationOverrides;",
  );
  return contractLines.join("\n");
};

export const buildComposedManifestSource = (
  input: WriteComposedManifestInput,
): string => {
  const { composedPackages, overrides } = input;
  const manifestImports = buildManifestImportLines(composedPackages);
  const cradleImports = buildCradleImportLines(composedPackages);
  const externalsImports = buildExternalsImportLines(composedPackages);
  const assertionLines = buildExternalsAssertionLines(composedPackages);
  const overridesBlock = serializeOverridesLiteral(overrides);

  const header = `/* AUTO-GENERATED. DO NOT EDIT.
App-mode composition glue. Re-run \`ioc generate\` after changing factories, composed packages, or IoC config.
*/
`;

  return `${header}import type { ComposedRegistrationOverrides } from "ioc-manifest";

${manifestImports.join("\n")}

${cradleImports.join("\n")}
${externalsImports.join("\n")}

export const composedManifests = ${buildComposedManifestsArray(composedPackages)} as const;

export type AppCradle = ${buildAppCradleType(composedPackages)};

${assertionLines.length > 0 ? `// Compile-time externals satisfaction assertions\n${assertionLines.join("\n")}\n` : ""}
${overridesBlock}
`;
};

export const resolveComposedPackageSpecs = (
  composedManifests: readonly string[],
): ComposedPackageSpec[] =>
  composedManifests.map((packageName) => ({
    packageName,
    identifier: packageNameToIdentifier(packageName),
  }));

const replaceFileFromTemp = async (
  targetPath: string,
  contents: string,
): Promise<void> => {
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;

  try {
    await fs.writeFile(tempPath, contents, "utf8");
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // Best effort cleanup; keep original failure context.
    }
    throw error;
  }
};

export const writeComposedManifest = async (
  input: WriteComposedManifestInput,
): Promise<string> => {
  const outPath = path.join(input.generatedDir, "ioc-composed.ts");
  const source = buildComposedManifestSource(input);
  await replaceFileFromTemp(outPath, source);
  return outPath;
};

export const removeComposedManifestIfPresent = async (
  generatedDir: string,
): Promise<void> => {
  const outPath = path.join(generatedDir, "ioc-composed.ts");
  try {
    await fs.unlink(outPath);
  } catch {
    // Missing file is fine.
  }
};
