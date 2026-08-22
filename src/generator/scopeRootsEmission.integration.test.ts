/**
 * Scope-root registration units, stage 3a: EMISSION.
 *
 * Pins the parts of `docs/design/scope-roots.md`'s stage-3 section that this repo owns: scope roots
 * joining the demand/supply walk as consumers, the Externals-exclusion union, one opener emitted per
 * variant (key, type alias, by-reference lbv members), and the two collision rules stage 1 left off.
 *
 * The consuming-app migration proof is stage 3b and lives elsewhere.
 */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import type { IocConfig } from "../config/iocConfig.js";
import { analyzeDemandSupply } from "./analyzeDemandSupply/index.js";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import { buildRegistrationPlan } from "./resolveRegistrationPlan.js";
import { contractSlotsForPlans } from "./contractSlotKeys.js";
import {
  buildScopeRootOpeners,
  validateScopeRootEmissionAtCodegen,
} from "./scopeRootOpeners.js";
import { resolveExternalsExclusion } from "./scopeRootExternalsExclusion.js";
import {
  buildScopeRootSupplyIndex,
  verifyScopeRoots,
} from "./verifyScopeRoots.js";
import { buildManifestArtifactSources } from "./writeManifest.js";
import {
  buildDiscoveryReport,
  formatDiscoveryReport,
  formatDiscoveryReportJson,
} from "../inspection/index.js";
import { IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS } from "../core/manifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "test-fixtures", "scope-roots");
const projectRoot = path.resolve(fixtureDir, "../../..");
const srcDir = path.join(projectRoot, "src");
const generatedDir = path.join(srcDir, "generated");
const scanDirs = [{ absPath: srcDir }];
const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
};

const fixture = (name: string): string => path.join(fixtureDir, name);

/** The `IocExternals` declaration out of a generated types source, braces and all. */
const externalsBlockOf = (typesSource: string): string =>
  /export interface IocExternals \{[^}]*\}/.exec(typesSource)?.[0] ?? "";

const scopedSubtree = (
  perContract: Record<string, Record<string, { lifetime?: "scoped" }>>,
  extra?: { scopeProvided?: string[] },
): IocConfig =>
  ({ registrations: perContract, ...extra }) as unknown as IocConfig;

/**
 * Runs the real generation pipeline over a fixture set, up to and including artifact serialization.
 *
 * Deliberately the same call order `generateManifest` uses — discovery, plan, demand/supply with
 * the scope-root join, verification, opener planning, emission — so what is asserted below is what
 * a real `ioc generate` produces rather than a hand-assembled approximation.
 */
const generate = (files: string[], config?: IocConfig) => {
  const program = ts.createProgram({
    rootNames: files,
    options: compilerOptions,
  });
  const { contractMap, acceptedFactories, scopeRoots, discoveryFiles } =
    discoverFactories(
      files,
      program,
      projectRoot,
      "build",
      { projectRoot, scanDirs, generatedDir },
      config,
      { collectFileRecords: true },
    );
  const plans = buildRegistrationPlan(contractMap, config, {
    projectRoot,
    scanDirs,
  });
  const demandSupply = analyzeDemandSupply(acceptedFactories, {
    program,
    projectRoot,
    scanDirs,
    generatedDir,
    scopeProvided: config?.scopeProvided,
    scopeRoots,
    contractSlots: contractSlotsForPlans(plans),
  });
  const verification = verifyScopeRoots(scopeRoots, {
    program,
    projectRoot,
    scanDirs,
    acceptedFactories,
    plans,
    config,
    externalKeys: demandSupply.externalKeys,
  });
  const openers = buildScopeRootOpeners(scopeRoots, {
    program,
    projectRoot,
    scanDirs,
    generatedDir,
  });
  const exclusion = resolveExternalsExclusion({
    variants: verification.variants,
    demandersByKey: demandSupply.demandersByKey,
    acceptedFactories,
    scopeRoots,
    supplyIndex: buildScopeRootSupplyIndex({
      program,
      projectRoot,
      scanDirs,
      acceptedFactories,
      plans,
      config,
    }),
  });
  const externalsExcludedKeys = new Set<string>([
    ...(config?.scopeProvided ?? []),
    ...exclusion.excludedKeys,
  ]);
  const sources = buildManifestArtifactSources(
    acceptedFactories,
    plans,
    undefined,
    manifestOutPath,
    "ioc-manifest",
    {
      demandSupply,
      registryTypesBuildContext: {
        program,
        generatedDir,
        scanDirs,
        projectRoot,
      },
      scopeRootOpeners: openers,
      externalsExcludedKeys,
    },
  );

  return {
    program,
    acceptedFactories,
    scopeRoots,
    discoveryFiles,
    plans,
    demandSupply,
    verification,
    openers,
    exclusion,
    externalsExcludedKeys,
    sources,
    validateEmission: (
      runOptions?: { tolerateInvalidAnnotations?: boolean },
    ) =>
      validateScopeRootEmissionAtCodegen(
        scopeRoots,
        openers,
        {
          acceptedFactories,
          plans,
          reservedManifestKeys: IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS,
        },
        runOptions,
      ),
  };
};

const emissionFixtures = (): string[] => [
  fixture("deps-contracts.ts"),
  fixture("emission.ts"),
];

const emissionConfig = scopedSubtree({
  IAuditLog: { emissionAudit: { lifetime: "scoped" } },
});

const divergenceFixtures = (): string[] => [
  fixture("deps-contracts.ts"),
  fixture("per-variant-union.ts"),
];

const divergenceConfig = scopedSubtree({
  IAuditLog: { tokenAudit: { lifetime: "scoped" } },
});

/** Base + zero or more outside demanders; the difference between them is the predicate. */
const outsideDemanderFixtures = (...extra: string[]): string[] => [
  fixture("deps-contracts.ts"),
  fixture("outside-demander.ts"),
  ...extra.map(fixture),
];

const outsideDemanderConfig = scopedSubtree({
  IAuditLog: { taggedAudit: { lifetime: "scoped" } },
});

describe("scope-root registration units (stage 3a: opener emission)", () => {
  describe("When scope roots join the demand–supply walk", () => {
    it("should surface a root-own demand nothing supplies as an external", () => {
      const { demandSupply, sources } = generate([
        fixture("deps-contracts.ts"),
        fixture("root-own-external.ts"),
      ]);

      // Demanded by the scope-root unit itself, declared in no lbv, built by nothing. Stage 2 could
      // not see it at all; now it is an ordinary unregistered demand.
      assert.ok(demandSupply.externalKeys.includes("tenantContext"));
      assert.match(
        sources.typesSource,
        /export interface IocExternals \{\n {2}tenantContext: TenantContext;\n\}/,
      );
    });

    it("should not let the root claim a cradle key or supply anything", () => {
      const { demandSupply, sources } = generate([
        fixture("deps-contracts.ts"),
        fixture("root-own-external.ts"),
      ]);

      // The variant supplies nothing: no entry under its own name, and no cradle property.
      assert.ok(!demandSupply.entries.some((e) => e.key === "tenantRouter"));
      assert.ok(!/^ {2}tenantRouter:/m.test(sources.typesSource));
      // The contract is nowhere in the cradle either — scope-rooted contracts are opener-only.
      assert.ok(!/^ {2}requestRouter:/m.test(sources.typesSource));
    });

    it("should stop the root-own demand from failing verification once it is external", () => {
      const { verification } = generate([
        fixture("deps-contracts.ts"),
        fixture("root-own-external.ts"),
      ]);

      // Membership, not elimination: the key is external because the (now complete) demand/supply
      // pass says so, which is the same rule stage 2 shipped.
      const variant = verification.variants[0]!;
      assert.strictEqual(variant.satisfied, true);
      assert.deepStrictEqual(variant.scopeDemands, []);
      assert.deepStrictEqual(verification.errors, []);
    });
  });

  describe("When a key is declared in a variant's lbv", () => {
    it("should exclude it from Externals emission with scopeProvided empty", () => {
      const { demandSupply, sources } = generate(
        emissionFixtures(),
        emissionConfig,
      );

      // Both keys ARE externals as far as classification is concerned — the config declares no
      // `scopeProvided` at all, so the exclusion can only be coming from the declared lbv sets.
      assert.deepStrictEqual([...demandSupply.externalKeys].sort(), [
        "principal",
        "uow",
      ]);
      assert.deepStrictEqual(demandSupply.scopeProvidedKeys, []);
      assert.match(sources.typesSource, /export interface IocExternals \{\}/);
    });

    it("should drop the excluded key's imports with it", () => {
      const { sources } = generate(emissionFixtures(), emissionConfig);

      // `Principal` and `UnitOfWork` still reach the file — but through the opener types that use
      // them, not through an `IocExternals` member that no longer exists. An import left behind by
      // an excluded entry would be a name nothing references.
      const importLines = sources.typesSource
        .split("\n")
        .filter((line) => line.startsWith("import "));
      assert.strictEqual(importLines.length, 1);
      assert.match(importLines[0]!, /IAuditLog, IRequestRouter, Principal, UnitOfWork/);
    });

    it("should keep the union out of verification entirely", () => {
      // The load-bearing case: one variant declares `sessionToken`, the other consumes it from the
      // container. If the Externals-exclusion union ever reached the supply index, the inheriting
      // variant would be told to declare a key ANOTHER variant declared — the exact cross-variant
      // reasoning the per-variant rule exists to forbid.
      const { verification, demandSupply } = generate(
        divergenceFixtures(),
        divergenceConfig,
      );

      assert.ok(demandSupply.externalKeys.includes("sessionToken"));

      const byVariant = new Map(
        verification.variants.map((v) => [v.variantName, v]),
      );

      const declaring = byVariant.get("declaringRouter")!;
      assert.strictEqual(declaring.satisfied, true);
      assert.deepStrictEqual(
        declaring.scopeDemands.map((d) => [d.key, d.satisfiedBy]),
        [
          ["requestId", "declared-lbv"],
          ["sessionToken", "declared-lbv"],
        ],
      );

      const inheriting = byVariant.get("inheritingRouter")!;
      assert.strictEqual(inheriting.satisfied, true);
      assert.deepStrictEqual(inheriting.scopeDemands, []);
      assert.deepStrictEqual(inheriting.findings, []);
      assert.deepStrictEqual(verification.errors, []);
    });
  });

  describe("When one variant declares a key another consumes from the container", () => {
    it("should hold the key back from the exclusion union", () => {
      const { externalsExcludedKeys } = generate(
        divergenceFixtures(),
        divergenceConfig,
      );

      // `sessionToken` is declared — but `inheritingRouter` demands it without declaring it, so the
      // container is still the thing that has to supply it.
      assert.ok(!externalsExcludedKeys.has("sessionToken"));
      // `requestId` is the control: declared by the same variant, demanded by no other. Nothing
      // consumes it from the container, so the declaration stands on its own.
      assert.ok(externalsExcludedKeys.has("requestId"));
    });

    it("should keep asking the app for the key, imports and all", () => {
      const { sources } = generate(divergenceFixtures(), divergenceConfig);

      // The whole point of the refinement: exclusion must not delete the supply the non-declaring
      // variant depends on. Removing it here would move the failure from a composition-time type
      // error to a resolution error in production.
      assert.match(
        sources.typesSource,
        /export interface IocExternals \{\n {2}sessionToken: SessionToken;\n\}/,
      );
      assert.match(
        sources.typesSource,
        /^import type \{[^}]*SessionToken[^}]*\} from "[^"]*per-variant-union\.js";$/m,
      );
    });

    it("should still exclude the key no other variant demands", () => {
      const { sources } = generate(divergenceFixtures(), divergenceConfig);

      // Ruling 4 intact: a declaration nobody contradicts means the config never repeats it. The
      // key appears in no interface — not `IocExternals`, not the cradle, not `IocScopeProvided`.
      assert.ok(!/^ {2}requestId:/m.test(sources.typesSource));
      // It is still in the opener's signature, which is where the caller is asked for it.
      assert.match(
        sources.typesSource,
        /export type OpenDeclaringRouterScope = \(lbv: \{ requestId: RequestId; sessionToken: SessionToken \}\)/,
      );
    });

    it("should exclude a scopeProvided key regardless of who demands it undeclared", () => {
      // An explicit config statement outranks the inference drawn from other variants: if someone
      // writes the divergence into `scopeProvided` by hand, that is the existing scopeProvided
      // contract, not this feature's business.
      const { externalsExcludedKeys, sources } = generate(
        divergenceFixtures(),
        scopedSubtree(
          { IAuditLog: { tokenAudit: { lifetime: "scoped" } } },
          { scopeProvided: ["sessionToken"] },
        ),
      );

      assert.ok(externalsExcludedKeys.has("sessionToken"));
      assert.match(sources.typesSource, /export interface IocExternals \{\}/);
      assert.match(
        sources.typesSource,
        /export interface IocScopeProvided \{\n {2}sessionToken: SessionToken;\n\}/,
      );
    });
  });

  describe("When a demand of a declared key sits outside every declaring subtree", () => {
    it("should exclude the key while the declaring subtree holds every demand", () => {
      const { exclusion, sources } = generate(
        outsideDemanderFixtures(),
        outsideDemanderConfig,
      );

      // The control half of the pair: one declaring variant, one demander, and that demander is
      // under it. The declaration speaks for the whole story.
      assert.ok(exclusion.excludedKeys.has("auditContext"));
      assert.deepStrictEqual(exclusion.sharedSubtreeUnits, []);
      assert.match(sources.typesSource, /export interface IocExternals \{\}/);
    });

    it("should keep the key for an ordinary factory that demands it from outside", () => {
      const { exclusion, sources } = generate(
        outsideDemanderFixtures("outside-direct-consumer.ts"),
        outsideDemanderConfig,
      );

      // One added unit is the entire difference from the test above. It is not a variant, not a
      // class, just an ordinary factory — and it resolves the key from the container, so the
      // container has to be asked for it.
      assert.ok(!exclusion.excludedKeys.has("auditContext"));
      assert.deepStrictEqual(exclusion.sharedSubtreeUnits, []);
      assert.match(
        sources.typesSource,
        /export interface IocExternals \{\n {2}auditContext: AuditContext;\n\}/,
      );
      assert.match(
        sources.typesSource,
        /^import type \{[^}]*AuditContext[^}]*\} from "[^"]*outside-demander\.js";$/m,
      );
    });

    it("should keep the key when the demanding unit is reachable from outside too", () => {
      const { exclusion, sources } = generate(
        outsideDemanderFixtures("outside-shared-consumer.ts"),
        outsideDemanderConfig,
      );

      // `taggedAudit` is inside the declaring subtree AND reachable from an outside consumer, so
      // the same unit resolves the key from the opener in one container and from the root in
      // another. Counted as outside: an extra `Externals` entry is the cheap wrong answer, a
      // missing supply is the expensive one.
      assert.ok(!exclusion.excludedKeys.has("auditContext"));
      assert.match(
        sources.typesSource,
        /export interface IocExternals \{\n {2}auditContext: AuditContext;\n\}/,
      );
    });

    it("should record the shared unit by name so a migration can find it", () => {
      const { exclusion } = generate(
        outsideDemanderFixtures("outside-shared-consumer.ts"),
        outsideDemanderConfig,
      );

      assert.strictEqual(exclusion.sharedSubtreeUnits.length, 1);
      const note = exclusion.sharedSubtreeUnits[0]!;
      assert.strictEqual(note.key, "auditContext");
      assert.strictEqual(note.exportName, "buildTaggedAudit");
      assert.match(note.modulePath, /outside-demander\.ts$/);
      assert.deepStrictEqual(note.declaringVariants, ["scopedRouter"]);
    });

    it("should name the shared unit in --discovery and its JSON", () => {
      const { discoveryFiles, scopeRoots, verification, exclusion } = generate(
        outsideDemanderFixtures("outside-shared-consumer.ts"),
        outsideDemanderConfig,
      );

      const report = buildDiscoveryReport({
        discoveryFiles,
        scopeRoots,
        scopeRootVerification: verification,
        scopeRootSharedUnits: exclusion.sharedSubtreeUnits,
      });

      assert.deepStrictEqual(
        report.scopeRootSharedUnits,
        exclusion.sharedSubtreeUnits,
      );

      // Recorded, not diagnosed: one line naming the unit and the key, so a migration can find real
      // instances instead of deducing them from an unexpected externals entry.
      const text = formatDiscoveryReport(report, { color: false });
      assert.match(text, /Shared scope-root units:/);
      assert.match(
        text,
        /buildTaggedAudit .*demands auditContext inside scopedRouter and is reachable from outside it/,
      );

      const json = JSON.parse(formatDiscoveryReportJson(report)) as {
        scopeRootSharedUnits: { key: string; exportName: string }[];
      };
      assert.deepStrictEqual(
        json.scopeRootSharedUnits.map((u) => [u.exportName, u.key]),
        [["buildTaggedAudit", "auditContext"]],
      );
    });

    it("should still exclude a key whose only outside-reachable units do not demand it", () => {
      // Sanity on the granularity: sharing is judged per demanding unit, not per subtree. If
      // reachability were judged at subtree granularity, every lbv key in a real app would be held
      // back the moment any root singleton touched anything under the router.
      const { exclusion } = generate(
        emissionFixtures(),
        emissionConfig,
      );

      assert.ok(exclusion.excludedKeys.has("principal"));
      assert.ok(exclusion.excludedKeys.has("uow"));
      assert.deepStrictEqual(exclusion.sharedSubtreeUnits, []);
    });
  });

  describe("When openers are emitted", () => {
    it("should emit one per variant, keyed and named by the variant identity", () => {
      const { openers } = generate(emissionFixtures(), emissionConfig);

      assert.deepStrictEqual(
        openers.map((o) => [o.variantName, o.openerKey, o.openerTypeName]),
        [
          ["authRouter", "openAuthRouterScope", "OpenAuthRouterScope"],
          ["publicRouter", "openPublicRouterScope", "OpenPublicRouterScope"],
        ],
      );
      // Two variants of ONE root contract, each with its own opener — they are different scopes,
      // not competing implementations of one default slot.
      assert.deepStrictEqual(
        [...new Set(openers.map((o) => o.contractName))],
        ["IRequestRouter"],
      );
    });

    it("should register each opener in the cradle under its own key", () => {
      const { sources } = generate(emissionFixtures(), emissionConfig);

      assert.match(
        sources.typesSource,
        /^ {2}openAuthRouterScope: OpenAuthRouterScope;$/m,
      );
      assert.match(
        sources.typesSource,
        /^ {2}openPublicRouterScope: OpenPublicRouterScope;$/m,
      );
    });

    it("should take the whole declared lbv and return the variant plus a disposer", () => {
      const { sources } = generate(emissionFixtures(), emissionConfig);

      // One parameter carrying every declared key — no ambient omission, because an injected opener
      // is closed over a statically anonymous scope. No AwilixContainer in either position.
      assert.match(
        sources.typesSource,
        /export type OpenAuthRouterScope = \(lbv: \{ principal: Principal; uow: UnitOfWork \}\) => \{ authRouter: IRequestRouter; dispose: \(\) => Promise<void> \};/,
      );
      assert.match(
        sources.typesSource,
        /export type OpenPublicRouterScope = \(lbv: \{ uow: UnitOfWork \}\) => \{ publicRouter: IRequestRouter; dispose: \(\) => Promise<void> \};/,
      );
      assert.ok(!sources.typesSource.includes("AwilixContainer"));
    });

    it("should emit the lbv member types by reference, never inlined", () => {
      const { openers, sources } = generate(emissionFixtures(), emissionConfig);

      const auth = openers.find((o) => o.variantName === "authRouter")!;
      assert.deepStrictEqual(
        auth.lbvMembers.map((m) => [m.key, m.typeRef.typeName]),
        [
          ["principal", "Principal"],
          ["uow", "UnitOfWork"],
        ],
      );
      for (const member of auth.lbvMembers) {
        assert.deepStrictEqual(
          member.typeRef.imports.map((i) => i.typeName),
          [member.typeRef.typeName],
        );
        assert.match(
          member.typeRef.imports[0]!.relImport,
          /deps-contracts\.js$/,
        );
      }

      // The emitted text names the types and imports them; the structural shape of `Principal`
      // (its `id` member) never appears.
      assert.match(
        sources.typesSource,
        /^import type \{[^}]*Principal[^}]*\} from "[^"]*deps-contracts\.js";$/m,
      );
      assert.ok(!sources.typesSource.includes("{ id: string }"));
    });

    it("should carry the opener into the manifest with the module it needs", () => {
      const { sources } = generate(emissionFixtures(), emissionConfig);

      assert.match(sources.mainSource, /scopeRoots: \{/);
      assert.match(sources.mainSource, /"IRequestRouter": \{/);
      assert.match(sources.mainSource, /openerKey: "openAuthRouterScope"/);
      assert.match(sources.mainSource, /variantKey: "authRouter"/);
      assert.match(sources.mainSource, /lbvKeys: \["principal", "uow"\]/);
      // The variant factory's module has to be importable at runtime, so it joins moduleImports.
      assert.match(
        sources.mainSource,
        /^import \* as ioc\w*emission from "[^"]*scope-roots\/emission\.js";$/m,
      );
    });

    it("should omit the manifest field entirely when there are no scope roots", () => {
      // Omitted, not emitted empty: a package with no scope roots must produce byte-identical
      // output to what it produced before openers existed.
      const clean = generate([fixture("deps-contracts.ts")]);

      assert.deepStrictEqual(clean.openers, []);
      assert.ok(!clean.sources.mainSource.includes("scopeRoots"));
      assert.ok(!clean.sources.typesSource.includes("export type Open"));
    });
  });

  describe("When an ordinary factory injects an emitted opener", () => {
    const consumerFixtures = (...extra: string[]): string[] => [
      fixture("deps-contracts.ts"),
      fixture("opener-consumer.ts"),
      ...extra.map(fixture),
    ];

    it("should accept both sanctioned spellings and resolve them to the one opener key", () => {
      // The alias form and the indexed form are two spellings of the same demand. Neither is a
      // relaxation of the backstop: both are enumerated forms with their own recognition rule, and
      // discovery/generation completing at all is the assertion — before this, either threw.
      const { demandSupply, openers } = generate(consumerFixtures());

      assert.deepStrictEqual(
        openers.map((o) => [o.variantName, o.openerKey]),
        [["consumedRouter", "openConsumedRouterScope"]],
      );
      // Both consumers recorded a demand on the key; neither produced a cradle entry of its own,
      // because emission owns the opener's property.
      assert.deepStrictEqual(
        (demandSupply.demandersByKey.get("openConsumedRouterScope") ?? []).map(
          (d) => d.exportName,
        ),
        ["buildAliasGateway", "buildIndexedGateway"],
      );
      assert.ok(
        !demandSupply.entries.some((e) => e.key === "openConsumedRouterScope"),
      );
    });

    it("should never ask the composing app for the opener", () => {
      const { demandSupply, sources } = generate(consumerFixtures());

      // The key is supplied by this package's own emission. Putting it in `IocExternals` would ask
      // the app to hand-build a scope opener — the thing the feature exists to stop.
      assert.ok(!demandSupply.externalKeys.includes("openConsumedRouterScope"));
      assert.ok(!/openConsumedRouterScope/.test(externalsBlockOf(sources.typesSource)));
    });

    it("should emit the opener by reference to its alias, never inlined at the demand site", () => {
      const { sources } = generate(consumerFixtures());

      // One cradle property, naming the alias…
      const propertyLines = sources.typesSource
        .split("\n")
        .filter((line) => /^ {2}openConsumedRouterScope:/.test(line));
      assert.deepStrictEqual(propertyLines, [
        "  openConsumedRouterScope: OpenConsumedRouterScope;",
      ]);
      // …and the function type appears exactly once, in the alias declaration itself. A demand that
      // expanded the handle member-by-member would print the signature a second time.
      const signatureOccurrences = sources.typesSource.split(
        "dispose: () => Promise<void>",
      ).length - 1;
      assert.strictEqual(signatureOccurrences, 1);
      assert.match(
        sources.typesSource,
        /export type OpenConsumedRouterScope = \(lbv: \{ requestId: string \}\) => \{ consumedRouter: IRequestRouter; dispose: \(\) => Promise<void> \};/,
      );
      // Nothing was read out of the stand-in prior output, either.
      assert.ok(!sources.typesSource.includes("StaleRouter"));
    });

    it("should still register the consumers themselves as ordinary units", () => {
      const { sources } = generate(consumerFixtures());

      assert.match(sources.typesSource, /^ {2}aliasGateway: AliasGateway;$/m);
      assert.match(sources.typesSource, /^ {2}indexedGateway: IndexedGateway;$/m);
    });

    it("should still bar the opener alias in a return position", () => {
      // The sanction is a DEPS sanction. A contract site feeds the cradle's supply type and is read
      // member-by-member, so the alias is rejected there exactly as any other generated type is —
      // and by the catch-all form, not the stale-output one, because this generation does emit it.
      assert.throws(
        () => generate(consumerFixtures("opener-return-position.ts")),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(
            message,
            /references the generated registry file from a factory deps type/,
          );
          assert.match(message, /OpenConsumedRouterScope/);
          assert.match(message, /contract site/);
          assert.doesNotMatch(message, /Re-run generation/);
          return true;
        },
      );
    });
  });

  describe("When a contract is both scope-rooted and ordinarily registered", () => {
    it("should be a hard error naming both declarations", () => {
      const both = generate([
        fixture("deps-contracts.ts"),
        fixture("both-sides.ts"),
      ]);

      assert.throws(
        () => both.validateEmission(),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /both scope-rooted and ordinarily registered/);
          assert.match(message, /split-brain contract/);
          assert.match(message, /Contract "IRequestRouter"/);
          assert.match(message, /"buildScopedRouter"/);
          assert.match(message, /"buildPlainRouter"/);
          // The deferred alternative is named so the reader knows it is a decision, not an oversight.
          assert.match(message, /mixed mode/);
          return true;
        },
      );
    });

    it("should list the offender instead of throwing under tolerateInvalidAnnotations", () => {
      const both = generate([
        fixture("deps-contracts.ts"),
        fixture("both-sides.ts"),
      ]);

      const result = both.validateEmission({ tolerateInvalidAnnotations: true });
      assert.strictEqual(result.contractExclusivityErrors.length, 1);
      assert.deepStrictEqual(result.openerKeyErrors, []);
    });
  });

  describe("When an opener key is already claimed", () => {
    it("should report it as the key collision it is", () => {
      const collision = generate([
        fixture("deps-contracts.ts"),
        fixture("opener-collision.ts"),
      ]);

      assert.throws(
        () => collision.validateEmission(),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /opener key\(s\) collide/);
          assert.match(message, /"openCollidingRouterScope"/);
          // Named against the SAME claimed-key set group roots are checked against, rather than a
          // second idea of what a cradle key is.
          assert.match(message, /the registration key of "IClock"/);
          return true;
        },
      );
    });

    it("should leave the variant's own contract key out of the namespace", () => {
      // Not an exemption — a consequence. Variants claim no root-cradle key, so there is nothing
      // for uniqueness to be about; only the opener key joins.
      const { sources, plans } = generate(emissionFixtures(), emissionConfig);

      assert.ok(!/^ {2}authRouter:/m.test(sources.typesSource));
      assert.ok(!/^ {2}publicRouter:/m.test(sources.typesSource));
      // …and the root contract elects no default, because it has no registration plan at all.
      assert.ok(!plans.some((p) => p.contractName === "IRequestRouter"));
    });
  });
});
