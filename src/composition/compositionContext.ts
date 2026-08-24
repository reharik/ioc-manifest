/**
 * @fileoverview Builds the composed picture both verbs judge: one slice per manifest (local first,
 * then each `composedManifests` entry), plus the inputs the shared program is constructed from.
 *
 * Manifests are PARSED, never imported — the `ioc` CLI runs under plain `node`, which cannot
 * import a `.ts` file at all. There is one manifest parser in the codebase
 * (`generator/parseGeneratedManifestSource.ts`) and this projects the fields the checks read out
 * of it; the second, lesser parser that used to live under `validate/` is gone.
 *
 * The local slice can come from disk (`ioc validate`, reading committed artifacts) or from
 * memory (`ioc generate`, judging what it is about to write). Everything downstream is identical
 * either way, which is the point: the two verbs must not be able to reach different verdicts.
 */
import fs from "node:fs";
import path from "node:path";
import type { IocConfig } from "../config/iocConfig.js";
import { LOCAL_PACKAGE_IDENTIFIER } from "../config/packageIdentifier.js";
import { loadComposedManifestContractNames } from "../generator/loadComposedManifestContracts.js";
import { collectDeclaredGroupNamesForApp } from "../generator/loadComposedManifestGroups.js";
import {
  getDiscoveryTargetFiles,
  loadIocTsconfigContext,
  type IocTsconfigContext,
} from "../generator/iocProgramContext.js";
import { parseGeneratedManifestSource } from "../generator/parseGeneratedManifestSource.js";
import {
  findPackageDirectory,
  readPackageJsonName,
  resolvePackageExportPath,
} from "../generator/resolveComposedPackageExport.js";
import {
  mergeManifestOptionsWithIocConfig,
  resolveManifestOptions,
} from "../generator/manifestOptions.js";
import { buildComposedRegistrationOverridesFromConfig } from "../generator/buildComposedRegistrationOverrides.js";
import { parseInterfacePropertyNames } from "./parseRegistryInterface.js";
import type {
  CompositionContext,
  ParsedGroupRoot,
  ParsedImplementationMeta,
  ParsedManifestSlice,
} from "./types.js";

const readFileUtf8 = (filePath: string): string =>
  fs.readFileSync(filePath, "utf8");

/**
 * Implementation metadata as the composed readers need it, projected off the full parsed record.
 *
 * The election and key-conflict checks read the first three fields; `ioc explain` reads the rest to
 * answer about a composed key without opening the manifest a second time. Everything is copied
 * verbatim and nothing is defaulted — a field the manifest omits stays omitted here, because the
 * whole point of {@link ParsedManifestSlice.declaredFeatures} is that absence is a fact a reader
 * has to be able to see.
 */
const projectContracts = (
  contracts: ReturnType<typeof parseGeneratedManifestSource>["contracts"],
): Record<string, Record<string, ParsedImplementationMeta>> => {
  const out: Record<string, Record<string, ParsedImplementationMeta>> = {};
  for (const [contractName, impls] of Object.entries(contracts)) {
    const byImpl: Record<string, ParsedImplementationMeta> = {};
    for (const [implementationName, meta] of Object.entries(impls)) {
      byImpl[implementationName] = {
        registrationKey: meta.registrationKey,
        ...(meta.default === true ? { default: true as const } : {}),
        ...(meta.accessKey !== undefined ? { accessKey: meta.accessKey } : {}),
        exportName: meta.exportName,
        modulePath: meta.modulePath,
        implementationName: meta.implementationName,
        lifetime: meta.lifetime,
        ...(meta.lifetimeSource !== undefined
          ? { lifetimeSource: meta.lifetimeSource }
          : {}),
        ...(meta.dependencyKeys !== undefined
          ? { dependencyKeys: meta.dependencyKeys }
          : {}),
      };
    }
    out[contractName] = byImpl;
  }
  return out;
};

/**
 * Group roots verbatim, members included.
 *
 * Members carry their `contractName` here, which the retired validate-only parser dropped — and
 * that omission was load-bearing: the grouped-⇒-group-only rule vacates default-ambiguity for a
 * grouped contract by reading member contract names off these roots, so through validate it only
 * ever recognised the base type itself as grouped.
 */
const projectGroupRoots = (
  groupRoots: ReturnType<typeof parseGeneratedManifestSource>["groupRoots"],
): Record<string, ParsedGroupRoot> => {
  const out: Record<string, ParsedGroupRoot> = {};
  for (const [groupName, root] of Object.entries(groupRoots)) {
    out[groupName] = {
      kind: root.kind,
      baseType: root.baseType,
      baseTypeId: root.baseTypeId,
      members: root.members,
    };
  }
  return out;
};

/**
 * One slice from manifest + registry-types SOURCE TEXT, whatever produced it.
 *
 * Exported because it is the projection boundary — the point where the full parsed manifest is
 * narrowed to what the checks read — and that narrowing is worth pinning directly.
 */
export const buildCompositionSlice = (
  packageLabel: string,
  sourceId: string,
  manifestPath: string,
  manifestContent: string,
  typesPath: string,
  typesContent: string,
): ParsedManifestSlice => {
  const parsed = parseGeneratedManifestSource(manifestContent, manifestPath);
  const cradleProps = parseInterfacePropertyNames(
    typesContent,
    typesPath,
    "IocGeneratedCradle",
  );
  const externalProps = parseInterfacePropertyNames(
    typesContent,
    typesPath,
    "IocExternals",
  );

  const externals: Record<string, { typeText: string }> = {};
  for (const [key, typeText] of externalProps) {
    externals[key] = { typeText };
  }

  const cradleTypes: Record<string, { typeText: string }> = {};
  for (const [key, typeText] of cradleProps) {
    cradleTypes[key] = { typeText };
  }

  return {
    packageLabel,
    sourceId,
    manifestPath,
    typesPath,
    manifestSchemaVersion: parsed.manifestSchemaVersion,
    declaredFeatures: parsed.declaredFeatures,
    contracts: projectContracts(parsed.contracts),
    groupRoots: projectGroupRoots(parsed.groupRoots),
    cradleKeys: new Set(cradleProps.keys()),
    cradleTypes,
    externals,
  };
};

const loadSliceFromPaths = (
  packageLabel: string,
  sourceId: string,
  manifestPath: string,
  typesPath: string,
): ParsedManifestSlice =>
  buildCompositionSlice(
    packageLabel,
    sourceId,
    manifestPath,
    readFileUtf8(manifestPath),
    typesPath,
    readFileUtf8(typesPath),
  );

/**
 * The local package's artifacts as `ioc generate` is about to write them.
 *
 * Supplied only by generation. Generation must judge the output of THIS run: the files on disk
 * are the previous run's, and adjudicating those would either clear a composition error the new
 * output introduces or fail on one the new output fixes.
 */
export type PendingLocalArtifacts = {
  readonly manifestPath: string;
  readonly manifestSource: string;
  readonly typesPath: string;
  readonly typesSource: string;
  /** `ioc-composed.ts`, when app mode emits one. In the overlay so the program sees this run's. */
  readonly composedPath?: string;
  readonly composedSource?: string;
};

export type LoadCompositionContextInput = {
  readonly projectRoot: string;
  readonly configPath: string;
  readonly config: IocConfig;
  readonly pendingLocalArtifacts?: PendingLocalArtifacts;
  /**
   * The app's source files. Generation passes the discovery targets it already resolved; validate
   * omits this and the loader resolves the identical set from the same config, so neither verb can
   * end up judging a differently-shaped program.
   */
  readonly sourceFiles?: readonly string[];
  readonly tsconfig?: IocTsconfigContext;
};

export type LoadCompositionContextResult =
  | { readonly ok: true; readonly context: CompositionContext }
  | {
      readonly ok: false;
      readonly message: string;
      readonly detail?: string;
    };

export const loadCompositionContext = async (
  input: LoadCompositionContextInput,
): Promise<LoadCompositionContextResult> => {
  const { projectRoot, configPath, config } = input;
  const composedPackageNames = config.composedManifests ?? [];
  const tsconfigContext = input.tsconfig ?? loadIocTsconfigContext(projectRoot);
  const base = resolveManifestOptions({ paths: { projectRoot } });
  const options = mergeManifestOptionsWithIocConfig(base, config);

  const localLabel =
    typeof config.packageName === "string" && config.packageName.length > 0
      ? config.packageName
      : LOCAL_PACKAGE_IDENTIFIER;

  const pending = input.pendingLocalArtifacts;
  const localManifestPath = pending?.manifestPath ?? options.paths.manifestOutPath;
  const localTypesPath =
    pending?.typesPath ??
    path.join(options.paths.generatedDir, "ioc-registry.types.ts");

  if (pending === undefined) {
    if (!fs.existsSync(localManifestPath)) {
      return {
        ok: false,
        message: `Local manifest not found at ${JSON.stringify(localManifestPath)}`,
        detail: "Run `ioc generate` in this package before `ioc validate`.",
      };
    }
    if (!fs.existsSync(localTypesPath)) {
      return {
        ok: false,
        message: `Local types file not found at ${JSON.stringify(localTypesPath)}`,
        detail: "Run `ioc generate` in this package before `ioc validate`.",
      };
    }
  }

  const slices: ParsedManifestSlice[] = [
    pending !== undefined
      ? buildCompositionSlice(
          localLabel,
          LOCAL_PACKAGE_IDENTIFIER,
          localManifestPath,
          pending.manifestSource,
          localTypesPath,
          pending.typesSource,
        )
      : loadSliceFromPaths(
          localLabel,
          LOCAL_PACKAGE_IDENTIFIER,
          localManifestPath,
          localTypesPath,
        ),
  ];

  for (const packageName of composedPackageNames) {
    try {
      const manifestPath = resolvePackageExportPath(
        projectRoot,
        packageName,
        "./iocManifest",
        { customConditions: tsconfigContext.customConditions },
      );
      const typesPath = resolvePackageExportPath(
        projectRoot,
        packageName,
        "./iocTypes",
        { customConditions: tsconfigContext.customConditions },
      );
      const pkgRoot = findPackageDirectory(projectRoot, packageName);
      const label = readPackageJsonName(pkgRoot, packageName);

      slices.push(
        loadSliceFromPaths(label, packageName, manifestPath, typesPath),
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message,
        detail: `Ensure ${JSON.stringify(packageName)} is installed, exports ./iocManifest and ./iocTypes, and has run \`ioc generate\`.`,
      };
    }
  }

  const composedContractNames = new Set<string>();
  try {
    const loaded = await loadComposedManifestContractNames(
      projectRoot,
      composedPackageNames,
      tsconfigContext.customConditions,
    );
    for (const name of loaded.all) {
      composedContractNames.add(name);
    }
  } catch {
    for (const slice of slices.slice(1)) {
      for (const name of Object.keys(slice.contracts)) {
        composedContractNames.add(name);
      }
    }
  }

  const localContractNames = new Set(
    Object.keys(slices[0]!.contracts),
  );

  const declaredGroupNames = await collectDeclaredGroupNamesForApp(
    projectRoot,
    config,
    tsconfigContext.customConditions,
  );

  const sourceFiles =
    input.sourceFiles ??
    (await getDiscoveryTargetFiles(
      options.paths.scanDirs,
      options.includePatterns,
      options.excludePatterns,
      options.paths.generatedDir,
    ));

  const pendingArtifacts =
    pending === undefined
      ? undefined
      : new Map<string, string>([
          [pending.manifestPath, pending.manifestSource],
          [pending.typesPath, pending.typesSource],
          ...(pending.composedPath !== undefined &&
          pending.composedSource !== undefined
            ? ([[pending.composedPath, pending.composedSource]] as const)
            : []),
        ]);

  return {
    ok: true,
    context: {
      projectRoot,
      configPath,
      slices,
      sourceFiles,
      pendingArtifacts,
      tsconfig: tsconfigContext,
      composedPackageNames,
      overrides: buildComposedRegistrationOverridesFromConfig(config),
      localContractNames,
      composedContractNames,
      declaredGroupNames,
    },
  };
};
