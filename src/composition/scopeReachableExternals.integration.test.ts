/**
 * `[externals]` scope-reachability — WHEN an external's obligation comes due, not just whether it
 * is met.
 *
 * The defect these cases pin: composition treated every external as root-resolvable, so a shared
 * package owning a factory whose dependencies only exist per-request (a scoped logger demanding a
 * `logContext`) could never compose. The demand was evaluated at composition time and there was no
 * way to satisfy it — a value bound at scope-open is never in the composed cradle. The practical
 * effect was a rule nobody agreed to: shared packages may not contain scoped factories, which guts
 * composition for exactly the cross-cutting concerns most worth sharing.
 *
 * The corpus below is one workspace shape with knobs: a library registering `scopedLogger` (which
 * demands `logContext` and declares it external), and an app whose scope-root variants may or may
 * not reach it and may or may not declare it.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { IocConfig } from "../config/iocConfig.js";
import type {
  IocImplementationLifetime,
  IocLifetimeProvenance,
} from "../core/manifest.js";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";
import { buildCompositionSlice } from "./compositionContext.js";
import { runCompositionChecks } from "./runCompositionChecks.js";
import type { CompositionContext, ValidationIssue } from "./types.js";

const LIB = "@lib/infrastructure";

const appConfig = (
  extra: Record<string, unknown> = {},
): IocConfig => ({ composedManifests: [LIB], ...extra }) as unknown as IocConfig;

/**
 * Every manifest in this corpus vouches for its own dependency data.
 *
 * Without the coverage token reachability is not a verdict and the whole classification is withheld
 * — which is itself pinned, at the bottom of this file. Stating it here keeps the other cases about
 * the rule rather than about the caveat.
 */
const FEATURES = `export const IOC_MANIFEST_FEATURES = ["dependencyKeys", "dependencyKeysComplete", "lifetimeSource"];`;

type UnitSpec = {
  readonly contractName: string;
  readonly implementationName: string;
  readonly registrationKey: string;
  readonly modulePath: string;
  readonly dependencyKeys?: readonly string[];
  /** Defaults to `"singleton"`, which is what a row with nothing declared records. */
  readonly lifetime?: IocImplementationLifetime;
  /** Written only when given, exactly as a manifest omits it when the plan carried none. */
  readonly lifetimeSource?: IocLifetimeProvenance;
};

const unitEntry = (unit: UnitSpec): string =>
  `${unit.implementationName}: { registrationKey: ${JSON.stringify(unit.registrationKey)}, exportName: ${JSON.stringify(`build__${unit.implementationName}`)}, modulePath: ${JSON.stringify(unit.modulePath)}, contractName: ${JSON.stringify(unit.contractName)}, implementationName: ${JSON.stringify(unit.implementationName)}, lifetime: ${JSON.stringify(unit.lifetime ?? "singleton")}${
    unit.lifetimeSource === undefined
      ? ""
      : `, lifetimeSource: ${JSON.stringify(unit.lifetimeSource)}`
  }${
    unit.dependencyKeys === undefined
      ? ""
      : `, dependencyKeys: ${JSON.stringify(unit.dependencyKeys)}`
  } }`;

const contractsLiteral = (units: readonly UnitSpec[]): string => {
  const byContract = new Map<string, string[]>();
  for (const unit of units) {
    const entries = byContract.get(unit.contractName) ?? [];
    entries.push(unitEntry(unit));
    byContract.set(unit.contractName, entries);
  }
  return [...byContract]
    .map(([contractName, entries]) => `${contractName}: { ${entries.join(", ")} }`)
    .join(", ");
};

type VariantSpec = {
  readonly variantName: string;
  readonly exportName: string;
  readonly lbvKeys: readonly string[];
  /** Cradle keys the variant factory destructures. Written into the source file, not the manifest. */
  readonly demands: readonly string[];
};

const scopeRootsLiteral = (variants: readonly VariantSpec[]): string =>
  variants.length === 0
    ? ""
    : `scopeRoots: { GraphQLContext: { ${variants
        .map(
          (variant) =>
            `${variant.variantName}: { exportName: ${JSON.stringify(variant.exportName)}, openerKey: ${JSON.stringify(
              `open${variant.variantName}Scope`,
            )}, variantKey: ${JSON.stringify(variant.variantName)}, contractName: "GraphQLContext", variantName: ${JSON.stringify(
              variant.variantName,
            )}, modulePath: "app/scopeRoots.ts", relImport: "./scopeRoots.js", lbvKeys: ${JSON.stringify(
              variant.lbvKeys,
            )}, moduleIndex: 0 }`,
        )
        .join(", ")} } },`;

const manifestFile = (
  units: readonly UnitSpec[],
  variants: readonly VariantSpec[] = [],
): string =>
  [
    `export const iocManifest = {`,
    `  manifestSchemaVersion: ${MANIFEST_SCHEMA_VERSION},`,
    `  moduleImports: [],`,
    `  contracts: { ${contractsLiteral(units)} },`,
    `  ${scopeRootsLiteral(variants)}`,
    `};`,
    FEATURES,
  ].join("\n");

const typesFile = (cradle: string, externals: string): string =>
  `export interface IocGeneratedCradle {\n${cradle}\n}\nexport interface IocExternals {\n${externals}\n}`;

/**
 * The variant factories, as source.
 *
 * A variant claims no registration key and its manifest row carries no demand set, so the ONLY
 * place its subtree can be seeded from is the binding pattern it was written with — which is what
 * these files exist to provide.
 */
const scopeRootSource = (variants: readonly VariantSpec[]): string =>
  variants
    .map(
      (variant) =>
        `export const ${variant.exportName} = ({ ${variant.demands.join(", ")} }: Record<string, unknown>) => ({ ${variant.demands.join(", ")} });`,
    )
    .join("\n");

type WorkspaceSpec = {
  readonly label: string;
  readonly appUnits: readonly UnitSpec[];
  readonly appVariants?: readonly VariantSpec[];
  readonly appCradle?: string;
  readonly appExternals?: string;
  readonly libUnits?: readonly UnitSpec[];
  readonly libCradle?: string;
  readonly libExternals?: string;
  /** Drops the coverage token from the library manifest, to pin the withheld-classification path. */
  readonly libWithoutCoverageToken?: boolean;
  /**
   * Drops the `lifetimeSource` token from the library manifest.
   *
   * Absence of the token is the third reading of a missing provenance — "the generator that wrote
   * this predates the field" — and the one a diagnostic must not report as `"default"`.
   */
  readonly libWithoutProvenanceToken?: boolean;
};

const LIB_UNITS: readonly UnitSpec[] = [
  {
    contractName: "ScopedLogger",
    implementationName: "ScopedLogger",
    registrationKey: "scopedLogger",
    modulePath: "logger/scopedLogger.ts",
    dependencyKeys: ["logContext"],
  },
];

const workspace = (spec: WorkspaceSpec): CompositionContext => {
  const root = mkdtempSync(path.join(tmpdir(), `ioc-scope-reach-${spec.label}-`));
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2022",
        module: "ES2022",
      },
    }),
  );

  const variants = spec.appVariants ?? [];
  mkdirSync(path.join(root, "app"), { recursive: true });
  const scopeRootsPath = path.join(root, "app", "scopeRoots.ts");
  writeFileSync(scopeRootsPath, scopeRootSource(variants));

  const appManifestPath = path.join(root, "app.manifest.ts");
  const appTypesPath = path.join(root, "app.types.ts");
  const libManifestPath = path.join(root, "lib.manifest.ts");
  const libTypesPath = path.join(root, "lib.types.ts");

  const appManifest = manifestFile(spec.appUnits, variants);
  const appTypes = typesFile(
    spec.appCradle ?? "  appOnly: string;",
    spec.appExternals ?? "",
  );
  const libManifestSource = manifestFile(spec.libUnits ?? LIB_UNITS);
  const libWithCoverage = spec.libWithoutCoverageToken === true
    ? libManifestSource.replace(', "dependencyKeysComplete"', "")
    : libManifestSource;
  const libManifest = spec.libWithoutProvenanceToken === true
    ? libWithCoverage.replace(', "lifetimeSource"', "")
    : libWithCoverage;
  const libTypes = typesFile(
    spec.libCradle ?? "  scopedLogger: { info: (message: string) => void };",
    spec.libExternals ?? "  logContext: Record<string, unknown>;",
  );

  writeFileSync(appManifestPath, appManifest);
  writeFileSync(appTypesPath, appTypes);
  writeFileSync(libManifestPath, libManifest);
  writeFileSync(libTypesPath, libTypes);

  return {
    projectRoot: root,
    configPath: path.join(root, "ioc.config.ts"),
    slices: [
      buildCompositionSlice(
        "@apps/api",
        "local",
        appManifestPath,
        appManifest,
        appTypesPath,
        appTypes,
      ),
      buildCompositionSlice(
        LIB,
        LIB,
        libManifestPath,
        libManifest,
        libTypesPath,
        libTypes,
      ),
    ],
    sourceFiles: [scopeRootsPath],
    scanDirs: [],
    pendingArtifacts: undefined,
    tsconfig: undefined,
    composedPackageNames: [LIB],
    overrides: undefined,
    localContractNames: new Set(),
    composedContractNames: new Set(["ScopedLogger"]),
    declaredGroupNames: new Set(),
  };
};

const externalsIssues = (issues: readonly ValidationIssue[]): ValidationIssue[] =>
  issues.filter((issue) => issue.category === "externals");

/** The app unit that only ever resolves under a scope root. */
const VIEWER_SERVICE: UnitSpec = {
  contractName: "ViewerAlbumReadService",
  implementationName: "ViewerAlbumReadService",
  registrationKey: "viewerAlbumReadService",
  modulePath: "app/services.ts",
  dependencyKeys: ["scopedLogger"],
};

/** An app unit outside every scope, demanding nothing that leads to the library. */
const HTTP_SERVER: UnitSpec = {
  contractName: "HttpServer",
  implementationName: "HttpServer",
  registrationKey: "httpServer",
  modulePath: "app/server.ts",
  dependencyKeys: [],
};

const APP_CRADLE = [
  "  viewerAlbumReadService: { read: () => void };",
  "  httpServer: { listen: () => void };",
].join("\n");

describe("scope-reachable externals", () => {
  describe("When a scope-reachable external is declared by the variant that reaches it", () => {
    it("should report no issues", () => {
      const issues = runCompositionChecks(
        appConfig(),
        workspace({
          label: "satisfied",
          appUnits: [VIEWER_SERVICE, HTTP_SERVER],
          appCradle: APP_CRADLE,
          appVariants: [
            {
              variantName: "authenticatedRead",
              exportName: "build__AuthenticatedReadGraphQLContext",
              lbvKeys: ["viewerId", "logContext"],
              demands: ["viewerAlbumReadService"],
            },
          ],
        }),
      );
      assert.deepEqual(externalsIssues(issues), []);
    });
  });

  describe("When only one of several reaching variants declares the key", () => {
    const scenario = () =>
      externalsIssues(
        runCompositionChecks(
          appConfig(),
          workspace({
            label: "one-unsatisfied",
            appUnits: [VIEWER_SERVICE, HTTP_SERVER],
            appCradle: APP_CRADLE,
            appVariants: [
              {
                variantName: "authenticatedRead",
                exportName: "build__AuthenticatedReadGraphQLContext",
                lbvKeys: ["logContext"],
                demands: ["viewerAlbumReadService"],
              },
              {
                variantName: "publicRead",
                exportName: "build__PublicReadGraphQLContext",
                lbvKeys: ["viewerId"],
                demands: ["viewerAlbumReadService"],
              },
            ],
          }),
        ),
      );

    it("should report one error naming only the variant that does not declare it", () => {
      const issues = scenario();
      assert.equal(issues.length, 1);
      const text = issues[0]!.details.join("\n");
      assert.match(issues[0]!.summary, /scope-reachable only/);
      assert.match(text, /Propagated to 2 scope root variants\. Unsatisfied at 1:/);
      assert.match(text, /GraphQLContext \/ publicRead/);
      assert.doesNotMatch(text, /GraphQLContext \/ authenticatedRead/);
    });

    it("should render the resolution path that reaches the key", () => {
      assert.match(
        scenario()[0]!.details.join("\n"),
        /via: publicRead → viewerAlbumReadService → scopedLogger → logContext/,
      );
    });
  });

  describe("When no reaching variant declares the key", () => {
    it("should report one error naming every reaching variant", () => {
      const issues = externalsIssues(
        runCompositionChecks(
          appConfig(),
          workspace({
            label: "all-unsatisfied",
            appUnits: [VIEWER_SERVICE, HTTP_SERVER],
            appCradle: APP_CRADLE,
            appVariants: [
              {
                variantName: "authenticatedRead",
                exportName: "build__AuthenticatedReadGraphQLContext",
                lbvKeys: ["viewerId"],
                demands: ["viewerAlbumReadService"],
              },
              {
                variantName: "publicRead",
                exportName: "build__PublicReadGraphQLContext",
                lbvKeys: [],
                demands: ["viewerAlbumReadService"],
              },
            ],
          }),
        ),
      );
      assert.equal(issues.length, 1);
      const text = issues[0]!.details.join("\n");
      assert.match(text, /Propagated to 2 scope root variants\. Unsatisfied at 2:/);
      assert.match(text, /GraphQLContext \/ authenticatedRead/);
      assert.match(text, /GraphQLContext \/ publicRead/);
    });
  });

  describe("When one path reaches the key from a root and another only through a scope", () => {
    const scenario = () =>
      externalsIssues(
        runCompositionChecks(
          appConfig(),
          workspace({
            label: "mixed",
            appUnits: [
              VIEWER_SERVICE,
              {
                contractName: "ReportJob",
                implementationName: "ReportJob",
                registrationKey: "reportJob",
                modulePath: "app/reportJob.ts",
                dependencyKeys: ["scopedLogger"],
              },
            ],
            appCradle: [
              "  viewerAlbumReadService: { read: () => void };",
              "  reportJob: { run: () => void };",
            ].join("\n"),
            appVariants: [
              {
                variantName: "authenticatedRead",
                exportName: "build__AuthenticatedReadGraphQLContext",
                lbvKeys: ["logContext"],
                demands: ["viewerAlbumReadService"],
              },
            ],
          }),
        ),
      );

    it("should be a hard error even though the scope path declares the key", () => {
      const issues = scenario();
      assert.equal(issues.length, 1);
      assert.equal(issues[0]!.severity, "error");
    });

    it("should name the root path, which is the one that must be fixed", () => {
      const text = scenario()[0]!.details.join("\n");
      assert.match(text, /root path: reportJob → scopedLogger → logContext/);
      assert.match(text, /does not settle the path above/);
    });
  });

  describe("When the consumer composes the package and opens no scope at all", () => {
    /**
     * The demander here is a SINGLETON, and that is the whole reason the key is still reported.
     *
     * The walk seeds from the app's REGISTERED units. An app's real resolution roots are its
     * composition root's own `container.resolve(...)` calls, which live in a bootstrap file that is
     * not a discovery target and has no manifest row — so a library unit the bootstrap resolves
     * directly looks unreachable here while being exactly what the app runs on.
     *
     * Reproduced in `examples/multi-package` while the unrestricted rule was briefly enabled: a new
     * unsatisfied external on `buildUploadService` (which the example's bootstrap resolves) left
     * `ioc validate` reporting "no issues found" while the app threw `Could not resolve
     * 'auditSink'` at its first resolve. Ordinary code throughout — no rest element, no dynamic
     * resolution.
     *
     * A root resolve CAN reach a singleton, so that reproduction still bites here and the key is
     * not cleared. The scoped-demander case below is the one where it cannot.
     */
    it("should report the ordinary unsatisfied external", () => {
      const issues = externalsIssues(
        runCompositionChecks(
          appConfig(),
          workspace({
            label: "no-scopes",
            appUnits: [HTTP_SERVER],
            appCradle: "  httpServer: { listen: () => void };",
          }),
        ),
      );
      assert.equal(issues.length, 1);
      assert.match(issues[0]!.summary, /nothing supplies "logContext"/);
    });

    it("should name the demander that blocked the clearance", () => {
      const issues = externalsIssues(
        runCompositionChecks(
          appConfig(),
          workspace({
            label: "no-scopes-blocker-named",
            appUnits: [HTTP_SERVER],
            appCradle: "  httpServer: { listen: () => void };",
          }),
        ),
      );
      const text = issues[0]!.details.join("\n");
      assert.match(text, /not cleared: 1 of the 1 factory demanding it is resolvable from the root container/);
      assert.match(text, /"build__ScopedLogger" in logger\/scopedLogger\.ts \(@lib\/infrastructure\)/);
    });

    /**
     * The DECLARED path, which does clear the key, kept beside the inferred one on purpose.
     *
     * `scopeProvided` in the owning package takes the key out of its `IocExternals` at the source,
     * so no consumer is ever asked for it. A declaration by the party that knows carries weight an
     * inference drawn from a consumer's partial graph does not, and that distinction is the whole
     * reason one of these passes and the other does not.
     */
    it("should pass once the owning package declares the key scope-provided", () => {
      // `scopeProvided` in the OWNER removes the key from its `IocExternals` entirely, which is why
      // this fixture drops it from the library's declared externals rather than adding config here.
      const issues = runCompositionChecks(
        appConfig(),
        workspace({
          label: "no-scopes-scope-provided",
          appUnits: [HTTP_SERVER],
          appCradle: "  httpServer: { listen: () => void };",
          libExternals: "",
        }),
      );
      assert.deepEqual(externalsIssues(issues), []);
    });
  });

  describe("When two variants of one root exist and only one reaches the key", () => {
    it("should ask only the variant whose subtree resolves it", () => {
      const issues = externalsIssues(
        runCompositionChecks(
          appConfig(),
          workspace({
            label: "per-variant",
            appUnits: [
              VIEWER_SERVICE,
              {
                contractName: "PublicAlbumReadService",
                implementationName: "PublicAlbumReadService",
                registrationKey: "publicAlbumReadService",
                modulePath: "app/publicServices.ts",
                dependencyKeys: [],
              },
            ],
            appCradle: [
              "  viewerAlbumReadService: { read: () => void };",
              "  publicAlbumReadService: { read: () => void };",
            ].join("\n"),
            appVariants: [
              {
                variantName: "authenticatedRead",
                exportName: "build__AuthenticatedReadGraphQLContext",
                lbvKeys: [],
                demands: ["viewerAlbumReadService"],
              },
              {
                variantName: "publicRead",
                exportName: "build__PublicReadGraphQLContext",
                lbvKeys: [],
                demands: ["publicAlbumReadService"],
              },
            ],
          }),
        ),
      );
      assert.equal(issues.length, 1);
      const text = issues[0]!.details.join("\n");
      assert.match(text, /Propagated to 1 scope root variant\. Unsatisfied at 1:/);
      assert.match(text, /GraphQLContext \/ authenticatedRead/);
      assert.doesNotMatch(text, /GraphQLContext \/ publicRead/);
    });
  });

  describe("When a genuinely missing external has no scope involvement", () => {
    it("should report the unchanged root-external error", () => {
      const issues = externalsIssues(
        runCompositionChecks(
          appConfig(),
          workspace({
            label: "root-missing",
            appUnits: [
              {
                contractName: "ReportJob",
                implementationName: "ReportJob",
                registrationKey: "reportJob",
                modulePath: "app/reportJob.ts",
                dependencyKeys: ["scopedLogger"],
              },
            ],
            appCradle: "  reportJob: { run: () => void };",
          }),
        ),
      );
      assert.equal(issues.length, 1);
      assert.match(
        issues[0]!.summary,
        /Unsatisfied: nothing supplies "logContext", which @lib\/infrastructure expects the container to already have\./,
      );
      assert.deepEqual(issues[0]!.details, [
        `key:       "logContext"  demanded by @lib/infrastructure`,
        "demanded:  Record<string, unknown>",
        "No composed manifest offers this key in its IocGeneratedCradle.",
      ]);
    });
  });

  describe("When a scope-reachable external is supplied by an ordinary registration", () => {
    it("should report no issues", () => {
      const issues = runCompositionChecks(
        appConfig(),
        workspace({
          label: "registered",
          appUnits: [
            VIEWER_SERVICE,
            HTTP_SERVER,
            {
              contractName: "LogContext",
              implementationName: "LogContext",
              registrationKey: "logContext",
              modulePath: "app/logContext.ts",
              dependencyKeys: [],
            },
          ],
          appCradle: [
            "  viewerAlbumReadService: { read: () => void };",
            "  httpServer: { listen: () => void };",
            "  logContext: Record<string, unknown>;",
          ].join("\n"),
          appVariants: [
            {
              variantName: "authenticatedRead",
              exportName: "build__AuthenticatedReadGraphQLContext",
              lbvKeys: [],
              demands: ["viewerAlbumReadService"],
            },
          ],
        }),
      );
      assert.deepEqual(externalsIssues(issues), []);
    });
  });

  describe("When the composing app registers nothing of its own", () => {
    /**
     * The pure-composition app: no local factories, everything wired from composed packages. The
     * root walk has no seeds, so it reaches nothing BY CONSTRUCTION — and reading that as "no path
     * reaches this key" would clear every external in the composed set on the strength of having
     * looked nowhere. Zero seeds is no information, not a verdict of zero obligations.
     */
    it("should withhold the classification rather than clear the external", () => {
      const issues = externalsIssues(
        runCompositionChecks(
          appConfig(),
          workspace({ label: "no-local-units", appUnits: [] }),
        ),
      );
      assert.equal(issues.length, 1);
      assert.match(issues[0]!.summary, /nothing supplies "logContext"/);
    });
  });

  /**
   * The scoped-only carve-out: the one shape where "no recorded path reaches it" is a verdict.
   *
   * The unrestricted rule could not ship because the walk cannot see the composition root, so an
   * unreachable key might still be resolved by a `bootstrap.ts` nobody recorded. That ambiguity
   * requires the demanding factory to be reachable from the ROOT container — and a scoped factory
   * is not. A bootstrap resolve against the root fails at runtime no matter what this walk saw, so
   * there is no hidden path for it to have missed.
   *
   * Motivating case: `logContext`, demanded only by a scoped logger in a shared infrastructure
   * package, in a worker that composes the package and opens no scope. Before this rule that worker
   * simply could not generate.
   */
  describe("When every factory demanding an unreachable key is scoped", () => {
    const scopedLogger = (
      extra: Partial<UnitSpec> = {},
    ): readonly UnitSpec[] => [{ ...LIB_UNITS[0]!, lifetime: "scoped", ...extra }];

    it("should clear the key with no diagnostic at all", () => {
      const issues = runCompositionChecks(
        appConfig(),
        workspace({
          label: "scoped-only-unreachable",
          appUnits: [HTTP_SERVER],
          appCradle: "  httpServer: { listen: () => void };",
          libUnits: scopedLogger(),
        }),
      );
      assert.deepEqual(externalsIssues(issues), []);
    });

    it("should clear it when the lifetime came from a declared marker", () => {
      const issues = runCompositionChecks(
        appConfig(),
        workspace({
          label: "scoped-by-marker",
          appUnits: [HTTP_SERVER],
          appCradle: "  httpServer: { listen: () => void };",
          libUnits: scopedLogger({ lifetimeSource: "lifetime-marker" }),
        }),
      );
      assert.deepEqual(externalsIssues(issues), []);
    });

    /**
     * The same library, in a consumer that DOES reach the key under a scope — the worker/api split
     * that motivated the rule, with one library definition and two consumers.
     *
     * Nothing about the scoped-demander carve-out touches this half: the key is reached, so it
     * relocates to the variants exactly as it did before, and the obligation is still owed there.
     */
    it("should still relocate the key in a consumer whose scope reaches it", () => {
      const reaching = workspace({
        label: "scoped-only-but-reached",
        appUnits: [VIEWER_SERVICE, HTTP_SERVER],
        appCradle: APP_CRADLE,
        libUnits: scopedLogger({ lifetimeSource: "lifetime-marker" }),
        appVariants: [
          {
            variantName: "authenticatedRead",
            exportName: "build__AuthenticatedReadGraphQLContext",
            lbvKeys: [],
            demands: ["viewerAlbumReadService"],
          },
        ],
      });
      const issues = externalsIssues(runCompositionChecks(appConfig(), reaching));

      // Relocated, not cleared: the variant that reaches it does not carry it, so the obligation
      // lands there and is reported there.
      assert.equal(issues.length, 1);
      assert.match(issues[0]!.summary, /scope-reachable only/);
      assert.match(
        issues[0]!.details.join("\n"),
        /via: authenticatedRead → viewerAlbumReadService → scopedLogger → logContext/,
      );
    });

    it("should pass in that consumer once the variant declares the key", () => {
      const issues = runCompositionChecks(
        appConfig(),
        workspace({
          label: "scoped-only-reached-declared",
          appUnits: [VIEWER_SERVICE, HTTP_SERVER],
          appCradle: APP_CRADLE,
          libUnits: scopedLogger({ lifetimeSource: "lifetime-marker" }),
          appVariants: [
            {
              variantName: "authenticatedRead",
              exportName: "build__AuthenticatedReadGraphQLContext",
              lbvKeys: ["logContext"],
              demands: ["viewerAlbumReadService"],
            },
          ],
        }),
      );
      assert.deepEqual(externalsIssues(issues), []);
    });
  });

  describe("When one scoped and one root-resolvable factory demand the same unreachable key", () => {
    /**
     * The mixed case collapses into the restriction with nothing extra to write: one root-resolvable
     * demander means the general unsoundness applies, and a scoped demander alongside it does not
     * launder that. There is no third treatment.
     */
    const scenario = () =>
      externalsIssues(
        runCompositionChecks(
          appConfig(),
          workspace({
            label: "one-scoped-one-root",
            appUnits: [HTTP_SERVER],
            appCradle: "  httpServer: { listen: () => void };",
            libUnits: [
              { ...LIB_UNITS[0]!, lifetime: "scoped", lifetimeSource: "lifetime-marker" },
              {
                contractName: "AuditWriter",
                implementationName: "AuditWriter",
                registrationKey: "auditWriter",
                modulePath: "audit/auditWriter.ts",
                dependencyKeys: ["logContext"],
                lifetime: "singleton",
                lifetimeSource: "factory-config",
              },
            ],
            libCradle: [
              "  scopedLogger: { info: (message: string) => void };",
              "  auditWriter: { write: (line: string) => void };",
            ].join("\n"),
          }),
        ),
      );

    it("should not clear the key", () => {
      const issues = scenario();
      assert.equal(issues.length, 1);
      assert.match(issues[0]!.summary, /nothing supplies "logContext"/);
    });

    it("should name only the root-resolvable demander as the blocker", () => {
      const text = scenario()[0]!.details.join("\n");
      assert.match(text, /not cleared: 1 of the 2 factories demanding it is resolvable/);
      assert.match(text, /"build__AuditWriter" in audit\/auditWriter\.ts/);
      assert.doesNotMatch(text, /build__ScopedLogger/);
      assert.match(text, /lifetime singleton \(from factory-config\)/);
    });
  });

  describe("When the demander records a default singleton because nothing declared a lifetime", () => {
    /**
     * The config gap, which is a different afternoon from a deliberate singleton.
     *
     * A package whose `ioc.config` declares no `lifetimeMarkers` block generates rows that say
     * `lifetime: "singleton", lifetimeSource: "default"` even when the class extends a scope
     * lifecycle marker — the marker is inert without the block. This rule can only read the row, so
     * it correctly refuses to clear; the diagnostic has to say that, or the reader is left staring
     * at an unsatisfied external whose entire cause is one missing config block.
     */
    const scenario = () =>
      externalsIssues(
        runCompositionChecks(
          appConfig(),
          workspace({
            label: "default-singleton-demander",
            appUnits: [HTTP_SERVER],
            appCradle: "  httpServer: { listen: () => void };",
            libUnits: [{ ...LIB_UNITS[0]!, lifetimeSource: "default" }],
          }),
        ),
      );

    it("should not clear the key", () => {
      assert.equal(scenario().length, 1);
    });

    it("should say the lifetime was defaulted rather than declared", () => {
      assert.match(
        scenario()[0]!.details.join("\n"),
        /lifetime singleton BY DEFAULT — nothing in @lib\/infrastructure declared one/,
      );
    });

    it("should point the fix at the owning package's lifetimeMarkers block", () => {
      assert.match(
        scenario()[0]!.suggestedFix,
        /add a `lifetimeMarkers` block to its `ioc\.config` and regenerate/,
      );
      assert.match(scenario()[0]!.suggestedFix, /@lib\/infrastructure/);
    });

    /**
     * The third reading of a missing provenance, and the one a diagnostic must not report as
     * `"default"`: a manifest whose generator predates the field records nothing, and absence there
     * says only that nobody wrote it down.
     */
    it("should say provenance is unrecorded when the manifest declares no such feature", () => {
      const text = externalsIssues(
        runCompositionChecks(
          appConfig(),
          workspace({
            label: "no-provenance-token",
            appUnits: [HTTP_SERVER],
            appCradle: "  httpServer: { listen: () => void };",
            libWithoutProvenanceToken: true,
          }),
        ),
      )[0]!.details.join("\n");
      assert.match(text, /lifetime singleton; this manifest records no lifetime provenance/);
      assert.doesNotMatch(text, /BY DEFAULT/);
    });
  });

  describe("When a composed manifest does not vouch for its dependency data", () => {
    /**
     * Reachability is only as good as the demand data under it. A manifest that cannot claim
     * `dependencyKeysComplete` has units whose demands are invisible, and an obligation dropped
     * because a demand was invisible looks exactly like one that was never owed — so the whole
     * classification is withheld and the key is judged as it was before, rather than silently
     * passing.
     */
    it("should withhold the classification and report the root-external error", () => {
      const issues = externalsIssues(
        runCompositionChecks(
          appConfig(),
          workspace({
            label: "blind",
            appUnits: [VIEWER_SERVICE, HTTP_SERVER],
            appCradle: APP_CRADLE,
            libWithoutCoverageToken: true,
            appVariants: [
              {
                variantName: "authenticatedRead",
                exportName: "build__AuthenticatedReadGraphQLContext",
                lbvKeys: ["logContext"],
                demands: ["viewerAlbumReadService"],
              },
            ],
          }),
        ),
      );
      assert.equal(issues.length, 1);
      assert.match(issues[0]!.summary, /nothing supplies "logContext"/);
    });
  });
});
