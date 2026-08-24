/**
 * `ioc explain <key>` across a package boundary — the answer an app actually needs.
 *
 * The scenario is a two-package app: a media library that registers a storage implementation, owns
 * a record group of write services (one of them named differently from its contract, so the record
 * property and the registration key diverge), demands a `logger` the app must supply, and is itself
 * consumed by the app. Every question a developer standing in the app asks about a key is asserted
 * against it, supplier labels included — because "which package does this come from" is the fact
 * the local-only answer could never give and the one the whole finding is about.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PackageFreshness } from "../diagnostics/freshness.js";
import {
  compositionContextFixture,
  parsedSlice,
} from "../test-support/manifestFixtures.js";
import type {
  ParsedImplementationMeta,
  ParsedManifestSlice,
} from "../composition/types.js";
import type { ComposedRegistrationOverrides } from "../runtime/composedOverrides.js";
import { explainFromManifest } from "./explain.js";
import { buildExplainComposedView } from "./explainComposedView.js";
import { formatExplainReport } from "./formatExplain.js";
import type {
  IocContractManifest,
  IocScopeRootsManifest,
} from "../core/manifest.js";

const CURRENT_FEATURES = ["dependencyKeys", "lifetimeSource"] as const;

type UnitSpec = {
  contract: string;
  impl: string;
  key?: string;
  lifetime?: "singleton" | "scoped" | "transient";
  lifetimeSource?: ParsedImplementationMeta["lifetimeSource"];
  deps?: readonly string[];
  default?: boolean;
};

const upperFirst = (s: string): string =>
  `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/** One implementation as both a slice and a manifest state it — one spec, two projections. */
const meta = (spec: UnitSpec): ParsedImplementationMeta => ({
  registrationKey: spec.key ?? spec.impl,
  ...(spec.default === true ? { default: true as const } : {}),
  exportName: `build${upperFirst(spec.impl)}`,
  modulePath: `src/factories/build${upperFirst(spec.impl)}.ts`,
  implementationName: spec.impl,
  lifetime: spec.lifetime ?? "singleton",
  ...(spec.lifetimeSource !== undefined
    ? { lifetimeSource: spec.lifetimeSource }
    : {}),
  ...(spec.deps !== undefined ? { dependencyKeys: spec.deps } : {}),
});

const contractsOf = (
  specs: readonly UnitSpec[],
): Record<string, Record<string, ParsedImplementationMeta>> => {
  const out: Record<string, Record<string, ParsedImplementationMeta>> = {};
  for (const spec of specs) {
    out[spec.contract] = { ...(out[spec.contract] ?? {}), [spec.impl]: meta(spec) };
  }
  return out;
};

/** The same specs as a generated manifest's `contracts`, for the LOCAL half of the universe. */
const manifestContractsOf = (
  specs: readonly UnitSpec[],
): IocContractManifest => {
  const out: IocContractManifest = {};
  for (const spec of specs) {
    out[spec.contract] = {
      ...(out[spec.contract] ?? {}),
      [spec.impl]: {
        exportName: `build${upperFirst(spec.impl)}`,
        registrationKey: spec.key ?? spec.impl,
        modulePath: `src/factories/build${upperFirst(spec.impl)}.ts`,
        relImport: "../x.js",
        contractName: spec.contract,
        implementationName: spec.impl,
        lifetime: spec.lifetime ?? "singleton",
        ...(spec.lifetimeSource !== undefined
          ? { lifetimeSource: spec.lifetimeSource }
          : {}),
        moduleIndex: 0,
        ...(spec.default === true ? { default: true as const } : {}),
        ...(spec.deps !== undefined ? { dependencyKeys: spec.deps } : {}),
      },
    };
  }
  return out;
};

const LIBRARY_UNITS: readonly UnitSpec[] = [
  {
    contract: "MediaStorage",
    impl: "s3Storage",
    lifetime: "singleton",
    lifetimeSource: "lifetime-marker",
    deps: ["mediaClock"],
    default: true,
  },
  {
    contract: "MediaClock",
    impl: "mediaClock",
    lifetime: "scoped",
    lifetimeSource: "factory-config",
  },
  // Demands the storage through its CONTRACT SLOT — the slot hop, from inside the library itself.
  {
    contract: "MediaIndexer",
    impl: "mediaIndexer",
    lifetime: "singleton",
    lifetimeSource: "default",
    deps: ["mediaStorage"],
  },
  {
    contract: "AlbumWriteService",
    impl: "albumWriteService",
    lifetime: "scoped",
    lifetimeSource: "group-base-marker",
    deps: ["mediaClock"],
  },
  // The divergent member: the implementation is `trackWrite`, the record exposes it as
  // `trackWriteService`. Which name a consumer writes after the group key is the whole point.
  {
    contract: "TrackWriteService",
    impl: "trackWrite",
    lifetime: "scoped",
    lifetimeSource: "group-base-marker",
  },
];

const APP_UNITS: readonly UnitSpec[] = [
  // Demands the library's storage DIRECTLY by registration key, plus the group and the external.
  {
    contract: "UploadHandler",
    impl: "uploadHandler",
    lifetime: "scoped",
    lifetimeSource: "lifetime-marker",
    deps: ["s3Storage", "logger"],
  },
  // Reaches a library group member through the GROUP hop.
  {
    contract: "AuditRunner",
    impl: "auditRunner",
    lifetime: "singleton",
    lifetimeSource: "default",
    deps: ["writeServices"],
  },
  { contract: "MediaStorage", impl: "localStorage", lifetime: "singleton" },
];

const WRITE_SERVICES_ROOT = {
  kind: "object" as const,
  baseType: "WriteServiceBase",
  baseTypeId: "@media/core:WriteServiceBase",
  members: {
    albumWriteService: {
      contractName: "AlbumWriteService",
      registrationKey: "albumWriteService",
    },
    trackWriteService: {
      contractName: "TrackWriteService",
      registrationKey: "trackWrite",
    },
  },
};

const librarySlice = (
  features: readonly string[] | undefined = CURRENT_FEATURES,
): ParsedManifestSlice =>
  parsedSlice({
    packageLabel: "@media/core",
    sourceId: "@media/core",
    declaredFeatures: features,
    contracts: contractsOf(
      features === undefined || !features.includes("lifetimeSource")
        ? LIBRARY_UNITS.map(({ lifetimeSource: _drop, ...rest }) => rest)
        : LIBRARY_UNITS,
    ),
    groupRoots: { writeServices: WRITE_SERVICES_ROOT },
    externals: { logger: { typeText: "Logger" } },
  });

const appSlice = (): ParsedManifestSlice =>
  parsedSlice({
    packageLabel: "@apps/api",
    sourceId: "local",
    declaredFeatures: CURRENT_FEATURES,
    contracts: contractsOf(APP_UNITS),
    externals: { logger: { typeText: "Logger" } },
  });

const APP_SCOPE_ROOTS: IocScopeRootsManifest = {
  IRouter: {
    authRouter: {
      exportName: "buildAuthRouter",
      openerKey: "openAuthRouterScope",
      variantKey: "authRouter",
      contractName: "IRouter",
      variantName: "authRouter",
      modulePath: "src/factories/buildAuthRouter.ts",
      relImport: "../x.js",
      lbvKeys: ["requestId"],
      moduleIndex: 0,
    },
  },
};

const APP_MANIFEST = {
  contracts: manifestContractsOf(APP_UNITS),
  groups: {},
  scopeRoots: APP_SCOPE_ROOTS,
  declaredFeatures: CURRENT_FEATURES as readonly string[],
};

const explainInApp = (
  key: string,
  opts?: {
    libraryFeatures?: readonly string[] | undefined;
    freshness?: readonly PackageFreshness[];
    overrides?: ComposedRegistrationOverrides;
  },
) => {
  const context = compositionContextFixture(
    [appSlice(), librarySlice(opts?.libraryFeatures ?? CURRENT_FEATURES)],
    opts?.overrides,
  );
  return explainFromManifest(
    key,
    APP_MANIFEST,
    buildExplainComposedView({
      context,
      ...(opts?.freshness !== undefined ? { freshness: opts.freshness } : {}),
    }),
  );
};

describe("app-mode explain over the composed picture", () => {
  describe("When the key is a composed registration", () => {
    const report = explainInApp("s3Storage");

    it("should resolve it and name the package that supplies it", () => {
      assert.equal(report.resolution.kind, "registration");
      assert.deepEqual(report.supplier, {
        packageLabel: "@media/core",
        sourceId: "@media/core",
      });
      assert.equal(
        report.resolution.kind === "registration"
          ? report.resolution.unit.modulePath
          : undefined,
        // Package-qualified: two packages may each hold a `buildS3Storage.ts`, and the reader
        // cannot open this one from here.
        "@media/core/src/factories/buildS3Storage.ts",
      );
    });

    it("should render the provenance chain the manifest now records", () => {
      assert.equal(report.lifetime?.lifetime, "singleton");
      assert.deepEqual(report.lifetime?.provenance, [
        "lifetime-marker",
        "on the contract site of buildS3Storage",
      ]);
      assert.equal(report.lifetime?.degradedNote, undefined);
    });

    it("should resolve its dependencies across the boundary, with floor-rule pressure", () => {
      assert.deepEqual(
        report.dependencies.map((d) => [
          d.key,
          d.lifetime,
          d.packageLabel,
          d.pressure?.severity,
        ]),
        // The captive dependency, across packages: a singleton holding a scoped clock.
        [["mediaClock", "scoped", "@media/core", "error"]],
      );
    });

    it("should list demanders from both packages, attributed and hopped correctly", () => {
      assert.deepEqual(
        report.dependents.map((d) => [d.demander, d.via, d.packageLabel]),
        [
          // The library's own indexer reaches it through the contract slot...
          ["mediaIndexer", "slot:mediaStorage", "@media/core"],
          // ...and the app's handler demands the registration key directly.
          ["uploadHandler", "direct", "@apps/api (this app)"],
        ],
      );
    });

    it("should name the supplier on the rendered screen", () => {
      const text = formatExplainReport(report, { color: false });
      assert.match(text, /^s3Storage → registration of MediaStorage/m);
      assert.match(text, /supplied by @media\/core/);
      assert.match(text, /mediaClock\s+scoped.*from @media\/core/);
      assert.match(text, /mediaIndexer .*via slot:mediaStorage\s+in @media\/core/);
      assert.match(text, /uploadHandler .*in @apps\/api \(this app\)/);
    });
  });

  describe("When the key is a contract slot elected across packages", () => {
    it("should name the electee and the package it comes from", () => {
      const report = explainInApp("mediaStorage");

      assert.equal(report.resolution.kind, "contract-slot");
      assert.equal(
        report.resolution.kind === "contract-slot"
          ? report.resolution.electee?.registrationKey
          : undefined,
        "s3Storage",
      );
      assert.deepEqual(
        report.resolution.kind === "contract-slot"
          ? report.resolution.implementations
          : [],
        ["localStorage", "s3Storage"],
      );
      assert.deepEqual(report.supplier, {
        packageLabel: "@media/core",
        sourceId: "@media/core",
      });
    });

    it("should follow the app's own election when its config overrides the contract", () => {
      const report = explainInApp("mediaStorage", {
        overrides: {
          contracts: { MediaStorage: { defaultImplementation: "localStorage" } },
        },
      });

      // The shared electee helper decides, so `explain` and the composition suite cannot name
      // different implementations behind the same slot key.
      assert.equal(
        report.resolution.kind === "contract-slot"
          ? report.resolution.electee?.registrationKey
          : undefined,
        "localStorage",
      );
      assert.equal(report.supplier?.packageLabel, "@apps/api (this app)");
    });
  });

  describe("When the key is a composed group root", () => {
    it("should list its members with the package supplying each", () => {
      const report = explainInApp("writeServices");

      assert.equal(report.resolution.kind, "group");
      assert.equal(report.lifetime, undefined);
      assert.deepEqual(
        report.resolution.kind === "group"
          ? report.resolution.members.map((m) => [
              m.memberName,
              m.registrationKey,
              m.packageLabel,
            ])
          : [],
        [
          ["albumWriteService", "albumWriteService", "@media/core"],
          ["trackWriteService", "trackWrite", "@media/core"],
        ],
      );
      assert.equal(
        report.resolution.kind === "group"
          ? report.resolution.declaredBy
          : undefined,
        "@media/core",
      );
      assert.deepEqual(
        report.dependents.map((d) => [d.demander, d.packageLabel]),
        [["auditRunner", "@apps/api (this app)"]],
      );
    });
  });

  describe("When the key is a composed grouped member's would-be key", () => {
    const report = explainInApp("trackWriteService");

    it("should answer with the group law rather than a miss", () => {
      assert.equal(report.resolution.kind, "grouped-member");
      assert.deepEqual(
        report.resolution.kind === "grouped-member"
          ? {
              groupKey: report.resolution.groupKey,
              groupKind: report.resolution.groupKind,
              baseType: report.resolution.baseType,
              declaredBy: report.resolution.declaredBy,
              composed: report.resolution.declaredByComposedPackage,
              contractName: report.resolution.contractName,
              // The RECORD's own property key, which is what a consumer writes — never the
              // divergent registration key `trackWrite`.
              recordPropertyKey: report.resolution.recordPropertyKey,
            }
          : undefined,
        {
          groupKey: "writeServices",
          groupKind: "object",
          baseType: "WriteServiceBase",
          declaredBy: "@media/core",
          composed: true,
          contractName: "TrackWriteService",
          recordPropertyKey: "trackWriteService",
        },
      );
    });

    it("should teach the spelling that works, and link the rule", () => {
      const text = formatExplainReport(report, { color: false });
      assert.match(
        text,
        /^trackWriteService → member of composed group "writeServices" — no individual cradle key/m,
      );
      assert.match(
        text,
        /group:\s+"writeServices"\s+\(kind: object, base: WriteServiceBase, declared by @media\/core\)/,
      );
      assert.match(text, /`writeServices\.trackWriteService`/);
      assert.match(text, /→ docs: https:\/\/.*concepts\/groups#grouped-means-group-only/);
    });

    it("should still explain the member's registration key as the registration it is", () => {
      // Grouped ⇒ group-only removes the member from the TYPED surface; the registration key stays
      // registered, so explaining it as a registration is what the container actually does.
      const byKey = explainInApp("trackWrite");
      assert.equal(byKey.resolution.kind, "registration");
      assert.equal(byKey.supplier?.packageLabel, "@media/core");
    });
  });

  describe("When the key is an external", () => {
    it("should describe the demand rather than report a miss", () => {
      const report = explainInApp("logger");

      assert.equal(report.resolution.kind, "external");
      assert.equal(
        report.resolution.kind === "external"
          ? report.resolution.typeText
          : undefined,
        "Logger",
      );
      assert.deepEqual(
        report.resolution.kind === "external"
          ? report.resolution.demandedBy.map((d) => d.packageLabel)
          : [],
        ["@apps/api (this app)", "@media/core"],
      );
      // Who demands it, as units — the same question the resolution line answers by package.
      assert.deepEqual(
        report.dependents.map((d) => d.demander),
        ["uploadHandler"],
      );

      const text = formatExplainReport(report, { color: false });
      assert.match(
        text,
        /^logger → external — supplied by the composing app at bootstrap/m,
      );
      assert.match(text, /demanded:\s+Logger/);
    });
  });

  describe("When the key is a scope-root opener", () => {
    it("should stay the app's own answer — an opener is app-local by nature", () => {
      const report = explainInApp("openAuthRouterScope");

      assert.equal(report.resolution.kind, "opener");
      assert.equal(
        report.resolution.kind === "opener"
          ? report.resolution.variantName
          : undefined,
        "authRouter",
      );
      assert.deepEqual(
        report.resolution.kind === "opener" ? report.resolution.lbvKeys : [],
        ["requestId"],
      );
    });
  });

  describe("When the key is nothing the composed picture carries", () => {
    it("should say so and offer the composed keys that look like it", () => {
      const report = explainInApp("s3Storag");

      assert.equal(report.resolution.kind, "unknown");
      assert.deepEqual(
        report.resolution.kind === "unknown"
          ? report.resolution.similarKeys
          : [],
        ["s3Storage"],
      );
      // The scope of the miss is the scope of the search: the composed manifests were read too, so
      // "this package does not register it" would be true and misleading.
      assert.match(
        formatExplainReport(report, { color: false }),
        /is not a key this composition registers/,
      );
    });

    it("should scope 'demanded by nothing' to the composed picture too", () => {
      assert.match(
        formatExplainReport(explainInApp("mediaIndexer"), { color: false }),
        /Demanded by: nothing in the composed picture/,
      );
    });
  });

  describe("When the supplying package's manifest predates lifetime provenance", () => {
    it("should render the lifetime with an honest note, never a guess", () => {
      const report = explainInApp("s3Storage", {
        libraryFeatures: ["dependencyKeys"],
      });

      assert.equal(report.lifetime?.lifetime, "singleton");
      assert.deepEqual(report.lifetime?.provenance, []);
      assert.equal(
        report.lifetime?.degradedNote,
        "provenance not recorded — regenerate @media/core with a current version",
      );
      assert.match(
        formatExplainReport(report, { color: false }),
        /Lifetime: singleton ← provenance not recorded — regenerate @media\/core with a current version/,
      );
    });
  });

  describe("When the supplying package's artifacts may predate its sources", () => {
    const stale: readonly PackageFreshness[] = [
      {
        name: "@media/core",
        sourceId: "@media/core",
        outcome: "success",
        generatedAt: "2026-01-01T00:00:00.000Z",
        currentMatches: false,
      },
    ];

    it("should carry the same caveat a stale validate finding carries", () => {
      const report = explainInApp("s3Storage", { freshness: stale });

      assert.equal(report.possiblyStale, true);
      assert.equal(
        report.stalenessNote,
        "note: @media/core may be stale; this finding may describe the old world",
      );
      assert.match(
        formatExplainReport(report, { color: false }),
        /note: @media\/core may be stale; this finding may describe the old world/,
      );
    });

    it("should leave an answer resting only on fresh packages uncaveated", () => {
      const report = explainInApp("uploadHandler", { freshness: stale });

      assert.equal(report.possiblyStale, undefined);
      assert.equal(report.stalenessNote, undefined);
      assert.deepEqual(report.packages, ["local"]);
    });
  });

  describe("--json", () => {
    it("should carry the composed fields alongside the documented ones", () => {
      const report = explainInApp("s3Storage", {
        freshness: [
          {
            name: "@media/core",
            sourceId: "@media/core",
            outcome: "success",
            generatedAt: "2026-01-01T00:00:00.000Z",
            currentMatches: false,
          },
        ],
      });
      const parsed = JSON.parse(JSON.stringify(report)) as Record<
        string,
        unknown
      >;

      assert.deepEqual(parsed["supplier"], {
        packageLabel: "@media/core",
        sourceId: "@media/core",
      });
      assert.deepEqual(parsed["packages"], ["@media/core"]);
      assert.equal(parsed["possiblyStale"], true);
      assert.ok(typeof parsed["stalenessNote"] === "string");
      // Nothing renamed: the fields explain has always published are still there.
      for (const field of [
        "key",
        "mode",
        "resolution",
        "lifetime",
        "dependencies",
        "dependents",
        "scopeRootSubtrees",
        "notes",
      ]) {
        assert.ok(field in parsed, `${field} missing from --json`);
      }
    });
  });
});
