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

/**
 * One external key whose obligation is met at a scope boundary rather than on the root cradle.
 *
 * The assertion for such a key MOVES rather than vanishes: it is dropped from the `AppCradle` pick —
 * where it could only ever be false, since a value bound at scope-open never enters the root cradle —
 * and re-asserted against each reaching variant's emitted opener signature.
 *
 * Deliberately stated as `(key, reaching openers)` and nothing more. The emitter has no idea WHY a
 * key relocated, which is the point: three separate mechanisms clear keys today — scope-reachability,
 * `scopeProvided`, and the variant-lbv exclusion in `scopeRootExternalsExclusion.ts` — and the latter
 * two currently drop the obligation with no replacement guard at all. Converging them onto this
 * emitter should be plumbing, not a rewrite, so the shape is theirs to fill too.
 */
export type RelocatedExternalAssertion = {
  readonly key: string;
  /**
   * Cradle keys of the openers that must carry {@link key} — those whose variant DECLARES it.
   *
   * Empty is legal and means one specific thing: the key is satisfied by an explicit
   * `scopeProvided` declaration rather than by any variant's late-bound-value set. Such a key is
   * registered onto the child scope by hand at runtime and never travels through an opener's
   * parameter, so there is no signature to assert against — and asserting against one would fail a
   * build that is correct. That is the same guard `scopeProvided` has always declined to offer;
   * this type does not invent a new one for it.
   */
  readonly reachingOpenerKeys: readonly string[];
};

export type ComposedPackageSpec = {
  readonly packageName: string;
  readonly identifier: string;
  readonly externalKeys: readonly string[];
  /**
   * Keys from {@link externalKeys} whose assertion relocates to a scope boundary.
   *
   * Absent or empty leaves emission exactly as it was, which is what keeps output byte-identical
   * for every composition that clears nothing.
   */
  readonly relocatedExternals?: readonly RelocatedExternalAssertion[];
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

const tsPropertyAccessKey = (key: string): string =>
  /^[a-zA-Z_$][\w$]*$/.test(key) ? JSON.stringify(key) : JSON.stringify(key);

const externalKeyToAssertionSuffix = (key: string): string => {
  if (/^[a-zA-Z_$][\w$]*$/.test(key)) {
    return key;
  }
  const sanitized = key.replace(/[^\w$]/g, "_");
  return /^[0-9]/.test(sanitized) ? `_${sanitized}` : sanitized;
};

/**
 * What the `AppCradle` pick may name.
 *
 * `keyof XExternals` when nothing relocated — byte-for-byte what this emitter has always written —
 * and an explicit union otherwise. The literal form is not cosmetic: `Pick<T, K>` requires
 * `K extends keyof T`, so leaving a relocated key inside `keyof XExternals` errors AT THE PICK,
 * before any per-key assertion gets a chance to say something useful. Narrowing the pick is
 * therefore required under any design that clears a key at all.
 */
const externalsPickKeys = (
  spec: ComposedPackageSpec,
  cap: string,
  cradleAssertedKeys: readonly string[],
): string =>
  cradleAssertedKeys.length === spec.externalKeys.length
    ? `keyof ${cap}Externals`
    : cradleAssertedKeys.map((key) => tsPropertyAccessKey(key)).join(" | ");

/**
 * The relocated assertion: the obligation, restated where it is actually owed.
 *
 * Read it as "the opener's late-bound-value parameter carries this key, with a type the demanding
 * package accepts". Three things make it the shape it is:
 *
 * - `Parameters<…>[0]` rather than a named alias, because the opener is reached through the cradle
 *   and the cradle is what both halves of this file already agree on.
 * - `extends { key: infer T }` rather than a direct index, because a variant with an EMPTY declared
 *   set emits `() => …`, whose `Parameters<…>[0]` is `undefined` — indexing that is a compiler
 *   error about the wrong thing, where this form is cleanly `false`.
 * - `T extends Externals[key]`, supplied extends demanded, the same direction every other
 *   satisfaction check in this codebase runs.
 *
 * It is also the only comparison in the toolchain that can be made at all: `verifyScopeRoots`
 * type-checks a declared lbv against LOCAL demand sites, and returns early for composed units
 * because a manifest records demand KEYS and never demand TYPES. Here both types are in scope.
 *
 * ### Why the failure branches are objects and not `false`
 *
 * A conditional type that collapses to `false` produces exactly one diagnostic — `Type 'false' does
 * not satisfy the constraint 'true'` — for every way of being wrong. This assertion has two, and
 * they have different fixes: the opener does not declare the key at all, or it declares it with a
 * type the demanding package will not accept. A reader cannot tell them apart from the message, and
 * with the cited line pointing at an `_IocExpect<…>` instantiation there is nothing else to read.
 *
 * So each branch fails to a literal object type naming the cause, the key, the opener and the
 * package, and TypeScript prints that object in the diagnostic. The constraint is unchanged —
 * anything that is not `true` still fails — and only the shape of the failure is different.
 */
const relocationFailureType = (
  reason: string,
  key: string,
  openerKey: string,
  packageName: string,
): string =>
  `{ iocError: ${JSON.stringify(reason)}; key: ${JSON.stringify(key)}; opener: ${JSON.stringify(openerKey)}; package: ${JSON.stringify(packageName)} }`;

const buildRelocatedAssertionLines = (
  spec: ComposedPackageSpec,
  cap: string,
  relocated: readonly RelocatedExternalAssertion[],
): string[] => {
  const lines: string[] = [];

  for (const entry of relocated) {
    const keySuffix = externalKeyToAssertionSuffix(entry.key);
    const keyAccess = tsPropertyAccessKey(entry.key);

    lines.push(
      `// ${JSON.stringify(entry.key)} is carried at the scope boundary, not by the root container —`,
      `// each assertion below reads the declared late-bound values of one opener that resolves it.`,
    );

    for (const openerKey of entry.reachingOpenerKeys) {
      const alias = `_${cap}_${keySuffix}_at_${externalKeyToAssertionSuffix(openerKey)}`;
      const notDeclared = relocationFailureType(
        "this scope opener does not declare the key",
        entry.key,
        openerKey,
        spec.packageName,
      );
      const wrongType = relocationFailureType(
        "the declared late-bound value is not assignable to the demanded type",
        entry.key,
        openerKey,
        spec.packageName,
      );
      lines.push(
        `type ${alias} = Parameters<AppCradle[${tsPropertyAccessKey(openerKey)}]>[0] extends { ${keyAccess}: infer T } ? (T extends ${cap}Externals[${keyAccess}] ? true : ${wrongType}) : ${notDeclared};`,
        `type ${alias}Assert = _IocExpect<${alias}>;`,
      );
    }
  }

  return lines;
};

const buildExternalsAssertionLines = (
  specs: readonly ComposedPackageSpec[],
): string[] => {
  const appCradle = "AppCradle";
  const lines: string[] = ["type _IocExpect<T extends true> = T;"];

  for (const spec of specs) {
    if (spec.externalKeys.length === 0) {
      continue;
    }

    const relocated = spec.relocatedExternals ?? [];
    const relocatedKeys = new Set(relocated.map((entry) => entry.key));
    const cradleAssertedKeys = spec.externalKeys.filter(
      (key) => !relocatedKeys.has(key),
    );

    const cap = capitalizeIdentifier(spec.identifier);
    const pickAlias = `_${cap}ExternalsPick`;

    if (cradleAssertedKeys.length > 0) {
      lines.push(
        `// If any assertion below is \`false\`, run \`ioc validate\` for a detailed per-key explanation.`,
        `type ${pickAlias} = Pick<${appCradle}, ${externalsPickKeys(spec, cap, cradleAssertedKeys)}>;`,
      );
    }

    for (const externalKey of cradleAssertedKeys) {
      const suffix = externalKeyToAssertionSuffix(externalKey);
      const keyAccess = tsPropertyAccessKey(externalKey);
      const satisfied = `_${cap}_${suffix}`;
      lines.push(
        `type ${satisfied} = ${pickAlias}[${keyAccess}] extends ${cap}Externals[${keyAccess}] ? true : false;`,
        `type ${satisfied}Assert = _IocExpect<${satisfied}>;`,
      );
    }

    lines.push(...buildRelocatedAssertionLines(spec, cap, relocated));
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
  const aliasSets = overrides?.groups?.baseTypeAliases;
  const hasAliases =
    aliasSets !== undefined && Object.keys(aliasSets).length > 0;

  if (!hasContracts && !hasPackages && !hasAliases) {
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
    if (hasAliases) {
      contractLines.push("  groups: {");
      contractLines.push("    baseTypeAliases: {");
      const groupNames = Object.keys(aliasSets!).sort((a, b) =>
        a.localeCompare(b),
      );
      for (const groupName of groupNames) {
        const ids = aliasSets![groupName]!.map((id) => JSON.stringify(id));
        contractLines.push(
          `      ${JSON.stringify(groupName)}: [${ids.join(", ")}],`,
        );
      }
      contractLines.push("    },");
      contractLines.push("  },");
    }
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

  contractLines.push("  },");

  if (hasAliases) {
    contractLines.push("  groups: {");
    contractLines.push("    baseTypeAliases: {");
    const groupNames = Object.keys(aliasSets!).sort((a, b) =>
      a.localeCompare(b),
    );
    for (const groupName of groupNames) {
      const ids = aliasSets![groupName]!.map((id) => JSON.stringify(id));
      contractLines.push(
        `      ${JSON.stringify(groupName)}: [${ids.join(", ")}],`,
      );
    }
    contractLines.push("    },");
    contractLines.push("  },");
  }

  contractLines.push("} as const satisfies ComposedRegistrationOverrides;");
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

/** Package identifiers only — use {@link loadComposedPackageSpecs} when external keys are needed. */
export const resolveComposedPackageSpecs = (
  composedManifests: readonly string[],
): ComposedPackageSpec[] =>
  composedManifests.map((packageName) => ({
    packageName,
    identifier: packageNameToIdentifier(packageName),
    externalKeys: [],
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
