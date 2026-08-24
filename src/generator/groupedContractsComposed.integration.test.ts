/**
 * Grouped ⇒ group-only ACROSS a package boundary.
 *
 * The law was already enforced for a group declared in the package being generated. It was not
 * enforced for a group declared in a package being COMPOSED, because the index behind it is built
 * by walking nominal heritage over source against `config.groups` — and a composing app has
 * neither the library's sources nor its config. A member of a library's group therefore looked, to
 * the app, like an ordinary composed implementation: a bare demand for it landed on
 * `[named-marker-required]`, which prescribed `Named<MemberContract>` — a spelling the law forbids
 * — and once written, the key drifted out as an unsatisfied `[externals]` in `ioc validate`.
 *
 * Nothing was missing from the manifest. Every generated file states its group roots in full, and
 * the composed-supply loader already merges them across packages the way `composeManifests` will.
 * These tests pin that all four doors now recognize a composed member, that both group kinds are
 * covered, and — the fall-through that started this — that a composed grouped member can no longer
 * reach the externals set at all.
 *
 * The fixture is built on disk per test rather than committed, because half of it is a package
 * under `node_modules` — the shape `contractSlotsComposed.integration.test.ts` uses, for the same
 * reason.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { analyzeDemandSupply } from "./analyzeDemandSupply/index.js";
import { buildComposedGroupDemandIndex } from "./composedGroupMembership.js";
import { contractSlotsForPlans } from "./contractSlotKeys.js";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import { loadComposedManifestSupply } from "./loadComposedManifestUnits.js";
import { buildRegistrationPlan } from "./resolveRegistrationPlan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** The marker's real declaration — the fixture imports it the way a consuming app does. */
const namedModule = path
  .join(__dirname, "../named/named.js")
  .replace(/\\/g, "/");

const LIB = "@test/lib-media";

/**
 * The library manifest, as this generator writes it for a package declaring two groups.
 *
 * `writeServices` is a RECORD group over distinct member contracts — the shape whose guidance can
 * name the member property. Its property keys are the CONTRACT KEYS the generator emits
 * (`awilixCamelCase(contractName)`), not the members' registration keys: `archiveUserWriteService`
 * is keyed by its contract while the container resolves it from `legacyArchiveWriter`, which is the
 * only shape that can tell the two spellings apart. `changeLogSinks` is a COLLECTION group in the
 * equality-acceptance shape, where several implementations return the base contract itself and
 * members are individually anonymous. Both kinds have to be readable from the manifest alone.
 *
 * `AuditSink` is the ungrouped control: two implementations, one elected, so the non-elected one is
 * reachable only through `Named<AuditSink>` — the legitimate cross-package named pick that must not
 * be caught in this net.
 */
const LIBRARY_MANIFEST = `export const iocManifest = {
  manifestSchemaVersion: 3,

  moduleImports: [],

  contracts: {
    ActivatePendingUserWriteService: {
      activatePendingUserWriteService: {
        exportName: "buildActivatePendingUserWriteService",
        registrationKey: "activatePendingUserWriteService",
        modulePath: "services/buildActivatePendingUserWriteService.ts",
        relImport: "../services/buildActivatePendingUserWriteService.js",
        contractName: "ActivatePendingUserWriteService",
        implementationName: "activatePendingUserWriteService",
        lifetime: "scoped",
        moduleIndex: 0,
        dependencyKeys: [],
      },
    },
    ArchiveUserWriteService: {
      legacyArchiveWriter: {
        exportName: "buildLegacyArchiveWriter",
        registrationKey: "legacyArchiveWriter",
        modulePath: "services/buildLegacyArchiveWriter.ts",
        relImport: "../services/buildLegacyArchiveWriter.js",
        contractName: "ArchiveUserWriteService",
        implementationName: "legacyArchiveWriter",
        lifetime: "scoped",
        moduleIndex: 6,
        dependencyKeys: [],
      },
    },
    SuspendUserWriteService: {
      suspendUserWriteService: {
        exportName: "buildSuspendUserWriteService",
        registrationKey: "suspendUserWriteService",
        modulePath: "services/buildSuspendUserWriteService.ts",
        relImport: "../services/buildSuspendUserWriteService.js",
        contractName: "SuspendUserWriteService",
        implementationName: "suspendUserWriteService",
        lifetime: "scoped",
        moduleIndex: 1,
        dependencyKeys: [],
      },
    },
    ChangeLogSink: {
      fileChangeLog: {
        exportName: "buildFileChangeLog",
        registrationKey: "fileChangeLog",
        modulePath: "sinks/buildFileChangeLog.ts",
        relImport: "../sinks/buildFileChangeLog.js",
        contractName: "ChangeLogSink",
        implementationName: "fileChangeLog",
        lifetime: "singleton",
        moduleIndex: 2,
        dependencyKeys: [],
      },
      wireChangeLog: {
        exportName: "buildWireChangeLog",
        registrationKey: "wireChangeLog",
        modulePath: "sinks/buildWireChangeLog.ts",
        relImport: "../sinks/buildWireChangeLog.js",
        contractName: "ChangeLogSink",
        implementationName: "wireChangeLog",
        lifetime: "singleton",
        moduleIndex: 3,
        dependencyKeys: [],
      },
    },
    AuditSink: {
      primaryAuditSink: {
        exportName: "buildPrimaryAuditSink",
        registrationKey: "primaryAuditSink",
        modulePath: "audit/buildPrimaryAuditSink.ts",
        relImport: "../audit/buildPrimaryAuditSink.js",
        contractName: "AuditSink",
        implementationName: "primaryAuditSink",
        lifetime: "singleton",
        moduleIndex: 4,
        default: true,
        dependencyKeys: [],
      },
      backupAuditSink: {
        exportName: "buildBackupAuditSink",
        registrationKey: "backupAuditSink",
        modulePath: "audit/buildBackupAuditSink.ts",
        relImport: "../audit/buildBackupAuditSink.js",
        contractName: "AuditSink",
        implementationName: "backupAuditSink",
        lifetime: "singleton",
        moduleIndex: 5,
        dependencyKeys: [],
      },
    },
  },

  writeServices: {
    kind: "object",
    baseType: "WriteService",
    baseTypeId: "@test/lib-media/src/types/WriteService.ts:WriteService",
    members: {
      activatePendingUserWriteService: {
        contractName: "ActivatePendingUserWriteService",
        registrationKey: "activatePendingUserWriteService",
      },
      archiveUserWriteService: {
        contractName: "ArchiveUserWriteService",
        registrationKey: "legacyArchiveWriter",
      },
      suspendUserWriteService: {
        contractName: "SuspendUserWriteService",
        registrationKey: "suspendUserWriteService",
      },
    },
  },

  changeLogSinks: {
    kind: "collection",
    baseType: "ChangeLogSink",
    baseTypeId: "@test/lib-media/src/types/ChangeLogSink.ts:ChangeLogSink",
    members: [
      { contractName: "ChangeLogSink", registrationKey: "fileChangeLog" },
      { contractName: "ChangeLogSink", registrationKey: "wireChangeLog" },
    ],
  },
} as const;

export const IOC_MANIFEST_FEATURES = ["dependencyKeys"] as const;
`;

const APP_CONTRACTS = `export interface WriteService {
  run: (input: string) => string;
}
export interface ActivatePendingUserWriteService extends WriteService {
  readonly op: "activate";
}
export interface ArchiveUserWriteService extends WriteService {
  readonly op: "archive";
}
export interface ChangeLogSink {
  write: (line: string) => void;
}
export interface AuditSink {
  audit: (line: string) => void;
}
export interface AuthService {
  authenticate: (token: string) => string;
}
`;

/** The consumer under test, parameterised by how it spells the demand. */
const appAuthService = (property: string): string =>
  `import type { Named } from "${namedModule}";
import type {
  ActivatePendingUserWriteService,
  ArchiveUserWriteService,
  AuditSink,
  AuthService,
  ChangeLogSink,
  WriteService,
} from "../contracts.js";

type Deps = {
  ${property}
};

export const buildAuthService = (deps: Deps): AuthService => ({
  authenticate: (token: string) => JSON.stringify(Object.keys(deps)) + token,
});

void (undefined as unknown as [
  ActivatePendingUserWriteService,
  ArchiveUserWriteService,
  AuditSink,
  ChangeLogSink,
  WriteService,
  Named<AuditSink>,
]);
`;

const buildFixture = (
  depsProperty: string,
): { projectRoot: string; files: string[]; scanDirs: { absPath: string }[] } => {
  const root = mkdtempSync(path.join(tmpdir(), "ioc-grouped-composed-"));
  const srcDir = path.join(root, "src");
  const factoriesDir = path.join(srcDir, "factories");
  mkdirSync(factoriesDir, { recursive: true });

  const pkgDir = path.join(root, "node_modules", ...LIB.split("/"));
  mkdirSync(path.join(pkgDir, "generated"), { recursive: true });
  writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: LIB,
      exports: { "./iocManifest": "./generated/ioc-manifest.ts" },
    }),
  );
  writeFileSync(
    path.join(pkgDir, "generated", "ioc-manifest.ts"),
    LIBRARY_MANIFEST,
  );

  writeFileSync(path.join(srcDir, "contracts.ts"), APP_CONTRACTS);
  const authPath = path.join(factoriesDir, "buildAuthService.ts");
  writeFileSync(authPath, appAuthService(depsProperty));

  return {
    projectRoot: root,
    files: [path.join(srcDir, "contracts.ts"), authPath],
    scanDirs: [{ absPath: factoriesDir }],
  };
};

/**
 * The outcome of one generation, as a VALUE rather than as a throw.
 *
 * Deliberate: the whole point of this change is that one spelling now produces a diagnostic where
 * it used to produce an externals row, so the two outcomes have to be comparable in one assertion
 * rather than one being a rejection and the other a return.
 */
type Outcome =
  | { kind: "error"; message: string }
  | { kind: "ok"; externalKeys: readonly string[] };

/** Discovers, plans, loads composed supply and runs demand/supply — `generateManifest`'s order. */
const analyze = async (depsProperty: string): Promise<Outcome> => {
  const fixture = buildFixture(depsProperty);
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
  const { contractMap, acceptedFactories, scopeRoots } = discoverFactories(
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
    [LIB],
  );
  const composedGroupDemand = buildComposedGroupDemandIndex(composedSupply);

  try {
    const demandSupply = analyzeDemandSupply(acceptedFactories, {
      program,
      projectRoot: fixture.projectRoot,
      scanDirs: fixture.scanDirs,
      generatedDir,
      scopeRoots,
      contractSlots: contractSlotsForPlans(plans),
      composedImplementations: composedSupply.units.map((unit) => ({
        registrationKey: unit.registrationKey,
        contractName: unit.contractName,
        packageName: unit.packageName,
      })),
      composedSlots: composedSupply.accessKeys,
      groupMemberships: composedGroupDemand.membershipByContractName,
      absentGroupedSlotKeys: composedGroupDemand.absentSlotKeyToContractName,
    });
    return { kind: "ok", externalKeys: demandSupply.externalKeys };
  } catch (error: unknown) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

const errorFor = async (depsProperty: string): Promise<string> => {
  const outcome = await analyze(depsProperty);
  assert.equal(
    outcome.kind,
    "error",
    `expected a diagnostic for \`${depsProperty}\``,
  );
  return (outcome as { kind: "error"; message: string }).message;
};

describe("composed group membership reaches the composed-supply loader", () => {
  describe("When a composed manifest declares group roots", () => {
    it("should carry both kinds with per-member contract names", async () => {
      const fixture = buildFixture("auditSink: AuditSink;");
      const supply = await loadComposedManifestSupply(fixture.projectRoot, [
        LIB,
      ]);

      const record = supply.groupRootsByGroupKey.get("writeServices")!;
      assert.equal(record.kind, "object");
      assert.equal(record.baseType, "WriteService");
      assert.deepEqual(record.packageNames, [LIB]);
      // `memberProperty` is the record's own KEY — the property `registerGroups` builds the group
      // value under — and never the member's registration key. The middle row is the proof: the
      // container resolves it from "legacyArchiveWriter" and exposes it as `archiveUserWriteService`.
      assert.deepEqual(
        record.members.map((m) => [m.contractName, m.registrationKey, m.memberProperty]),
        [
          [
            "ActivatePendingUserWriteService",
            "activatePendingUserWriteService",
            "activatePendingUserWriteService",
          ],
          [
            "ArchiveUserWriteService",
            "legacyArchiveWriter",
            "archiveUserWriteService",
          ],
          [
            "SuspendUserWriteService",
            "suspendUserWriteService",
            "suspendUserWriteService",
          ],
        ],
      );

      const collection = supply.groupRootsByGroupKey.get("changeLogSinks")!;
      assert.equal(collection.kind, "collection");
      assert.equal(collection.baseType, "ChangeLogSink");
      // A collection group's members are individually anonymous, so there is no property to name.
      assert.deepEqual(
        collection.members.map((m) => m.memberProperty),
        [undefined, undefined],
      );
    });

    it("should make the base grouped even though nothing registers it", async () => {
      const fixture = buildFixture("auditSink: AuditSink;");
      const supply = await loadComposedManifestSupply(fixture.projectRoot, [
        LIB,
      ]);
      const index = buildComposedGroupDemandIndex(supply);

      // The base is the family's own name: a demand for ITS would-be contract key is the group
      // mistake too, which is what door four is about.
      assert.equal(
        index.membershipByContractName.get("WriteService")?.groupKey,
        "writeServices",
      );
      assert.equal(
        index.absentSlotKeyToContractName.get("writeService"),
        "WriteService",
      );
    });
  });
});

describe("the four doors against a composed grouped member", () => {
  const doors = [
    {
      name: "the bare member key",
      property: "activatePendingUserWriteService: ActivatePendingUserWriteService;",
      key: "activatePendingUserWriteService",
    },
    {
      name: "Named<MemberContract>",
      property:
        "activatePendingUserWriteService: Named<ActivatePendingUserWriteService>;",
      key: "activatePendingUserWriteService",
    },
    {
      name: "Named<GroupBase>",
      property: "activatePendingUserWriteService: Named<WriteService>;",
      key: "activatePendingUserWriteService",
    },
    {
      name: "the grouped contract's would-be contract key",
      property: "writeService: WriteService;",
      key: "writeService",
    },
  ] as const;

  for (const door of doors) {
    describe(`When a composed member is demanded through ${door.name}`, () => {
      it("should land on the grouped-member error naming the composed group", async () => {
        const message = await errorFor(door.property);

        assert.match(message, /\[grouped-member-demand\]/);
        assert.ok(message.includes(JSON.stringify(door.key)));
        // The group named is the LIBRARY's, read off its manifest — now a labeled field.
        assert.match(message, /^ +group: +"writeServices"$/m);
        assert.match(message, /^ +site: +\S+\.ts:\d+ {2}\(Factory "buildAuthService"\)$/m);
        // Beat 1: consume through the group — and a record group can name the property.
        assert.match(
          message,
          /Consume it through the group: `writeServices: WriteServices`/,
        );
        // The property is the group value's own KEY. Never the contract's type name — a property
        // spelled `WriteServices.ActivatePendingUserWriteService` does not exist on the group.
        assert.doesNotMatch(message, /writeServices\.[A-Z]/);
        // Beat 2: the kind is the lever.
        assert.match(message, /the group's `kind` is the lever/);
        // Beat 3: the deferred design question, by its section name.
        assert.match(
          message,
          /Consumer-divergent group consumption — considered, deferred/,
        );
      });

      it("should never prescribe a spelling the group law forbids", async () => {
        const message = await errorFor(door.property);

        // The field report: `named-marker-required` told the reader to write
        // `Named<ActivatePendingUserWriteService>`, which rider 1 forbids against a grouped member.
        assert.doesNotMatch(message, /named-marker-required/);
        assert.doesNotMatch(message, /named-contract-mismatch/);
        assert.doesNotMatch(message, /named-unknown-key/);
        assert.doesNotMatch(message, /elects no default, so it has no contract key/);
      });
    });
  }

  describe("When the demanded member's registration key differs from its contract key", () => {
    /**
     * The one shape that can tell the two candidate spellings apart.
     *
     * `legacyArchiveWriter` is the registration key the container resolves from;
     * `archiveUserWriteService` is the property the group value actually exposes, because
     * `registerGroups` builds a record group from its own property keys
     * (`resolveGroupNodeFromCradle`). Suggesting the registration key would name a property that is
     * not there — the diagnostic would be telling the reader to write something that fails.
     */
    it("should suggest the record's property key, not the registration key", async () => {
      const message = await errorFor("legacyArchiveWriter: Named<ArchiveUserWriteService>;");

      assert.match(message, /\[grouped-member-demand\]/);
      assert.match(
        message,
        /then `writeServices\.archiveUserWriteService`/,
      );
      assert.doesNotMatch(message, /writeServices\.legacyArchiveWriter/);
      assert.doesNotMatch(message, /writeServices\.ArchiveUserWriteService/);
    });

    it("should still name the demanded key as the offender", async () => {
      const message = await errorFor("legacyArchiveWriter: Named<ArchiveUserWriteService>;");
      assert.ok(message.includes('"legacyArchiveWriter"'));
    });
  });

  describe("When a member of a composed COLLECTION group is demanded", () => {
    it("should say the members are anonymous rather than name a property", async () => {
      const message = await errorFor("fileChangeLog: ChangeLogSink;");

      assert.match(message, /\[grouped-member-demand\]/);
      assert.match(message, /^ +group: +"changeLogSinks"$/m);
      assert.match(
        message,
        /a collection group's members are individually anonymous by declaration/,
      );
      assert.doesNotMatch(message, /named-marker-required/);
    });
  });
});

describe("the externals fall-through for a composed grouped member", () => {
  /**
   * The fall-through this change closes, pinned against a same-shaped control.
   *
   * `Named<AuditSink>` on `backupAuditSink` is the legitimate cross-package named pick: composed
   * keys are supplied by composition, so it lands in `IocExternals` — which is exactly where the
   * grouped member used to land once the reader followed `named-marker-required`'s advice. The two
   * assertions together are the before and after: identical spelling, opposite outcome, decided by
   * nothing but whether the composed manifest says the contract is grouped.
   */
  it("should still route an UNGROUPED composed implementation to externals", async () => {
    const outcome = await analyze("backupAuditSink: Named<AuditSink>;");

    assert.equal(outcome.kind, "ok");
    assert.ok(
      (outcome as { kind: "ok"; externalKeys: readonly string[] }).externalKeys.includes(
        "backupAuditSink",
      ),
    );
  });

  it("should make externals impossible for a composed group's member", async () => {
    const outcome = await analyze(
      "activatePendingUserWriteService: Named<ActivatePendingUserWriteService>;",
    );

    assert.equal(outcome.kind, "error");
    assert.match(
      (outcome as { kind: "error"; message: string }).message,
      /\[grouped-member-demand\]/,
    );
    // There is no externals row to inspect: the run never reaches one. That IS the fix — the key
    // can no longer be emitted into `IocExternals` and surface later as an unsatisfied demand in
    // another package's `ioc validate`.
    assert.doesNotMatch(
      (outcome as { kind: "error"; message: string }).message,
      /externals/i,
    );
  });
});
