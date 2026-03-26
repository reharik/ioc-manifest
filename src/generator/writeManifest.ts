import fs from "node:fs/promises";
import path from "node:path";
import type { DiscoveredFactory } from "./types.js";
import type { ResolvedContractRegistration } from "./resolveRegistrationPlan.js";
import type {
  IocContractManifest,
  ModuleFactoryManifestMetadata,
} from "../core/manifest.js";

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
        relImport: impl.relImport,
        contractName: plan.contractName,
        implementationName: impl.implementationName,
        lifetime: impl.lifetime,
        moduleIndex,
        ...(isResolvedDefault ? { default: true } : {}),
      };
    }
    out[plan.contractName] = inner;
  }
  return out;
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
  return lines.join("\n");
};

const getCoreManifestImportSpecifier = (
  manifestOutPath: string,
  projectRoot: string,
): string => {
  const manifestDir = path.dirname(manifestOutPath);
  const coreDir = path.join(projectRoot, "src", "core");
  let rel = path.relative(manifestDir, coreDir).replace(/\\/g, "/");
  if (!rel.startsWith(".")) {
    rel = `./${rel}`;
  }
  return `${rel}/manifest.js`;
};

const serializeIocContractManifestSource = (
  manifest: IocContractManifest,
  manifestImportFromGenerated: string,
  importLines: string[],
  moduleArrayLines: string[],
): string => {
  const header = `/* AUTO-GENERATED. DO NOT EDIT.
Re-run \`npm run gen:manifest\` after adding/removing injectable factories.
*/
`;

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

  return `${header}
import type { IocContractManifest } from "${manifestImportFromGenerated}";
${importLines.join("\n")}

export const iocModuleImports = [
${moduleArrayLines.join("\n")}
] as const;

export const iocManifestByContract: IocContractManifest =
${contractLines.join("\n")};
`;
};

const buildCradleTypeSource = (
  plans: ResolvedContractRegistration[],
): string => {
  const typeImports = new Map<string, Set<string>>();
  for (const plan of plans) {
    const importPath = plan.contractTypeRelImport;
    const set = typeImports.get(importPath) ?? new Set<string>();
    set.add(plan.contractName);
    typeImports.set(importPath, set);
  }

  const importLines = Array.from(typeImports.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([relImport, names]) => {
      const sorted = Array.from(names).sort((x, y) => x.localeCompare(y));
      return `import type { ${sorted.join(", ")} } from "${relImport}";`;
    });

  const propertyLines: string[] = [];

  const sortedPlans = [...plans].sort((a, b) =>
    a.contractName.localeCompare(b.contractName),
  );

  for (const plan of sortedPlans) {
    const typeName = plan.contractName;
    const seenKeys = new Set<string>();
    seenKeys.add(plan.contractKey);
    propertyLines.push(`  ${plan.contractKey}: ${typeName};`);
    const sortedImpls = [...plan.implementations].sort((a, b) =>
      a.registrationKey.localeCompare(b.registrationKey),
    );
    for (const impl of sortedImpls) {
      if (seenKeys.has(impl.registrationKey)) {
        continue;
      }
      seenKeys.add(impl.registrationKey);
      propertyLines.push(`  ${impl.registrationKey}: ${typeName};`);
    }
    if (plan.collectionKey !== undefined) {
      const keys = sortedImpls.map((i) => JSON.stringify(i.implementationName));
      const union = keys.join(" | ");
      propertyLines.push(
        `  ${plan.collectionKey}: Record<${union}, ${typeName}>;`,
      );
    }
  }

  const header = `/* AUTO-GENERATED. DO NOT EDIT.
Re-run \`npm run gen:manifest\` after changing factories or IoC config.
*/
`;

  return `${header}${importLines.length > 0 ? importLines.join("\n") + "\n\n" : ""}export interface IocGeneratedCradle {
${propertyLines.join("\n")}
}
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
  manifestOutPath: string,
  projectRoot: string,
): Promise<void> => {
  const sortedFactories = sortFactoriesForManifest(acceptedFactories);
  const modules = uniqueModuleRows(sortedFactories);
  const moduleIndexByPath = buildModuleIndexByPath(modules);
  const aliasByPath = assignStableModuleAliases(modules);
  const iocManifestByContract = plansToIocContractManifest(
    plans,
    moduleIndexByPath,
  );

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

  const manifestImportFromGenerated = getCoreManifestImportSpecifier(
    manifestOutPath,
    projectRoot,
  );

  const manifestSource = serializeIocContractManifestSource(
    iocManifestByContract,
    manifestImportFromGenerated,
    importLines,
    moduleArrayLines,
  );

  await replaceFileFromTemp(manifestOutPath, manifestSource);

  const typesPath = path.join(
    path.dirname(manifestOutPath),
    "ioc-registry.types.ts",
  );
  const typesSource = buildCradleTypeSource(plans);
  await replaceFileFromTemp(typesPath, typesSource);
};
