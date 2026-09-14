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
};

const unitEntry = (unit: UnitSpec): string =>
  `${unit.implementationName}: { registrationKey: ${JSON.stringify(unit.registrationKey)}, exportName: ${JSON.stringify(`build__${unit.implementationName}`)}, modulePath: ${JSON.stringify(unit.modulePath)}, contractName: ${JSON.stringify(unit.contractName)}, implementationName: ${JSON.stringify(unit.implementationName)}, lifetime: "singleton"${
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
  const libManifest = spec.libWithoutCoverageToken === true
    ? libManifestSource.replace(', "dependencyKeysComplete"', "")
    : libManifestSource;
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
     * An unreachable key is still reported, and the reason is structural rather than a missing
     * guard.
     *
     * The walk seeds from the app's REGISTERED units. An app's real resolution roots are its
     * composition root's own `container.resolve(...)` calls, which live in a bootstrap file that is
     * not a discovery target and has no manifest row — so a library unit the bootstrap resolves
     * directly looks unreachable here while being exactly what the app runs on.
     *
     * Reproduced in `examples/multi-package` while this rule was briefly enabled: a new unsatisfied
     * external on `buildUploadService` (which the example's bootstrap resolves) left `ioc validate`
     * reporting "no issues found" while the app threw `Could not resolve 'auditSink'` at its first
     * resolve. Ordinary code throughout — no rest element, no dynamic resolution.
     *
     * Clearing on that inference would trade a build error for a production one. Making it sound
     * needs the resolution ROOTS modelled, not more falsifiers closed.
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
