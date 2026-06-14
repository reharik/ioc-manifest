/**
 * @fileoverview Serializes manifest data to `ioc-manifest.ts` (runtime imports + metadata) and
 * `ioc-registry.types.ts` (cradle typing). Keeps output deterministic: sorted keys, stable module aliases,
 * temp-then-rename for safe concurrent runs.
 */
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import {
  cradleTypeImportUsesDefaultExport,
  resolveContractTypeSourceFile,
} from "./contractTypeSourceFile.js";
import type { DemandSupplyAnalysisResult } from "./analyzeDemandSupply/index.js";
import type { DiscoveredFactory } from "./types.js";
import type { ResolvedContractRegistration } from "./resolveRegistrationPlan.js";
import type {
  IocContractManifest,
  IocGroupNodeManifest,
  IocGroupRootManifest,
  IocGroupsManifest,
  ModuleFactoryManifestMetadata,
} from "../core/manifest.js";
import {
  formatRelativeImportEscapesPackageRootWarning,
  relativeImportEscapesPackageRoot,
  type ResolvedScanDir,
} from "./manifestPaths.js";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";

export type IocRegistryTypesBuildContext = {
  program: ts.Program;
  generatedDir: string;
  scanDirs: readonly ResolvedScanDir[];
  /** Package root for escape warnings on generated relative imports. */
  projectRoot: string;
};

export type WriteManifestOptions = {
  demandSupply: DemandSupplyAnalysisResult;
  registryTypesBuildContext?: IocRegistryTypesBuildContext;
};

/** Deterministic ordering for manifest output. */
const sortFactoriesForManifest = (
  factories: DiscoveredFactory[],
): DiscoveredFactory[] =>
  [...factories].sort((a, b) => {
    if (a.registrationKey !== b.registrationKey) {
      return a.registrationKey.localeCompare(b.registrationKey);
    }
    if (a.modulePath !== b.modulePath) {
      return a.modulePath.localeCompare(b.modulePath);
    }
    return a.exportName.localeCompare(b.exportName);
  });

/** One row per implementation module, in stable order. */
const uniqueModuleRows = (
  sortedFactories: DiscoveredFactory[],
): { relImport: string; modulePath: string }[] => {
  const seen = new Map<string, { relImport: string; modulePath: string }>();

  for (const factory of sortedFactories) {
    if (seen.has(factory.modulePath)) {
      continue;
    }

    seen.set(factory.modulePath, {
      relImport: factory.relImport,
      modulePath: factory.modulePath,
    });
  }

  return Array.from(seen.values()).sort((a, b) =>
    a.modulePath.localeCompare(b.modulePath),
  );
};

const sanitizeToIdentifierPart = (raw: string): string => {
  const s = raw.replace(/[^a-zA-Z0-9_]/g, "_");
  if (s.length === 0) {
    return "module";
  }
  if (/^[0-9]/.test(s)) {
    return `_${s}`;
  }
  return s;
};

const tsIdentifierOrQuoted = (key: string): string =>
  /^[a-zA-Z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);

/**
 * Stable, collision-safe namespace identifiers derived from module paths
 * (e.g. `examples/a-single-implementation.ts` → `ioc_examples_a_single_implementation`).
 */
const assignStableModuleAliases = (
  modules: { relImport: string; modulePath: string }[],
): Map<string, string> => {
  const pathToAlias = new Map<string, string>();
  const used = new Set<string>();

  for (const moduleEntry of modules) {
    const withoutExt = moduleEntry.modulePath.replace(/\.[^.]+$/, "");
    const segments = withoutExt.split(/[/\\]/).filter(Boolean);
    const base = sanitizeToIdentifierPart(
      segments.length > 0 ? `ioc_${segments.join("_")}` : "ioc_module",
    );

    let candidate = base;
    let n = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${n}`;
      n += 1;
    }

    used.add(candidate);
    pathToAlias.set(moduleEntry.modulePath, candidate);
  }

  return pathToAlias;
};

const buildModuleIndexByPath = (
  modules: { relImport: string; modulePath: string }[],
): Map<string, number> => {
  const out = new Map<string, number>();

  modules.forEach((row, index) => {
    out.set(row.modulePath, index);
  });

  return out;
};

const plansToIocContractManifest = (
  plans: ResolvedContractRegistration[],
  moduleIndexByPath: Map<string, number>,
): IocContractManifest => {
  const out: IocContractManifest = {};

  for (const plan of plans) {
    const implementations: Record<string, ModuleFactoryManifestMetadata> = {};

    for (const impl of plan.implementations) {
      const moduleIndex = moduleIndexByPath.get(impl.modulePath);
      if (moduleIndex === undefined) {
        throw new Error(
          `[ioc] internal error: module path "${impl.modulePath}" missing from module index map`,
        );
      }

      const isResolvedDefault =
        impl.implementationName === plan.defaultImplementationName;
      const accessKeyDiffersFromConvention =
        plan.accessKey !== plan.contractKey;

      implementations[impl.implementationName] = {
        exportName: impl.exportName,
        registrationKey: impl.registrationKey,
        modulePath: impl.modulePath,
        relImport: impl.relImport,
        contractName: plan.contractName,
        implementationName: impl.implementationName,
        lifetime: impl.lifetime,
        moduleIndex,
        ...(isResolvedDefault ? { default: true } : {}),
        ...(accessKeyDiffersFromConvention
          ? { accessKey: plan.accessKey }
          : {}),
        ...(impl.discoveredBy !== undefined
          ? { discoveredBy: impl.discoveredBy }
          : {}),
        ...(impl.configOverridesApplied !== undefined &&
        impl.configOverridesApplied.length > 0
          ? { configOverridesApplied: impl.configOverridesApplied }
          : {}),
        ...(impl.dependencyContractNames !== undefined &&
        impl.dependencyContractNames.length > 0
          ? { dependencyContractNames: impl.dependencyContractNames }
          : {}),
      };
    }

    out[plan.contractName] = implementations;
  }

  return out;
};

const serializeGroupRootLiteral = (
  root: IocGroupRootManifest,
  baseIndent: string,
): string => {
  const inner = `${baseIndent}  `;
  const lines: string[] = ["{"];
  lines.push(`${inner}kind: ${JSON.stringify(root.kind)},`);
  lines.push(`${inner}baseType: ${JSON.stringify(root.baseType)},`);
  lines.push(`${inner}baseTypeId: ${JSON.stringify(root.baseTypeId)},`);
  lines.push(`${inner}members: ${serializeGroupNodeLiteral(root.members, inner)},`);
  lines.push(`${baseIndent}}`);
  return lines.join("\n");
};

const serializeGroupNodeLiteral = (
  node: IocGroupNodeManifest,
  baseIndent: string,
): string => {
  const inner = `${baseIndent}  `;

  if (Array.isArray(node)) {
    if (node.length === 0) {
      return "[]";
    }

    const lines: string[] = ["["];
    for (const leaf of node) {
      lines.push(`${inner}{`);
      lines.push(
        `${inner}  contractName: ${JSON.stringify(leaf.contractName)},`,
      );
      lines.push(
        `${inner}  registrationKey: ${JSON.stringify(leaf.registrationKey)},`,
      );
      lines.push(`${inner}},`);
    }
    lines.push(`${baseIndent}]`);
    return lines.join("\n");
  }

  const propKeys = Object.keys(node).sort((a, b) => a.localeCompare(b));
  if (propKeys.length === 0) {
    return "{}";
  }

  const lines: string[] = ["{"];
  for (const propKey of propKeys) {
    const leaf = node[propKey]!;
    lines.push(`${inner}${tsIdentifierOrQuoted(propKey)}: {`);
    lines.push(`${inner}  contractName: ${JSON.stringify(leaf.contractName)},`);
    lines.push(
      `${inner}  registrationKey: ${JSON.stringify(leaf.registrationKey)},`,
    );
    lines.push(`${inner}},`);
  }
  lines.push(`${baseIndent}}`);
  return lines.join("\n");
};

const serializeGroupRootsForManifest = (
  groupsManifest: IocGroupsManifest | undefined,
): string => {
  if (groupsManifest === undefined) {
    return "";
  }

  const rootKeys = Object.keys(groupsManifest).sort((a, b) =>
    a.localeCompare(b),
  );
  const blocks: string[] = [];

  for (const key of rootKeys) {
    const root = groupsManifest[key]!;
    blocks.push("");
    blocks.push(`  // ${key}`);
    blocks.push(
      `  ${tsIdentifierOrQuoted(key)}: ${serializeGroupRootLiteral(root, "  ")},`,
    );
  }

  return blocks.join("\n");
};

const buildIocManifestGroupRootsTypeSource = (
  groupsManifest: IocGroupsManifest,
): string => {
  const rootKeys = Object.keys(groupsManifest).sort((a, b) =>
    a.localeCompare(b),
  );
  const lines: string[] = ["type IocManifestGroupRoots = {"];

  for (const key of rootKeys) {
    const root = groupsManifest[key]!;
    const node = root.members;
    lines.push(
      `  readonly ${tsIdentifierOrQuoted(key)}: { readonly kind: ${JSON.stringify(root.kind)}; readonly baseType: ${JSON.stringify(root.baseType)}; readonly baseTypeId: ${JSON.stringify(root.baseTypeId)}; readonly members:`,
    );
    if (Array.isArray(node)) {
      lines.push(" readonly [");
      for (const leaf of node) {
        lines.push(
          `    { readonly contractName: ${JSON.stringify(leaf.contractName)}; readonly registrationKey: ${JSON.stringify(leaf.registrationKey)} },`,
        );
      }
      lines.push("  ]; };");
      continue;
    }

    lines.push(" {");
    const propKeys = Object.keys(node).sort((a, b) => a.localeCompare(b));
    for (const propKey of propKeys) {
      const leaf = node[propKey]!;
      lines.push(
        `    readonly ${tsIdentifierOrQuoted(propKey)}: { readonly contractName: ${JSON.stringify(leaf.contractName)}; readonly registrationKey: ${JSON.stringify(leaf.registrationKey)} };`,
      );
    }
    lines.push("  }; };");
  }

  lines.push("};");
  return lines.join("\n");
};

const serializeMetadataBlock = (
  meta: ModuleFactoryManifestMetadata,
): string => {
  const lines = [
    `      exportName: ${JSON.stringify(meta.exportName)},`,
    `      registrationKey: ${JSON.stringify(meta.registrationKey)},`,
    `      modulePath: ${JSON.stringify(meta.modulePath)},`,
    `      relImport: ${JSON.stringify(meta.relImport)},`,
    `      contractName: ${JSON.stringify(meta.contractName)},`,
    `      implementationName: ${JSON.stringify(meta.implementationName)},`,
    `      lifetime: ${JSON.stringify(meta.lifetime)},`,
    `      moduleIndex: ${meta.moduleIndex},`,
  ];

  if (meta.group !== undefined) {
    lines.push(`      group: ${JSON.stringify(meta.group)},`);
  }
  if (meta.default !== undefined) {
    lines.push(`      default: ${meta.default},`);
  }
  if (meta.discoveredBy !== undefined) {
    lines.push(`      discoveredBy: ${JSON.stringify(meta.discoveredBy)},`);
  }
  if (meta.configOverridesApplied !== undefined) {
    lines.push(
      `      configOverridesApplied: ${JSON.stringify(meta.configOverridesApplied)},`,
    );
  }
  if (meta.dependencyContractNames !== undefined) {
    lines.push(
      `      dependencyContractNames: ${JSON.stringify(meta.dependencyContractNames)},`,
    );
  }
  if (meta.accessKey !== undefined) {
    lines.push(`      accessKey: ${JSON.stringify(meta.accessKey)},`);
  }

  return lines.join("\n");
};

const serializeRegistrationManifestValue = (
  manifest: IocContractManifest,
): string => {
  const contractNames = Object.keys(manifest).sort((a, b) =>
    a.localeCompare(b),
  );
  const contractLines: string[] = ["{"];

  for (const contractName of contractNames) {
    const impls = manifest[contractName]!;
    const implKeys = Object.keys(impls).sort((a, b) => a.localeCompare(b));

    contractLines.push(`  ${JSON.stringify(contractName)}: {`);
    for (const implKey of implKeys) {
      const meta = impls[implKey]!;
      contractLines.push(`    ${JSON.stringify(implKey)}: {`);
      contractLines.push(serializeMetadataBlock(meta));
      contractLines.push("    },");
    }
    contractLines.push("  },");
  }

  contractLines.push("}");
  return contractLines.join("\n");
};

const serializeMainIocManifestSource = (
  contractManifest: IocContractManifest,
  groupsManifest: IocGroupsManifest | undefined,
  manifestImportFromPackage: string,
  importLines: string[],
  moduleArrayLines: string[],
  scopeProvidedKeys: readonly string[],
): string => {
  const header = `/* AUTO-GENERATED. DO NOT EDIT.
Primary container manifest.
Re-run \`npm run gen:manifest\` after changing factories or IoC config.
*/
`;

  const groupRootsBlock = serializeGroupRootsForManifest(groupsManifest);
  const hasGroups =
    groupsManifest !== undefined && Object.keys(groupsManifest).length > 0;
  const groupRootsTypeBlock = hasGroups
    ? `${buildIocManifestGroupRootsTypeSource(groupsManifest)}\n\n`
    : "";
  const satisfiesType = hasGroups
    ? "IocGeneratedContainerManifest<IocManifestGroupRoots>"
    : "IocGeneratedContainerManifest";
  const contractsBlock = serializeRegistrationManifestValue(contractManifest);

  return `${header}import type {
  IocGeneratedContainerManifest,
  IocModuleNamespace,
} from "${manifestImportFromPackage}";

${importLines.join("\n")}

${groupRootsTypeBlock}export const iocManifest = {
  manifestSchemaVersion: ${MANIFEST_SCHEMA_VERSION},

  moduleImports: [
${moduleArrayLines.join("\n")}
  ] as const satisfies readonly IocModuleNamespace[],

  contracts: ${contractsBlock},${groupRootsBlock}
} as const satisfies ${satisfiesType};

export const IOC_SCOPE_PROVIDED_KEYS = [${scopeProvidedKeys.map((k) => JSON.stringify(k)).join(", ")}] as const;
`;
};

const addTypeImport = (
  grouped: Map<string, { named: Set<string>; defaults: Set<string> }>,
  relImport: string,
  typeName: string,
  useDefaultImport: boolean,
): void => {
  let bucket = grouped.get(relImport);
  if (bucket === undefined) {
    bucket = { named: new Set(), defaults: new Set() };
    grouped.set(relImport, bucket);
  }
  if (useDefaultImport) {
    bucket.defaults.add(typeName);
  } else {
    bucket.named.add(typeName);
  }
};

const buildImportLinesFromBuckets = (
  grouped: Map<string, { named: Set<string>; defaults: Set<string> }>,
): string[] => {
  const importLines: string[] = [];
  for (const [relImport, bucket] of Array.from(grouped.entries()).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const defaultNames = Array.from(bucket.defaults).sort((x, y) =>
      x.localeCompare(y),
    );
    const namedNames = Array.from(bucket.named).sort((x, y) =>
      x.localeCompare(y),
    );

    for (const defaultName of defaultNames) {
      importLines.push(`import type ${defaultName} from "${relImport}";`);
    }
    if (namedNames.length > 0) {
      importLines.push(
        `import type { ${namedNames.join(", ")} } from "${relImport}";`,
      );
    }
  }
  return importLines;
};

const warnOnRelativeImportsEscapingPackageRoot = (
  relImports: Iterable<string>,
  generatedDir: string,
  packageRoot: string,
): void => {
  const warned = new Set<string>();
  for (const relImport of relImports) {
    if (warned.has(relImport)) {
      continue;
    }
    if (
      relativeImportEscapesPackageRoot(relImport, generatedDir, packageRoot)
    ) {
      console.warn(formatRelativeImportEscapesPackageRootWarning(relImport));
      warned.add(relImport);
    }
  }
};

const buildCradleTypeSource = (
  plans: ResolvedContractRegistration[],
  groupsManifest: IocGroupsManifest | undefined,
  demandSupply: DemandSupplyAnalysisResult,
  registryTypesBuildContext?: IocRegistryTypesBuildContext,
): string => {
  const grouped = new Map<
    string,
    { named: Set<string>; defaults: Set<string> }
  >();

  for (const entry of demandSupply.entries) {
    for (const imp of entry.typeRef.imports) {
      addTypeImport(
        grouped,
        imp.relImport,
        imp.typeName,
        imp.useDefaultImport,
      );
    }
  }

  if (registryTypesBuildContext !== undefined) {
    const { program, generatedDir, scanDirs } = registryTypesBuildContext;

    for (const plan of plans) {
      const sourceFile = resolveContractTypeSourceFile(
        program,
        generatedDir,
        plan.contractTypeRelImport,
        scanDirs,
        plan.contractName,
      );
      const useDefault =
        sourceFile !== undefined &&
        cradleTypeImportUsesDefaultExport(sourceFile, plan.contractName);
      addTypeImport(
        grouped,
        plan.contractTypeRelImport,
        plan.contractName,
        useDefault,
      );
    }
  } else {
    for (const plan of plans) {
      addTypeImport(
        grouped,
        plan.contractTypeRelImport,
        plan.contractName,
        false,
      );
    }
  }

  const importLines = buildImportLinesFromBuckets(grouped);

  if (registryTypesBuildContext?.projectRoot !== undefined) {
    warnOnRelativeImportsEscapingPackageRoot(
      grouped.keys(),
      registryTypesBuildContext.generatedDir,
      registryTypesBuildContext.projectRoot,
    );
  }

  const demandSupplyKeys = new Set(demandSupply.entries.map((e) => e.key));
  const cradleProperties: { key: string; line: string }[] = [];

  for (const entry of demandSupply.entries) {
    if (entry.classification !== "local") {
      continue;
    }
    cradleProperties.push({
      key: entry.key,
      line: `  ${tsIdentifierOrQuoted(entry.key)}: ${entry.typeRef.typeName};`,
    });
  }

  const sortedPlans = [...plans].sort((a, b) =>
    a.contractName.localeCompare(b.contractName),
  );

  for (const plan of sortedPlans) {
    const typeName = plan.contractName;
    if (!demandSupplyKeys.has(plan.accessKey)) {
      cradleProperties.push({
        key: plan.accessKey,
        line: `  ${plan.accessKey}: ${typeName};`,
      });
      demandSupplyKeys.add(plan.accessKey);
    }

    if (
      plan.collectionKey !== undefined &&
      !demandSupplyKeys.has(plan.collectionKey)
    ) {
      cradleProperties.push({
        key: plan.collectionKey,
        line: `  ${plan.collectionKey}: ReadonlyArray<${typeName}>;`,
      });
      demandSupplyKeys.add(plan.collectionKey);
    }
  }

  const appendGroupNodeType = (
    node: IocGroupNodeManifest,
    indent: string,
  ): string => {
    if (Array.isArray(node)) {
      const seen = new Set<string>();
      const order: string[] = [];

      for (const leaf of node) {
        if (!seen.has(leaf.contractName)) {
          seen.add(leaf.contractName);
          order.push(leaf.contractName);
        }
      }

      const union = order.length > 0 ? order.join(" | ") : "never";
      return `ReadonlyArray<${union}>`;
    }

    const lines: string[] = [`${indent}{`];
    const sortedKeys = Object.keys(node).sort((a, b) => a.localeCompare(b));

    for (const key of sortedKeys) {
      const leaf = node[key]!;
      lines.push(
        `${indent}  ${tsIdentifierOrQuoted(key)}: ${leaf.contractName};`,
      );
    }

    lines.push(`${indent}}`);
    return lines.join("\n");
  };

  if (groupsManifest !== undefined) {
    const groupRootKeys = Object.keys(groupsManifest).sort((a, b) =>
      a.localeCompare(b),
    );

    for (const key of groupRootKeys) {
      if (demandSupplyKeys.has(key)) {
        continue;
      }
      const root = groupsManifest[key]!;
      cradleProperties.push({
        key,
        line: `  ${tsIdentifierOrQuoted(key)}: ${appendGroupNodeType(root.members, "")};`,
      });
      demandSupplyKeys.add(key);
    }
  }

  cradleProperties.sort((a, b) => a.key.localeCompare(b.key));
  const propertyLines = cradleProperties.map((p) => p.line);

  const externalEntries = demandSupply.entries.filter(
    (e) => e.classification === "external",
  );
  const externalsLines = externalEntries.map(
    (e) => `  ${tsIdentifierOrQuoted(e.key)}: ${e.typeRef.typeName};`,
  );

  const header = `/* AUTO-GENERATED. DO NOT EDIT.
Re-run \`npm run gen:manifest\` after changing factories or IoC config.
*/
`;

  const externalsBlock =
    externalsLines.length > 0
      ? `\n\nexport interface IocExternals {\n${externalsLines.join("\n")}\n}`
      : `\n\nexport interface IocExternals {}`;

  const scopeProvidedEntries = demandSupply.entries.filter(
    (e) => e.classification === "scope-provided",
  );
  const scopeProvidedLines = scopeProvidedEntries.map(
    (e) => `  ${tsIdentifierOrQuoted(e.key)}: ${e.typeRef.typeName};`,
  );
  const scopeProvidedDoc = `/**
 * Values supplied at runtime by registering onto a request child scope
 * (e.g. \`scope.register({ key: asValue(...) })\`) — not built by any factory.
 *
 * Register the relevant key(s) onto the child scope before resolving services that
 * depend on them. Resolving a dependent service without the value throws at runtime
 * (\`IocResolutionError\`), never returns a placeholder.
 *
 * Not every key is needed on every scope — register only those the current request
 * path actually resolves (e.g. an authed path vs. a public path).
 */
`;
  const scopeProvidedBlock =
    scopeProvidedLines.length > 0
      ? `\n\n${scopeProvidedDoc}export interface IocScopeProvided {\n${scopeProvidedLines.join("\n")}\n}`
      : `\n\nexport interface IocScopeProvided {}`;

  return `${header}${importLines.length > 0 ? importLines.join("\n") + "\n\n" : ""}export interface IocGeneratedCradle {
${propertyLines.join("\n")}
}${externalsBlock}${scopeProvidedBlock}
`;
};

export type ManifestArtifactSources = {
  readonly mainSource: string;
  readonly typesSource: string;
  readonly typesPath: string;
};

/**
 * Builds manifest and registry type sources without writing to disk.
 */
export const buildManifestArtifactSources = (
  acceptedFactories: DiscoveredFactory[],
  plans: ResolvedContractRegistration[],
  groupsManifest: IocGroupsManifest | undefined,
  manifestOutPath: string,
  manifestImportFromPackage: string,
  options: WriteManifestOptions,
): ManifestArtifactSources => {
  const sortedFactories = sortFactoriesForManifest(acceptedFactories);
  const modules = uniqueModuleRows(sortedFactories);
  const moduleIndexByPath = buildModuleIndexByPath(modules);
  const aliasByPath = assignStableModuleAliases(modules);
  const contractManifest = plansToIocContractManifest(plans, moduleIndexByPath);
  const iocGroupsManifest: IocGroupsManifest | undefined = groupsManifest;

  const importLines = modules.map((moduleEntry) => {
    const alias = aliasByPath.get(moduleEntry.modulePath);
    if (!alias) {
      throw new Error(
        `[ioc] internal error: missing alias for "${moduleEntry.modulePath}"`,
      );
    }
    return `import * as ${alias} from "${moduleEntry.relImport}";`;
  });

  const moduleArrayLines = modules.map((moduleEntry) => {
    const alias = aliasByPath.get(moduleEntry.modulePath);
    if (!alias) {
      throw new Error(
        `[ioc] internal error: missing alias for "${moduleEntry.modulePath}"`,
      );
    }
    return `  ${alias},`;
  });

  if (options.demandSupply === undefined) {
    throw new Error(
      "[ioc] internal error: demandSupply analysis is required for registry type generation",
    );
  }

  const mainSource = serializeMainIocManifestSource(
    contractManifest,
    iocGroupsManifest,
    manifestImportFromPackage,
    importLines,
    moduleArrayLines,
    options.demandSupply.scopeProvidedKeys,
  );

  const typesPath = path.join(
    path.dirname(manifestOutPath),
    "ioc-registry.types.ts",
  );

  const typesSource = buildCradleTypeSource(
    plans,
    iocGroupsManifest,
    options.demandSupply,
    options.registryTypesBuildContext,
  );

  return { mainSource, typesSource, typesPath };
};

export type GeneratedFileWrite = {
  readonly path: string;
  readonly contents: string;
};

export const writeGeneratedFilesAtomically = async (
  files: readonly GeneratedFileWrite[],
): Promise<void> => {
  const pending: { readonly path: string; readonly tempPath: string }[] = [];

  try {
    for (const file of files) {
      const tempPath = `${file.path}.tmp-${process.pid}-${Date.now()}-${pending.length}`;
      await fs.writeFile(tempPath, file.contents, "utf8");
      pending.push({ path: file.path, tempPath });
    }
    for (const { path: targetPath, tempPath } of pending) {
      await fs.rename(tempPath, targetPath);
    }
  } catch (error) {
    for (const { tempPath } of pending) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // Best effort cleanup.
      }
    }
    throw error;
  }
};

/**
 * Writes the two generated artifacts next to each other. `manifestImportFromPackage` is the
 * package name (or path) used in the `import type` for `IocGeneratedContainerManifest`.
 */
export const writeManifest = async (
  acceptedFactories: DiscoveredFactory[],
  plans: ResolvedContractRegistration[],
  groupsManifest: IocGroupsManifest | undefined,
  manifestOutPath: string,
  manifestImportFromPackage: string,
  options?: WriteManifestOptions,
): Promise<void> => {
  if (options?.demandSupply === undefined) {
    throw new Error(
      "[ioc] internal error: demandSupply analysis is required for registry type generation",
    );
  }

  const sources = buildManifestArtifactSources(
    acceptedFactories,
    plans,
    groupsManifest,
    manifestOutPath,
    manifestImportFromPackage,
    options,
  );

  await writeGeneratedFilesAtomically([
    { path: manifestOutPath, contents: sources.mainSource },
    { path: sources.typesPath, contents: sources.typesSource },
  ]);
};
