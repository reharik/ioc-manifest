/**
 * @fileoverview Scope-root stage 3: the emitted **opener**.
 *
 * A scope is a container (design doc, "The framing"). The root container is created once, supplied
 * its late-bound values at composition, and reached through a generated typed surface; an opened
 * scope is created N times, supplied its late-bound values at open, and reached through the
 * opener's typed return. This module turns each verified scope-root variant into that opener: a
 * unit registered in the cradle under its own key, whose one parameter is the variant's DECLARED
 * lbv and whose return is the eagerly-resolved variant plus a disposer.
 *
 * Two disciplines carry over from verification and are load-bearing here:
 *
 * - **Declared, not derived.** The opener's parameter members are the properties of the declared
 *   `TLbv` type argument, emitted by reference through the ordinary emission seam. Nothing about
 *   the resolution subtree reaches the signature.
 * - **Per variant.** Everything here takes one variant at a time. Nothing in this module reasons
 *   across variants; the one place that happens is `scopeRootExternalsExclusion.ts`, which decides
 *   emission only and is never consulted by verification.
 */
import ts from "typescript";
import type {
  IocGroupsManifest,
  IocUnitKind,
  ScopeRootVariantManifestMetadata,
} from "../core/manifest.js";
import {
  cradleTypeImportUsesDefaultExport,
  resolveContractTypeSourceFile,
} from "./contractTypeSourceFile.js";
import {
  tryEmitTypeReference,
  type EmitTypeReferenceContext,
  type EmittedTypeReference,
  type TypeImportSpec,
} from "./emit/index.js";
import type { ResolvedScanDir } from "./manifestPaths.js";
import { openerKeyToTypeAliasName, variantNameToOpenerKey } from "./naming.js";
import type { ResolvedContractRegistration } from "./resolveRegistrationPlan.js";
import type { DiscoveredFactory, DiscoveredScopeRoot } from "./types.js";

/** One declared late-bound value, with its type resolved to an importable reference. */
export type ScopeRootOpenerLbvMember = {
  key: string;
  typeRef: EmittedTypeReference;
};

/** Everything emission needs for one variant's opener. */
export type ScopeRootOpener = {
  contractName: string;
  variantName: string;
  exportName: string;
  modulePath: string;
  relImport: string;
  unitKind: IocUnitKind;
  /** Cradle key the opener is registered under. */
  openerKey: string;
  /** Exported type alias name for the opener's function type. */
  openerTypeName: string;
  /** Key the variant is registered (and resolved) under inside the opened child scope. */
  variantKey: string;
  /** Root contract, emitted by reference — the opener's return member type. */
  contractTypeRef: EmittedTypeReference;
  /** Declared lbv members, sorted by key. */
  lbvMembers: readonly ScopeRootOpenerLbvMember[];
};

export type ScopeRootOpenerBuildContext = {
  program: ts.Program;
  projectRoot: string;
  scanDirs: ResolvedScanDir[];
  generatedDir: string;
};

/**
 * The disposer's shape, emitted verbatim into the opener type.
 *
 * Async because Awilix's own `AwilixContainer.dispose()` returns `Promise<void>` — the emitted
 * disposer is that promise, never a fire-and-forget wrapper around it, so an `await` at the closing
 * site really does wait for the scope's disposers to run. See the runtime note in `bootstrap.ts`.
 */
const DISPOSE_MEMBER_TYPE = "dispose: () => Promise<void>";

/** An lbv type argument with no members still takes an argument — an empty object, not `{}`. */
const EMPTY_LBV_TYPE_TEXT = "Record<string, never>";

const lbvParameterTypeText = (opener: ScopeRootOpener): string =>
  opener.lbvMembers.length === 0
    ? EMPTY_LBV_TYPE_TEXT
    : `{ ${opener.lbvMembers.map((m) => `${m.key}: ${m.typeRef.typeName}`).join("; ")} }`;

/**
 * The opener's full function type.
 *
 * One parameter (the whole declared lbv — no ambient omission, because an injected opener is closed
 * over a statically anonymous scope), and a return carrying the eagerly-resolved variant plus the
 * disposer. No `AwilixContainer` appears in either position: the opener IS the sanctioned
 * scope-resolver handle, which is what lets it sit in a deps position at all.
 */
export const openerFunctionTypeText = (opener: ScopeRootOpener): string =>
  `(lbv: ${lbvParameterTypeText(opener)}) => { ${opener.variantKey}: ${opener.contractTypeRef.typeName}; ${DISPOSE_MEMBER_TYPE} }`;

/** Every import the opener's emitted type pulls in, contract first. */
export const openerTypeImports = (
  opener: ScopeRootOpener,
): readonly TypeImportSpec[] => [
  ...opener.contractTypeRef.imports,
  ...opener.lbvMembers.flatMap((member) => member.typeRef.imports),
];

const contractTypeRefForVariant = (
  variant: DiscoveredScopeRoot,
  ctx: ScopeRootOpenerBuildContext,
): EmittedTypeReference => {
  const sourceFile = resolveContractTypeSourceFile(
    ctx.program,
    ctx.generatedDir,
    variant.contractTypeRelImport,
    ctx.scanDirs,
    variant.contractName,
  );
  const useDefaultImport =
    sourceFile !== undefined &&
    cradleTypeImportUsesDefaultExport(sourceFile, variant.contractName);

  return {
    typeName: variant.contractName,
    imports: [
      {
        typeName: variant.contractName,
        relImport: variant.contractTypeRelImport,
        useDefaultImport,
      },
    ],
  };
};

const formatUnemittableLbvMemberError = (
  variant: DiscoveredScopeRoot,
  key: string,
  detail: string,
): string =>
  [
    `[ioc] Scope root "${variant.contractName}" variant "${variant.variantName}" (export ${JSON.stringify(variant.exportName)} in ${variant.modulePath}): the declared late-bound value ${JSON.stringify(key)} cannot be emitted by reference.`,
    `    ${detail}`,
    `    declared lbv: ${variant.lbvTypeText}`,
    "    The opener's parameter type is emitted by IMPORT, never inlined or structurally expanded — the declared-not-derived discipline applies to emitted text exactly as it applies to verification. Name the value's type with an exported interface or type alias and use that name in the ScopeRoot type argument.",
  ].join("\n");

/**
 * Reads the declared lbv members off ONE variant and resolves each member type to an importable
 * reference.
 *
 * The raw `ts.TypeNode` on the record is never replaced (the same discipline stage 2 keeps): the
 * checker is applied here, at the emission boundary, and the resolved types stay local.
 */
const lbvMembersForVariant = (
  variant: DiscoveredScopeRoot,
  ctx: ScopeRootOpenerBuildContext,
): ScopeRootOpenerLbvMember[] => {
  const checker = ctx.program.getTypeChecker();
  const emitCtx: EmitTypeReferenceContext = {
    program: ctx.program,
    projectRoot: ctx.projectRoot,
    scanDirs: ctx.scanDirs,
    generatedDir: ctx.generatedDir,
    contextSourceFile: variant.lbvTypeNode.getSourceFile(),
  };

  const lbvType = checker.getApparentType(
    checker.getTypeFromTypeNode(variant.lbvTypeNode),
  );

  return checker
    .getPropertiesOfType(lbvType)
    .map((prop) => prop.getName())
    .filter((name) => !name.startsWith("__"))
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const prop = checker.getPropertyOfType(lbvType, key)!;
      const emitted = tryEmitTypeReference(
        checker,
        checker.getTypeOfSymbol(prop),
        emitCtx,
        { propertyName: key },
      );
      if (!emitted.ok) {
        throw new Error(
          formatUnemittableLbvMemberError(variant, key, emitted.message),
        );
      }
      return { key, typeRef: emitted.value };
    });
};

/**
 * One opener per variant, in a deterministic order (contract, then variant).
 *
 * Variants of one root contract each get their own opener — they are not competing registrations
 * for a default slot, they are different scopes, so the ambiguous-default problem is unasked here
 * rather than solved.
 */
export const buildScopeRootOpeners = (
  scopeRoots: readonly DiscoveredScopeRoot[],
  ctx: ScopeRootOpenerBuildContext,
): ScopeRootOpener[] =>
  [...scopeRoots]
    .sort(
      (a, b) =>
        a.contractName.localeCompare(b.contractName) ||
        a.variantName.localeCompare(b.variantName),
    )
    .map((variant) => {
      const openerKey = variantNameToOpenerKey(variant.variantName);
      return {
        contractName: variant.contractName,
        variantName: variant.variantName,
        exportName: variant.exportName,
        modulePath: variant.modulePath,
        relImport: variant.relImport,
        unitKind: variant.unitKind,
        openerKey,
        openerTypeName: openerKeyToTypeAliasName(openerKey),
        // The variant claims no ROOT-cradle key; this is the key it is registered under inside the
        // opened child scope, and the property name the opener returns it as.
        variantKey: variant.variantName,
        contractTypeRef: contractTypeRefForVariant(variant, ctx),
        lbvMembers: lbvMembersForVariant(variant, ctx),
      };
    });

/** Manifest rows for the emitted openers, keyed contract → variant. */
export const openersToManifest = (
  openers: readonly ScopeRootOpener[],
  moduleIndexByPath: ReadonlyMap<string, number>,
): Record<string, Record<string, ScopeRootVariantManifestMetadata>> => {
  const out: Record<
    string,
    Record<string, ScopeRootVariantManifestMetadata>
  > = {};

  for (const opener of openers) {
    const moduleIndex = moduleIndexByPath.get(opener.modulePath);
    if (moduleIndex === undefined) {
      throw new Error(
        `[ioc] internal error: scope-root module path "${opener.modulePath}" missing from module index map`,
      );
    }
    const bucket = out[opener.contractName] ?? {};
    bucket[opener.variantName] = {
      ...(opener.unitKind !== "factory" ? { kind: opener.unitKind } : {}),
      exportName: opener.exportName,
      openerKey: opener.openerKey,
      variantKey: opener.variantKey,
      contractName: opener.contractName,
      variantName: opener.variantName,
      modulePath: opener.modulePath,
      relImport: opener.relImport,
      lbvKeys: opener.lbvMembers.map((m) => m.key),
      moduleIndex,
    };
    out[opener.contractName] = bucket;
  }

  return out;
};

type ContractExclusivityOffender = {
  contractName: string;
  scopeRoot: { exportName: string; modulePath: string };
  registered: { exportName: string; modulePath: string; unitKind: IocUnitKind };
};

const formatContractExclusivityError = (
  offenders: readonly ContractExclusivityOffender[],
): string =>
  [
    `[ioc] ${offenders.length} contract(s) are both scope-rooted and ordinarily registered. A contract is one or the other: allowing both makes \`deps: { defaultRouter: IRouter }\` legal while \`deps: { authRouter: IRouter }\` is not, for reasons invisible at the interface — a split-brain contract. Scope-rooted contracts are opener-only: no variant is reachable through a root-cradle key or a deps position, and a consumer that wants one as a plain dependency is asking for an ordinary factory, which is a different declaration. (The mixed mode — a container default alongside scoped variants — is coherent and deliberately deferred until real usage demands it.)`,
    ...offenders.map(
      (o) =>
        `  - Contract "${o.contractName}": scope root ${JSON.stringify(o.scopeRoot.exportName)} in "${o.scopeRoot.modulePath}" vs ${o.registered.unitKind} ${JSON.stringify(o.registered.exportName)} in "${o.registered.modulePath}"`,
    ),
  ].join("\n");

type OpenerKeyOffender = {
  openerKey: string;
  variant: { contractName: string; variantName: string; exportName: string };
  claimedBy: string;
};

const formatOpenerKeyCollisionError = (
  offenders: readonly OpenerKeyOffender[],
): string =>
  [
    `[ioc] ${offenders.length} emitted scope-root opener key(s) collide with a key that is already claimed. An opener is an ordinary cradle registration, so its key joins the same global namespace every registration key, group root key and reserved manifest key lives in:`,
    ...offenders.map(
      (o) =>
        `  - Opener key ${JSON.stringify(o.openerKey)} for scope root "${o.variant.contractName}" variant "${o.variant.variantName}" (export ${JSON.stringify(o.variant.exportName)}) is already claimed by ${o.claimedBy}. Rename the factory export, or set registrations[<Contract>].<impl>.name on the colliding registration.`,
    ),
  ].join("\n");

export type ScopeRootEmissionValidationContext = {
  acceptedFactories: readonly DiscoveredFactory[];
  plans: readonly ResolvedContractRegistration[];
  groupsManifest?: IocGroupsManifest;
  /** Reserved names on the generated container manifest object itself. */
  reservedManifestKeys: ReadonlySet<string>;
};

export type ScopeRootEmissionValidationResult = {
  contractExclusivityErrors: readonly string[];
  openerKeyErrors: readonly string[];
};

/**
 * Turns on the two collision rules stage 1 deliberately left off, now that scope roots emit.
 *
 * Both aggregate every offender into one error, the same offender-bucket shape discovery uses for
 * invalid annotations and wrong-arity markers, and both honour `tolerateInvalidAnnotations` the way
 * `verifyScopeRootsAtCodegen` does so a listing caller can report instead of dying on the first run.
 *
 * The opener-key check reads its claimed-key set from the SAME sources the group-root key check
 * reads (the registration plan's access and registration keys, plus the group roots and the
 * reserved manifest keys) rather than maintaining a second idea of what a cradle key is. Variant
 * contract keys are absent from all of it, which is not an exemption but a consequence: the
 * variants claim no root-cradle key, so there is nothing for uniqueness to be about.
 */
export const validateScopeRootEmissionAtCodegen = (
  scopeRoots: readonly DiscoveredScopeRoot[],
  openers: readonly ScopeRootOpener[],
  ctx: ScopeRootEmissionValidationContext,
  runOptions?: { tolerateInvalidAnnotations?: boolean },
): ScopeRootEmissionValidationResult => {
  const contractExclusivityOffenders: ContractExclusivityOffender[] = [];
  const registeredByContract = new Map<string, DiscoveredFactory>();
  for (const factory of ctx.acceptedFactories) {
    if (!registeredByContract.has(factory.contractName)) {
      registeredByContract.set(factory.contractName, factory);
    }
  }

  const reportedContracts = new Set<string>();
  for (const variant of scopeRoots) {
    const registered = registeredByContract.get(variant.contractName);
    if (registered === undefined || reportedContracts.has(variant.contractName)) {
      continue;
    }
    reportedContracts.add(variant.contractName);
    contractExclusivityOffenders.push({
      contractName: variant.contractName,
      scopeRoot: {
        exportName: variant.exportName,
        modulePath: variant.modulePath,
      },
      registered: {
        exportName: registered.exportName,
        modulePath: registered.modulePath,
        unitKind: registered.unitKind ?? "factory",
      },
    });
  }

  const claimedBy = new Map<string, string>();
  for (const key of ctx.reservedManifestKeys) {
    claimedBy.set(key, "a reserved key on the generated container manifest");
  }
  for (const plan of ctx.plans) {
    claimedBy.set(
      plan.accessKey,
      `the contract access key of "${plan.contractName}"`,
    );
    for (const impl of plan.implementations) {
      claimedBy.set(
        impl.registrationKey,
        `the registration key of "${plan.contractName}".${impl.implementationName}`,
      );
    }
  }
  for (const groupKey of Object.keys(ctx.groupsManifest ?? {})) {
    claimedBy.set(groupKey, `the group root key ${JSON.stringify(groupKey)}`);
  }

  const openerKeyOffenders: OpenerKeyOffender[] = [];
  for (const opener of openers) {
    const owner = claimedBy.get(opener.openerKey);
    if (owner !== undefined) {
      openerKeyOffenders.push({
        openerKey: opener.openerKey,
        variant: opener,
        claimedBy: owner,
      });
      continue;
    }
    claimedBy.set(
      opener.openerKey,
      `the opener of scope root "${opener.contractName}" variant "${opener.variantName}"`,
    );
  }

  const contractExclusivityErrors =
    contractExclusivityOffenders.length > 0
      ? [formatContractExclusivityError(contractExclusivityOffenders)]
      : [];
  const openerKeyErrors =
    openerKeyOffenders.length > 0
      ? [formatOpenerKeyCollisionError(openerKeyOffenders)]
      : [];

  const errors = [...contractExclusivityErrors, ...openerKeyErrors];
  if (errors.length > 0 && runOptions?.tolerateInvalidAnnotations !== true) {
    throw new Error(errors.join("\n"));
  }

  return { contractExclusivityErrors, openerKeyErrors };
};
