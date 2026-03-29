import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import {
  cradleTypeImportUsesDefaultExport,
  resolveContractTypeSourceFile,
} from "./contractTypeSourceFile.js";
import type { DiscoveredFactory } from "./types.js";
import type { ResolvedContractRegistration } from "./resolveRegistrationPlan.js";
import type {
  IocContainerContractsView,
  IocContainerImplementationView,
  IocContractManifest,
  IocGroupNodeManifest,
  IocGroupsManifest,
  ModuleFactoryManifestMetadata,
} from "../core/manifest.js";

export type IocRegistryTypesBuildContext = {
  program: ts.Program;
  generatedDir: string;
};

export type WriteManifestOptions = {
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
  for (const f of sortedFactories) {
    if (seen.has(f.modulePath)) continue;
    seen.set(f.modulePath, {
      relImport: f.relImport,
      modulePath: f.modulePath,
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

/**
 * Stable, collision-safe namespace identifiers derived from module paths
 * (e.g. `examples/a-single-implementation.ts` → `ioc_examples_a_single_implementation`).
 */
const assignStableModuleAliases = (
  modules: { relImport: string; modulePath: string }[],
): Map<string, string> => {
  const pathToAlias = new Map<string, string>();
  const used = new Set<string>();
  for (const m of modules) {
    const withoutExt = m.modulePath.replace(/\.[^.]+$/, "");
    const segments = withoutExt.split(/[/\\]/).filter(Boolean);
    let base = sanitizeToIdentifierPart(
      segments.length > 0 ? `ioc_${segments.join("_")}` : "ioc_module",
    );
    let candidate = base;
    let n = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${n}`;
      n += 1;
    }
    used.add(candidate);
    pathToAlias.set(m.modulePath, candidate);
  }
  return pathToAlias;
};

const buildModuleIndexByPath = (
  modules: { relImport: string; modulePath: string }[],
): Map<string, number> => {
  const m = new Map<string, number>();
  modules.forEach((row, index) => {
    m.set(row.modulePath, index);
  });
  return m;
};

const plansToIocContractManifest = (
  plans: ResolvedContractRegistration[],
  moduleIndexByPath: Map<string, number>,
): IocContractManifest => {
  const out: IocContractManifest = {};
  for (const plan of plans) {
    const inner: Record<string, ModuleFactoryManifestMetadata> = {};
    for (const impl of plan.implementations) {
      const moduleIndex = moduleIndexByPath.get(impl.modulePath);
      if (moduleIndex === undefined) {
        throw new Error(
          `[ioc] internal error: module path "${impl.modulePath}" missing from module index map`,
        );
      }
      const isResolvedDefault =
        impl.implementationName === plan.defaultImplementationName;
      inner[impl.implementationName] = {
        exportName: impl.exportName,
        registrationKey: impl.registrationKey,
        modulePath: impl.modulePath,
        sourceFilePath: impl.modulePath,
        relImport: impl.relImport,
        contractName: plan.contractName,
        implementationName: impl.implementationName,
        lifetime: impl.lifetime,
        moduleIndex,
        ...(isResolvedDefault ? { default: true } : {}),
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
    out[plan.contractName] = inner;
  }
  return out;
};

const plansToLeanContainerContracts = (
  plans: ResolvedContractRegistration[],
): IocContainerContractsView => {
  const sortedPlans = [...plans].sort((a, b) =>
    a.contractName.localeCompare(b.contractName),
  );
  const out: IocContainerContractsView = {};
  for (const plan of sortedPlans) {
    const inner: Record<string, IocContainerImplementationView> = {};
    const implNames = [...plan.implementations].sort((a, b) =>
      a.implementationName.localeCompare(b.implementationName),
    );
    for (const impl of implNames) {
      const isResolvedDefault =
        impl.implementationName === plan.defaultImplementationName;
      inner[impl.implementationName] = {
        exportName: impl.exportName,
        registrationKey: impl.registrationKey,
        sourceFile: impl.modulePath,
        lifetime: impl.lifetime,
        ...(isResolvedDefault ? { default: true } : {}),
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
    out[plan.contractName] = inner;
  }
  return out;
};

const serializeLeanImplementationBlock = (
  row: IocContainerImplementationView,
): string => {
  const lines = [
    `        exportName: ${JSON.stringify(row.exportName)},`,
    `        registrationKey: ${JSON.stringify(row.registrationKey)},`,
    `        sourceFile: ${JSON.stringify(row.sourceFile)},`,
    `        lifetime: ${JSON.stringify(row.lifetime)},`,
  ];
  if (row.default !== undefined) {
    lines.push(`        default: ${row.default},`);
  }
  if (row.discoveredBy !== undefined) {
    lines.push(`        discoveredBy: ${JSON.stringify(row.discoveredBy)},`);
  }
  if (row.configOverridesApplied !== undefined) {
    lines.push(
      `        configOverridesApplied: ${JSON.stringify(row.configOverridesApplied)},`,
    );
  }
  if (row.dependencyContractNames !== undefined) {
    lines.push(
      `        dependencyContractNames: ${JSON.stringify(row.dependencyContractNames)},`,
    );
  }
  return lines.join("\n");
};

const serializeLeanContractsObject = (
  lean: IocContainerContractsView,
): string => {
  const contractNames = Object.keys(lean).sort((a, b) => a.localeCompare(b));
  const lines: string[] = ["  contracts: {"];
  for (const contractName of contractNames) {
    lines.push("");
    lines.push(`    // ${contractName}`);
    const impls = lean[contractName]!;
    const implKeys = Object.keys(impls).sort((a, b) => a.localeCompare(b));
    lines.push(`    ${JSON.stringify(contractName)}: {`);
    for (const implKey of implKeys) {
      const row = impls[implKey]!;
      lines.push(`      ${JSON.stringify(implKey)}: {`);
      lines.push(serializeLeanImplementationBlock(row));
      lines.push(`      },`);
    }
    lines.push(`    },`);
  }
  lines.push("  },");
  return lines.join("\n");
};

const serializeMetadataBlock = (
  meta: ModuleFactoryManifestMetadata,
): string => {
  const lines = [
    `      exportName: ${JSON.stringify(meta.exportName)},`,
    `      registrationKey: ${JSON.stringify(meta.registrationKey)},`,
    `      modulePath: ${JSON.stringify(meta.modulePath)},`,
    `      sourceFilePath: ${JSON.stringify(meta.sourceFilePath ?? meta.modulePath)},`,
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
      contractLines.push(`    },`);
    }
    contractLines.push(`  },`);
  }

  contractLines.push("}");
  return contractLines.join("\n");
};

const serializeMainIocManifestSource = (
  lean: IocContainerContractsView,
  groupsManifest: IocGroupsManifest | undefined,
  manifestImportFromPackage: string,
  importLines: string[],
  moduleArrayLines: string[],
): string => {
  const header = `/* AUTO-GENERATED. DO NOT EDIT.
Primary container manifest (human-oriented). Registration bindings: ioc-manifest.support.ts
Re-run \`npm run gen:manifest\` after adding/removing injectable factories.
*/
`;

  const contractsBlock = serializeLeanContractsObject(lean);
  const groupsLine =
    groupsManifest === undefined
      ? ""
      : `  groups: ${JSON.stringify(groupsManifest, null, 2)},\n`;
  const closing = groupsLine === "" ? "}" : `${groupsLine}}`;

  return `${header}import type {
  IocGeneratedContainerManifest,
  IocModuleNamespace,
} from "${manifestImportFromPackage}";

${importLines.join("\n")}

export const iocManifest = {
  moduleImports: [
${moduleArrayLines.join("\n")}
  ] as const satisfies readonly IocModuleNamespace[],

${contractsBlock}
${closing} as const satisfies IocGeneratedContainerManifest;
`;
};

const serializeSupportManifestSource = (
  registrationManifest: IocContractManifest,
  manifestImportFromPackage: string,
): string => {
  const header = `/* AUTO-GENERATED. DO NOT EDIT.
Runtime registration bindings (moduleIndex, relImport).
Used by registerIocFromManifest(...) and inspection helpers. See ioc-manifest.ts for the human-oriented view.
Re-run \`npm run gen:manifest\` after changing factories or IoC config.
*/
`;

  const registrationBody = serializeRegistrationManifestValue(registrationManifest);

  return `${header}import type { IocContractManifest } from "${manifestImportFromPackage}";

export const iocRegistrationManifest: IocContractManifest =
${registrationBody};
`;
};

const buildCradleTypeSource = (
  plans: ResolvedContractRegistration[],
  groupsManifest: IocGroupsManifest | undefined,
  registryTypesBuildContext?: IocRegistryTypesBuildContext,
): string => {
  const importLines: string[] = [];

  if (registryTypesBuildContext === undefined) {
    const typeImports = new Map<string, Set<string>>();
    for (const plan of plans) {
      const importPath = plan.contractTypeRelImport;
      const set = typeImports.get(importPath) ?? new Set<string>();
      set.add(plan.contractName);
      typeImports.set(importPath, set);
    }
    for (const [relImport, names] of Array.from(typeImports.entries()).sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      const sorted = Array.from(names).sort((x, y) => x.localeCompare(y));
      importLines.push(
        `import type { ${sorted.join(", ")} } from "${relImport}";`,
      );
    }
  } else {
    const { program, generatedDir } = registryTypesBuildContext;
    const grouped = new Map<
      string,
      { named: Set<string>; defaults: Set<string> }
    >();

    for (const plan of plans) {
      const relImport = plan.contractTypeRelImport;
      let bucket = grouped.get(relImport);
      if (bucket === undefined) {
        bucket = { named: new Set(), defaults: new Set() };
        grouped.set(relImport, bucket);
      }
      const sourceFile = resolveContractTypeSourceFile(
        program,
        generatedDir,
        relImport,
      );
      const useDefault =
        sourceFile !== undefined &&
        cradleTypeImportUsesDefaultExport(sourceFile, plan.contractName);
      if (useDefault) {
        bucket.defaults.add(plan.contractName);
      } else {
        bucket.named.add(plan.contractName);
      }
    }

    for (const [relImport, bucket] of Array.from(grouped.entries()).sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      const defaultNames = Array.from(bucket.defaults).sort((x, y) =>
        x.localeCompare(y),
      );
      const namedNames = Array.from(bucket.named).sort((x, y) =>
        x.localeCompare(y),
      );
      for (const d of defaultNames) {
        importLines.push(`import type ${d} from "${relImport}";`);
      }
      if (namedNames.length > 0) {
        importLines.push(
          `import type { ${namedNames.join(", ")} } from "${relImport}";`,
        );
      }
    }
  }

  const propertyLines: string[] = [];

  const sortedPlans = [...plans].sort((a, b) =>
    a.contractName.localeCompare(b.contractName),
  );

  for (const plan of sortedPlans) {
    const typeName = plan.contractName;
    propertyLines.push(`  ${plan.contractKey}: ${typeName};`);
    const sortedImpls = [...plan.implementations].sort((a, b) =>
      a.registrationKey.localeCompare(b.registrationKey),
    );
    if (plan.collectionKey !== undefined) {
      const keys = sortedImpls.map((i) => JSON.stringify(i.implementationName));
      const union = keys.join(" | ");
      propertyLines.push(
        `  ${plan.collectionKey}: Record<${union}, ${typeName}>;`,
      );
    }
  }

  const tsPropName = (key: string): string =>
    /^[a-zA-Z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);

  const appendGroupNodeType = (node: IocGroupNodeManifest, indent: string): string => {
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
      lines.push(`${indent}  ${tsPropName(key)}: ${leaf.contractName};`);
    }
    lines.push(`${indent}}`);
    return lines.join("\n");
  };

  if (groupsManifest !== undefined) {
    const groupRootKeys = Object.keys(groupsManifest).sort((a, b) =>
      a.localeCompare(b),
    );
    for (const key of groupRootKeys) {
      const node = groupsManifest[key]!;
      propertyLines.push(
        `  ${tsPropName(key)}: ${appendGroupNodeType(node, "")};`,
      );
    }
  }

  const header = `/* AUTO-GENERATED. DO NOT EDIT.
Re-run \`npm run gen:manifest\` after changing factories or IoC config.
*/
`;

  return `${header}${importLines.length > 0 ? importLines.join("\n") + "\n\n" : ""}export interface IocGeneratedTypes {
${propertyLines.join("\n")}
}

export type IocGeneratedCradle = IocGeneratedTypes;
`;
};

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

export const writeManifest = async (
  acceptedFactories: DiscoveredFactory[],
  plans: ResolvedContractRegistration[],
  groupsManifest: IocGroupsManifest | undefined,
  manifestOutPath: string,
  manifestImportFromPackage: string,
  options?: WriteManifestOptions,
): Promise<void> => {
  const sortedFactories = sortFactoriesForManifest(acceptedFactories);
  const modules = uniqueModuleRows(sortedFactories);
  const moduleIndexByPath = buildModuleIndexByPath(modules);
  const aliasByPath = assignStableModuleAliases(modules);
  const iocRegistrationManifest = plansToIocContractManifest(
    plans,
    moduleIndexByPath,
  );
  const leanContracts = plansToLeanContainerContracts(plans);
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

  const mainSource = serializeMainIocManifestSource(
    leanContracts,
    iocGroupsManifest,
    manifestImportFromPackage,
    importLines,
    moduleArrayLines,
  );

  const supportPath = path.join(
    path.dirname(manifestOutPath),
    "ioc-manifest.support.ts",
  );
  const supportSource = serializeSupportManifestSource(
    iocRegistrationManifest,
    manifestImportFromPackage,
  );

  await replaceFileFromTemp(manifestOutPath, mainSource);
  await replaceFileFromTemp(supportPath, supportSource);

  const typesPath = path.join(
    path.dirname(manifestOutPath),
    "ioc-registry.types.ts",
  );
  const typesSource = buildCradleTypeSource(
    plans,
    iocGroupsManifest,
    options?.registryTypesBuildContext,
  );
  await replaceFileFromTemp(typesPath, typesSource);
};
