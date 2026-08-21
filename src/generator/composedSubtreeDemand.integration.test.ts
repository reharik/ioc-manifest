/**
 * Scope-root subtree demands ACROSS a package boundary.
 *
 * The app declares the boundary; the units that actually consume the late-bound values live in a
 * COMPOSED package and were written into that package's manifest by a different run of the
 * generator. Until the manifest carried per-unit `dependencyKeys`, none of those demands were
 * visible here, with two consequences this suite pins in both directions:
 *
 *   - a declared key a composed unit demands was reported "declared but never demanded" (loud and
 *     wrong), and
 *   - a key ONLY a composed unit demands, declared by nobody and supplied by nothing, verified
 *     ✔ satisfied and failed at first resolution in production (silent and wrong).
 *
 * The fixture is built on disk per test rather than committed, because half of it is a package
 * under `node_modules` — the same shape `loadComposedManifestContracts.test.ts` uses, for the same
 * reason. The app half is real TypeScript compiled by a real program; the library half is a
 * generated manifest source, which is all a composing app ever gets to see of a library.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import {
  buildDiscoveryReport,
  formatDiscoveryReport,
  runDiscoveryAnalysis,
} from "../inspection/index.js";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import { loadComposedManifestSupply } from "./loadComposedManifestUnits.js";
import { buildRegistrationPlan } from "./resolveRegistrationPlan.js";
import {
  demandersFromUnitEdges,
  resolveExternalsExclusion,
} from "./scopeRootExternalsExclusion.js";
import {
  buildScopeRootSupplyIndex,
  verifyScopeRoots,
  verifyScopeRootsAtCodegen,
} from "./verifyScopeRoots.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** The marker's real declaration — fixtures import it the way a consuming app does. */
const scopeRootModule = path
  .join(__dirname, "../scopeRoots/scopeRoot.js")
  .replace(/\\/g, "/");

const LIB = "@test/lib-media";
const LEGACY = "@test/lib-legacy";

/**
 * The library manifest, as this generator writes it: per-unit `dependencyKeys`, plus the sibling
 * export declaring that they are carried in full.
 *
 * `mediaAuditLog` is deliberately NOT a member of the `readServices` group and is reachable from
 * nothing the app's scope roots resolve. It demands `viewerId` all the same, from outside every
 * declaring subtree — which is what the externals-exclusion predicate has to notice.
 */
const modernLibraryManifest = (options?: {
  withDependencyKeys?: boolean;
  withFeatures?: boolean;
}): string => {
  const keys = options?.withDependencyKeys !== false;
  const dep = (list: string[]): string =>
    keys ? `\n        dependencyKeys: ${JSON.stringify(list)},` : "";

  return `export const iocManifest = {
  manifestSchemaVersion: 3,

  moduleImports: [],

  contracts: {
    MediaAuditLog: {
      mediaAuditLog: {
        exportName: "buildMediaAuditLog",
        registrationKey: "mediaAuditLog",
        modulePath: "services/buildMediaAuditLog.ts",
        relImport: "../services/buildMediaAuditLog.js",
        contractName: "MediaAuditLog",
        implementationName: "mediaAuditLog",
        lifetime: "scoped",
        moduleIndex: 2,
        default: true,${dep(["viewerId"])}
      },
    },
    MediaCatalog: {
      mediaCatalog: {
        exportName: "buildMediaCatalog",
        registrationKey: "mediaCatalog",
        modulePath: "services/buildMediaCatalog.ts",
        relImport: "../services/buildMediaCatalog.js",
        contractName: "MediaCatalog",
        implementationName: "mediaCatalog",
        lifetime: "scoped",
        moduleIndex: 1,
        default: true,${dep(["clock", "viewerId"])}
      },
    },
    PublicReadService: {
      publicReadService: {
        exportName: "buildPublicReadService",
        registrationKey: "publicReadService",
        modulePath: "services/buildPublicReadService.ts",
        relImport: "../services/buildPublicReadService.js",
        contractName: "PublicReadService",
        implementationName: "publicReadService",
        lifetime: "scoped",
        moduleIndex: 3,
        default: true,${dep(["publicLinkId"])}
      },
    },
    ViewerReadService: {
      viewerReadService: {
        exportName: "buildViewerReadService",
        registrationKey: "viewerReadService",
        modulePath: "services/buildViewerReadService.ts",
        relImport: "../services/buildViewerReadService.js",
        contractName: "ViewerReadService",
        implementationName: "viewerReadService",
        lifetime: "scoped",
        moduleIndex: 0,
        default: true,${dep(["viewerId"])}
      },
    },
  },

  // readServices
  readServices: {
    kind: "collection",
    baseType: "ReadService",
    baseTypeId: "${LIB}/src/types/ReadService.ts:ReadService",
    members: [
      { contractName: "ViewerReadService", registrationKey: "viewerReadService" },
      { contractName: "MediaCatalog", registrationKey: "mediaCatalog" },
    ],
  },
};

export const IOC_SCOPE_PROVIDED_KEYS = [] as const;
${
  options?.withFeatures !== false
    ? `
export const IOC_MANIFEST_FEATURES = ["dependencyKeys"] as const;
`
    : ""
}`;
};

const APP_CONTRACTS = `export interface IClock {
  now: () => number;
}
export interface ReadService {
  read: () => string;
}
export interface IRequestScope {
  handle: (p: string) => string;
}
export interface IPublicScope {
  handle: (p: string) => string;
}
export interface IAuditTrail {
  write: (line: string) => void;
}
`;

const APP_CLOCK = `import type { IClock } from "../contracts.js";

export const buildClock = (): IClock => ({ now: () => 0 });
`;

/** The field shape: the root's subtree reaches a composed GROUP whose members demand the lbv. */
const appRequestScope = (lbv: string): string =>
  `import type { ScopeRoot } from "${scopeRootModule}";
import type { IRequestScope, ReadService } from "../contracts.js";

type Deps = { readServices: readonly ReadService[] };

export const buildRequestScope = ({
  readServices,
}: Deps): ScopeRoot<IRequestScope${lbv}> => ({
  handle: (p: string) => readServices.map((s) => s.read()).join("") + p,
});
`;

/** A second boundary, so per-variant behaviour can be told apart from container-wide behaviour. */
const APP_PUBLIC_SCOPE = `import type { ScopeRoot } from "${scopeRootModule}";
import type { IPublicScope, ReadService } from "../contracts.js";

type Deps = { publicReadService: ReadService };

export const buildPublicScope = ({
  publicReadService,
}: Deps): ScopeRoot<IPublicScope, { publicLinkId: string }> => ({
  handle: (p: string) => publicReadService.read() + p,
});
`;

/** A LOCAL consumer of `viewerId`, outside every declaring subtree. */
const APP_OUTSIDE_CONSUMER = `import type { IAuditTrail } from "../contracts.js";

type Deps = { viewerId: string };

export const buildAuditTrail = ({ viewerId }: Deps): IAuditTrail => ({
  write: (line: string) => {
    void \`\${viewerId}:\${line}\`;
  },
});
`;

/** An `ioc.config.ts` for the fixture app, in the app mode composed packages require. */
const appIocConfig = (packageNames: readonly string[]): string =>
  `import { defineIocConfig } from "${path
    .join(__dirname, "../index.js")
    .replace(/\\/g, "/")}";

export default defineIocConfig({
  discovery: {
    scanDirs: ["src/factories"],
    generatedDir: "src/generated",
    includes: ["**/*.{ts,tsx}"],
  },
  composedManifests: ${JSON.stringify(packageNames)},
});
`;

type FixtureOptions = {
  /** The lbv type argument of `buildRequestScope`, `""` for the one-argument form. */
  requestScopeLbv?: string;
  /** Composed packages to install, in `composedManifests` order. */
  packages?: readonly { name: string; source: string }[];
  /** Extra app factory files, by file name under `src/factories`. */
  extraFactories?: Record<string, string>;
  /** Include the second scope root. Default: false. */
  withPublicScope?: boolean;
};

type Fixture = {
  projectRoot: string;
  files: string[];
  scanDirs: { absPath: string }[];
  packageNames: string[];
};

const buildFixture = (options?: FixtureOptions): Fixture => {
  const root = mkdtempSync(path.join(tmpdir(), "ioc-composed-subtree-"));
  const srcDir = path.join(root, "src");
  const factoriesDir = path.join(srcDir, "factories");
  mkdirSync(factoriesDir, { recursive: true });

  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "@test/app", type: "module" }),
  );
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
      },
      include: ["src/**/*.ts"],
    }),
  );

  const packages = options?.packages ?? [
    { name: LIB, source: modernLibraryManifest() },
  ];
  for (const pkg of packages) {
    const pkgDir = path.join(root, "node_modules", ...pkg.name.split("/"));
    mkdirSync(path.join(pkgDir, "generated"), { recursive: true });
    writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: pkg.name,
        exports: { "./iocManifest": "./generated/ioc-manifest.ts" },
      }),
    );
    writeFileSync(
      path.join(pkgDir, "generated", "ioc-manifest.ts"),
      pkg.source,
    );
  }

  const appFiles: Record<string, string> = {
    "buildClock.ts": APP_CLOCK,
    "buildRequestScope.ts": appRequestScope(
      options?.requestScopeLbv ?? ", { viewerId: string }",
    ),
    ...(options?.withPublicScope === true
      ? { "buildPublicScope.ts": APP_PUBLIC_SCOPE }
      : {}),
    ...(options?.extraFactories ?? {}),
  };

  writeFileSync(path.join(srcDir, "contracts.ts"), APP_CONTRACTS);
  writeFileSync(
    path.join(srcDir, "ioc.config.ts"),
    appIocConfig(packages.map((pkg) => pkg.name)),
  );
  const files = [path.join(srcDir, "contracts.ts")];
  for (const [name, source] of Object.entries(appFiles)) {
    const abs = path.join(factoriesDir, name);
    writeFileSync(abs, source);
    files.push(abs);
  }

  return {
    projectRoot: root,
    files,
    scanDirs: [{ absPath: factoriesDir }],
    packageNames: packages.map((pkg) => pkg.name),
  };
};

/** Discovers, plans, loads composed supply and verifies — the order `generateManifest` runs in. */
const analyze = async (fixture: Fixture) => {
  const program = ts.createProgram({
    rootNames: fixture.files,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });

  const generatedDir = path.join(fixture.projectRoot, "src/generated");
  const { contractMap, acceptedFactories, scopeRoots, discoveryFiles } =
    discoverFactories(
      fixture.files,
      program,
      fixture.projectRoot,
      "build",
      {
        projectRoot: fixture.projectRoot,
        scanDirs: fixture.scanDirs,
        generatedDir,
      },
      undefined,
      { collectFileRecords: true },
    );

  const plans = buildRegistrationPlan(contractMap, undefined, {
    projectRoot: fixture.projectRoot,
    scanDirs: fixture.scanDirs,
  });

  const composedSupply = await loadComposedManifestSupply(
    fixture.projectRoot,
    fixture.packageNames,
  );

  const ctx = {
    program,
    projectRoot: fixture.projectRoot,
    scanDirs: fixture.scanDirs,
    acceptedFactories,
    plans,
    composedSupply,
    // What the demand/supply pass classifies external in this shape: every key nothing local
    // registers. Composed keys are among them, which is exactly why the walk used to stop there.
    externalKeys: [
      "readServices",
      "publicReadService",
      "viewerReadService",
      "mediaCatalog",
      "mediaAuditLog",
    ],
  };

  return {
    ctx,
    scopeRoots,
    acceptedFactories,
    composedSupply,
    discoveryFiles,
    result: verifyScopeRoots(scopeRoots, ctx),
    exclusion: resolveExternalsExclusion({
      variants: verifyScopeRoots(scopeRoots, ctx).variants,
      demandersByKey: demandersFromUnitEdges(acceptedFactories, scopeRoots),
      acceptedFactories,
      scopeRoots,
      supplyIndex: buildScopeRootSupplyIndex(ctx),
    }),
  };
};

const variant = (
  result: Awaited<ReturnType<typeof analyze>>["result"],
  name: string,
) => {
  const found = result.variants.find((v) => v.variantName === name);
  assert.ok(found, `expected a verified variant ${JSON.stringify(name)}`);
  return found;
};

describe("scope-root subtree demands across a composed package boundary", () => {
  describe("When a composed unit demands a key the variant declares", () => {
    it("should count the demand, satisfy it, and stop warning that the key is unused", async () => {
      const { result } = await analyze(buildFixture());
      const requestScope = variant(result, "requestScope");

      // The demand is seen at all — this is the whole fix. `viewerId` is demanded by a unit two
      // hops away, through a composed GROUP, in another package.
      const viewerId = requestScope.scopeDemands.find(
        (d) => d.key === "viewerId",
      );
      assert.ok(viewerId, "expected viewerId to be demanded under the root");
      assert.equal(viewerId.satisfiedBy, "declared-lbv");
      assert.equal(viewerId.demandedBy.packageName, LIB);

      assert.deepEqual(requestScope.unusedDeclaredKeys, []);
      assert.equal(requestScope.satisfied, true);
      assert.equal(
        result.warnings.some((w) => w.includes("never demanded")),
        false,
        "the declared-but-never-demanded warning must be gone",
      );
    });

    it("should walk the composed group into its members and name them in the subtree", async () => {
      const { result } = await analyze(buildFixture());
      const requestScope = variant(result, "requestScope");

      const composed = requestScope.subtreeUnits.filter(
        (u) => u.packageName === LIB,
      );
      assert.deepEqual(
        composed.map((u) => u.registrationKey).sort(),
        ["mediaCatalog", "viewerReadService"],
        "both group members must join the subtree",
      );
      // `mediaAuditLog` is in the same package but in nothing this root resolves.
      assert.equal(
        requestScope.subtreeUnits.some(
          (u) => u.registrationKey === "mediaAuditLog",
        ),
        false,
      );
    });

    it("should stop printing the false unused-key line in --discovery", async () => {
      // The reported field symptom, verbatim: `lbv: viewerId  ✔ satisfied` immediately followed
      // by `! viewerId declared but never demanded`, for a key a composed unit demands.
      const { result, scopeRoots, discoveryFiles } =
        await analyze(buildFixture());
      const text = formatDiscoveryReport(
        buildDiscoveryReport({
          discoveryFiles,
          scopeRoots,
          scopeRootVerification: result,
        }),
        { color: false },
      );

      assert.match(text, /lbv: viewerId/);
      assert.match(text, /✔ satisfied/);
      assert.ok(
        !text.includes("declared but never demanded"),
        "the false unused-key line must be gone",
      );
    });

    it("should resolve a composed member's own dependency back to a LOCAL registration", async () => {
      // `mediaCatalog` demands `clock`, which this app registers. The walk has to cross back.
      const { result } = await analyze(buildFixture());
      const requestScope = variant(result, "requestScope");

      assert.equal(
        requestScope.subtreeUnits.some(
          (u) => u.registrationKey === "clock" && u.packageName === undefined,
        ),
        true,
      );
    });
  });

  describe("When a composed unit demands a key nothing declares or supplies", () => {
    it("should fail with the missing-key error, naming the composed unit and package", async () => {
      // The one-argument form: this boundary declares NO late-bound values at all, while its
      // composed subtree demands `viewerId`. Before the walk crossed the boundary this verified
      // ✔ satisfied and broke at first resolution.
      const { result, ctx, scopeRoots } = await analyze(
        buildFixture({ requestScopeLbv: "" }),
      );
      const requestScope = variant(result, "requestScope");

      assert.equal(requestScope.satisfied, false);
      const finding = requestScope.findings.find(
        (f) => f.code === "lbv_missing_key" && f.key === "viewerId",
      );
      assert.ok(finding, "expected a missing-key error for viewerId");
      assert.match(finding.message, /"buildViewerReadService"/);
      assert.match(finding.message, /composed package "@test\/lib-media"/);
      // The trail runs root → member → key. A group root expands to its MEMBERS, so the group key
      // itself is not a hop in the path — the same shape a local group produces, unchanged here.
      assert.match(
        finding.message,
        /via requestScope → viewerReadService → viewerId/,
      );

      assert.throws(
        () => verifyScopeRootsAtCodegen(scopeRoots, ctx),
        /scope-root verification failure/,
      );
    });
  });

  describe("When the externals-exclusion predicate reads composed demands", () => {
    it("should exclude a declared key every demand of which sits inside the declaring subtree", async () => {
      const { exclusion } = await analyze(
        buildFixture({
          packages: [
            {
              name: LIB,
              // Same library minus `mediaAuditLog`, so the ONLY demands of `viewerId` come from
              // inside the declaring variant's subtree.
              source: modernLibraryManifest().replace(
                /    MediaAuditLog: \{[\s\S]*?\n    \},\n/,
                "",
              ),
            },
          ],
        }),
      );

      assert.equal(exclusion.excludedKeys.has("viewerId"), true);
      assert.deepEqual(exclusion.sharedSubtreeUnits, []);
    });

    it("should hold a declared key back when a composed unit outside the subtree demands it", async () => {
      // `mediaAuditLog` demands `viewerId` and is reachable from nothing under the root, so the
      // container must still be asked for one. Invisible before composed demands were folded in —
      // and excluding the key here would delete the ask and break resolution at runtime.
      const { exclusion } = await analyze(buildFixture());

      assert.equal(exclusion.excludedKeys.has("viewerId"), false);
    });

    it("should hold a declared key back when a LOCAL unit outside the subtree demands it", async () => {
      // The pre-existing direction, re-pinned so widening the demand set did not weaken it.
      const { exclusion } = await analyze(
        buildFixture({
          extraFactories: { "buildAuditTrail.ts": APP_OUTSIDE_CONSUMER },
        }),
      );

      assert.equal(exclusion.excludedKeys.has("viewerId"), false);
    });

    it("should decide per variant, not container-wide", async () => {
      const { result, exclusion } = await analyze(
        buildFixture({ withPublicScope: true }),
      );

      // `publicLinkId` is demanded only by `publicReadService`, inside the public variant's
      // subtree, so it is excluded; `viewerId` is held back by `mediaAuditLog` as above.
      assert.equal(exclusion.excludedKeys.has("publicLinkId"), true);
      assert.equal(exclusion.excludedKeys.has("viewerId"), false);

      const publicScope = variant(result, "publicScope");
      assert.equal(publicScope.satisfied, true);
      assert.deepEqual(publicScope.unusedDeclaredKeys, []);
      // The public boundary never sees viewerId: satisfaction is per variant.
      assert.equal(
        publicScope.scopeDemands.some((d) => d.key === "viewerId"),
        false,
      );
    });
  });

  describe("When a composed unit's lifetime outlives the value it demands", () => {
    /** The same library with `viewerReadService` registered as a singleton. */
    const singletonReader = () =>
      buildFixture({
        packages: [
          {
            name: LIB,
            source: modernLibraryManifest().replace(
              /(viewerReadService: \{[\s\S]*?)lifetime: "scoped"/,
              '$1lifetime: "singleton"',
            ),
          },
        ],
      });

    it("should rank the inversion, because the composed lifetime is what will be registered", async () => {
      // A singleton in a library freezing the first scope's `viewerId` is the same production bug
      // it would be locally. The manifest's lifetime is not a guess — it is what `composeManifests`
      // registers — so the ranking is sound across the boundary.
      const { result } = await analyze(singletonReader());
      const requestScope = variant(result, "requestScope");

      const inversion = requestScope.findings.find(
        (f) => f.code === "lifetime_inversion" && f.key === "viewerId",
      );
      assert.ok(inversion, "expected the composed singleton to be ranked");
      assert.equal(inversion.severity, "error");
      assert.match(inversion.message, /composed package "@test\/lib-media"/);
    });

    it("should honour allowLifetimeInversion for a composed implementation", async () => {
      // The opt-out has to reach composed units or the diagnostic above is unappealable. An app
      // addresses a composed contract by the same (contract, implementation) pair as a local one.
      const fixture = singletonReader();
      const { ctx, scopeRoots } = await analyze(fixture);
      const suppressed = verifyScopeRoots(scopeRoots, {
        ...ctx,
        config: {
          registrations: {
            ViewerReadService: {
              viewerReadService: { allowLifetimeInversion: ["viewerId"] },
            },
          },
        } as never,
      });

      assert.equal(
        variant(suppressed, "requestScope").findings.some(
          (f) => f.code === "lifetime_inversion",
        ),
        false,
      );
    });
  });

  describe("When the app declares no contracts of its own", () => {
    it("should still infer cradle keys, so the walk leaves the root", async () => {
      // A thin composition app — everything it resolves comes from libraries — has an empty
      // contract set, which used to short-circuit dependency enrichment entirely and leave every
      // unit, scope roots included, with no `dependencyKeys` at all. Contract names narrow which
      // dependencies are named as CONTRACTS; they have nothing to do with the KEYS.
      const fixture = buildFixture();
      // Drop the only local factory (`buildClock`), leaving the scope root alone.
      fixture.files = fixture.files.filter((f) => !f.endsWith("buildClock.ts"));

      const { result, scopeRoots } = await analyze(fixture);

      assert.deepEqual(scopeRoots[0]?.dependencyKeys, ["readServices"]);
      const requestScope = variant(result, "requestScope");
      assert.equal(
        requestScope.scopeDemands.some((d) => d.key === "viewerId"),
        true,
      );
      assert.deepEqual(requestScope.unusedDeclaredKeys, []);
    });
  });

  describe("When `ioc inspect --discovery` runs over an app-mode package", () => {
    it("should load composed supply for itself rather than report a blind walk", async () => {
      // The reported symptom was seen through this command, not through generation, so the
      // inspection entry point is pinned end to end: config → composed manifests → subtree walk.
      const fixture = buildFixture();
      const analysis = await runDiscoveryAnalysis({
        iocConfigPath: path.join(fixture.projectRoot, "src/ioc.config.ts"),
        paths: { projectRoot: fixture.projectRoot },
      });

      const requestScope = analysis.scopeRootVerification.variants.find(
        (v) => v.variantName === "requestScope",
      );
      assert.ok(requestScope, "expected the scope root to be verified");
      assert.deepEqual(requestScope.unusedDeclaredKeys, []);
      assert.equal(
        requestScope.scopeDemands.find((d) => d.key === "viewerId")?.demandedBy
          .packageName,
        LIB,
      );
    });
  });

  describe("When a composed manifest predates the dependency-keys field", () => {
    const legacyFixture = () =>
      buildFixture({
        packages: [
          {
            name: LEGACY,
            source: modernLibraryManifest({
              withDependencyKeys: false,
              withFeatures: false,
            }),
          },
        ],
      });

    it("should advise that verification is incomplete rather than fail", async () => {
      const { result } = await analyze(legacyFixture());
      const requestScope = variant(result, "requestScope");

      assert.deepEqual(requestScope.blindComposedPackages, [LEGACY]);
      const advisory = requestScope.findings.find(
        (f) => f.code === "lbv_composed_blind_spot",
      );
      assert.ok(advisory, "expected a blind-spot advisory");
      assert.equal(advisory.severity, "warn");
      assert.match(advisory.message, /carries no dependency data/);
      assert.match(advisory.message, /INCOMPLETE/);
      assert.match(advisory.message, /"@test\/lib-legacy"/);

      // Advisory, not an error: an app must not be blocked because a library it composes has not
      // regenerated yet.
      assert.equal(requestScope.satisfied, true);
      assert.equal(result.errors.length, 0);
    });

    it("should still walk the composed units it can see, and say nothing it cannot know", async () => {
      const { result } = await analyze(legacyFixture());
      const requestScope = variant(result, "requestScope");

      // The group still expands and the members still join the subtree — only their demands are
      // unknown. That is what makes the advisory precise rather than a blanket disclaimer.
      assert.deepEqual(
        requestScope.subtreeUnits
          .filter((u) => u.packageName === LEGACY)
          .map((u) => u.registrationKey)
          .sort(),
        ["mediaCatalog", "viewerReadService"],
      );
      assert.deepEqual(requestScope.scopeDemands, []);
    });

    it("should not suppress the unused-key warning silently", async () => {
      const { result } = await analyze(legacyFixture());
      const requestScope = variant(result, "requestScope");

      // The warning is still raised — the tool genuinely cannot see a demand for `viewerId` — but
      // it never stands alone: the advisory says why the answer may be wrong.
      assert.deepEqual(requestScope.unusedDeclaredKeys, ["viewerId"]);
      assert.equal(
        requestScope.findings.some((f) => f.code === "lbv_unused_key"),
        true,
      );
      assert.equal(
        requestScope.findings.some((f) => f.code === "lbv_composed_blind_spot"),
        true,
      );
    });

    it("should raise no advisory for a package that carries the field", async () => {
      const { result } = await analyze(buildFixture());
      const requestScope = variant(result, "requestScope");

      assert.deepEqual(requestScope.blindComposedPackages, []);
      assert.equal(
        requestScope.findings.some((f) => f.code === "lbv_composed_blind_spot"),
        false,
      );
    });

    it("should print the blind spot next to the verdict in --discovery", async () => {
      const { result, scopeRoots, discoveryFiles } =
        await analyze(legacyFixture());
      const text = formatDiscoveryReport(
        buildDiscoveryReport({
          discoveryFiles,
          scopeRoots,
          scopeRootVerification: result,
        }),
        { color: false },
      );

      // Both lines, together: the ✔ is not withdrawn, and it no longer stands unqualified.
      assert.match(text, /✔ satisfied/);
      assert.match(
        text,
        /subtree reaches composed @test\/lib-legacy — no dependency data in their manifests, lbv verification incomplete for that subtree/,
      );
    });

    it("should raise no advisory for a field-less package the subtree never reaches", async () => {
      // Reached, not merely composed — an advisory on every variant of every app that happens to
      // depend on one stale package would be noise nobody reads.
      const { result } = await analyze(
        buildFixture({
          packages: [
            { name: LIB, source: modernLibraryManifest() },
            {
              name: LEGACY,
              source: `export const iocManifest = {
  manifestSchemaVersion: 3,
  moduleImports: [],
  contracts: {
    Unrelated: {
      unrelated: {
        exportName: "buildUnrelated",
        registrationKey: "unrelated",
        modulePath: "buildUnrelated.ts",
        relImport: "../buildUnrelated.js",
        contractName: "Unrelated",
        implementationName: "unrelated",
        lifetime: "singleton",
        moduleIndex: 0,
        default: true,
      },
    },
  },
};
`,
            },
          ],
        }),
      );

      assert.deepEqual(
        variant(result, "requestScope").blindComposedPackages,
        [],
      );
    });
  });
});
