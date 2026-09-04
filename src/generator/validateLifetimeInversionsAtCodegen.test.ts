import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IocConfig } from "../config/iocConfig.js";
import type { IocGroupsManifest } from "../core/manifest.js";
import type { DemandSupplyAnalysisResult } from "./analyzeDemandSupply/index.js";
import type {
  ComposedGroupRoot,
  ComposedManifestSupply,
  ComposedManifestUnit,
} from "./loadComposedManifestUnits.js";
import type { ResolvedContractRegistration } from "./resolveRegistrationPlan.js";
import type { DiscoveredFactory } from "./types.js";
import { validateLifetimeInversionsAtCodegen } from "./validateLifetimeInversionsAtCodegen.js";

const mkFactory = (
  partial: Pick<DiscoveredFactory, "contractName" | "implementationName"> &
    Partial<DiscoveredFactory>,
): DiscoveredFactory => ({
  contractTypeRelImport: "../fixtures/contracts.js",
  exportName: "buildX",
  registrationKey: partial.registrationKey ?? partial.implementationName,
  modulePath: partial.modulePath ?? "fixtures/impl.ts",
  relImport: partial.relImport ?? "../fixtures/impl.js",
  ...partial,
});

const mkPlan = (
  partial: Pick<
    ResolvedContractRegistration,
    | "contractName"
    | "contractTypeRelImport"
    | "defaultImplementationName"
    | "implementations"
  > &
    Partial<ResolvedContractRegistration>,
): ResolvedContractRegistration => {
  const contractKey =
    partial.contractKey ??
    partial.contractName[0]!.toLowerCase() + partial.contractName.slice(1);
  return {
    ...partial,
    contractKey,
    accessKey: partial.accessKey ?? contractKey,
  };
};

const mkDemandSupply = (
  partial: Partial<DemandSupplyAnalysisResult> = {},
): DemandSupplyAnalysisResult => ({
  entries: partial.entries ?? [],
  externalKeys: partial.externalKeys ?? [],
  scopeProvidedKeys: partial.scopeProvidedKeys ?? [],
});

/**
 * Composed supply in the shape `loadComposedManifestSupply` returns it, from unit and root literals.
 *
 * The integration fixture in `groupedContractsComposed.integration.test.ts` builds the same library
 * — `@test/lib-media`, a `writeServices` RECORD group over three scoped members — by writing a
 * manifest to disk and parsing it. Here the parse is not the thing under test, so the parsed shape
 * is stated directly and the cases stay readable.
 */
const mkComposedSupply = (
  units: readonly ComposedManifestUnit[],
  roots: readonly ComposedGroupRoot[] = [],
  accessKeys: readonly (readonly [string, string])[] = [],
): ComposedManifestSupply => ({
  units,
  accessKeys: new Map(accessKeys),
  groupMembersByGroupKey: new Map(
    roots.map((root) => [
      root.groupKey,
      root.members.map((member) => member.registrationKey),
    ]),
  ),
  groupRootsByGroupKey: new Map(roots.map((root) => [root.groupKey, root])),
  packagesWithoutDependencyData: [],
  packagesWithoutLifetimeProvenance: [],
  unreadablePackages: [],
});

const LIB = "@test/lib-media";

const mkComposedUnit = (
  contractName: string,
  registrationKey: string,
  lifetime: ComposedManifestUnit["lifetime"],
  isDefault = false,
): ComposedManifestUnit => ({
  packageName: LIB,
  contractName,
  implementationName: registrationKey,
  registrationKey,
  exportName: `build${contractName}`,
  modulePath: `${LIB}/services/build${contractName}.ts`,
  lifetime,
  isDefault,
  dependencyKeys: [],
});

/** The three scoped members of the library's `writeServices` record group. */
const WRITE_SERVICE_UNITS: readonly ComposedManifestUnit[] = [
  mkComposedUnit(
    "ActivatePendingUserWriteService",
    "activatePendingUserWriteService",
    "scoped",
  ),
  mkComposedUnit("ArchiveUserWriteService", "legacyArchiveWriter", "scoped"),
  mkComposedUnit(
    "SuspendUserWriteService",
    "suspendUserWriteService",
    "scoped",
  ),
];

/**
 * The composed record group, keyed by CONTRACT KEY rather than registration key.
 *
 * `archiveUserWriteService` is the property a reader writes; `legacyArchiveWriter` is what the
 * container resolves. A diagnostic that printed the second where the first belongs would name a
 * spelling that appears nowhere in the consuming app.
 */
const writeServicesRoot: ComposedGroupRoot = {
  groupKey: "writeServices",
  kind: "object",
  baseType: "WriteService",
  packageNames: [LIB],
  members: [
    {
      contractName: "ActivatePendingUserWriteService",
      registrationKey: "activatePendingUserWriteService",
      memberProperty: "activatePendingUserWriteService",
    },
    {
      contractName: "ArchiveUserWriteService",
      registrationKey: "legacyArchiveWriter",
      memberProperty: "archiveUserWriteService",
    },
    {
      contractName: "SuspendUserWriteService",
      registrationKey: "suspendUserWriteService",
      memberProperty: "suspendUserWriteService",
    },
  ],
};

/** The consuming app's singleton, which demands the group root and nothing else. */
const authServicePlan = mkPlan({
  contractName: "AuthService",
  contractTypeRelImport: "../fixtures/contracts.js",
  contractKey: "authService",
  defaultImplementationName: "authService",
  implementations: [
    {
      implementationName: "authService",
      exportName: "buildAuthService",
      modulePath: "fixtures/auth.ts",
      relImport: "../fixtures/auth.js",
      registrationKey: "authService",
      lifetime: "singleton",
    },
  ],
});

const authServiceFactory = (dependencyKeys: readonly string[]) =>
  mkFactory({
    contractName: "AuthService",
    implementationName: "authService",
    registrationKey: "authService",
    dependencyKeys,
  });

const captureWarnings = (fn: () => void): string[] => {
  const warnings: string[] = [];
  const prevWarn = console.warn;
  console.warn = (msg: unknown) => {
    warnings.push(String(msg));
  };
  try {
    fn();
  } finally {
    console.warn = prevWarn;
  }
  return warnings;
};

const grantRepositoryPlan = mkPlan({
  contractName: "GrantRepository",
  contractTypeRelImport: "../fixtures/contracts.js",
  contractKey: "grantRepository",
  defaultImplementationName: "grantRepository",
  implementations: [
    {
      implementationName: "grantRepository",
      exportName: "buildGrantRepository",
      modulePath: "fixtures/repo.ts",
      relImport: "../fixtures/repo.js",
      registrationKey: "grantRepository",
      lifetime: "scoped",
    },
  ],
});

const grantSyncFactory = mkFactory({
  contractName: "GrantSync",
  implementationName: "grantSync",
  exportName: "buildGrantSync",
  registrationKey: "grantSync",
  dependencyKeys: ["grantRepository"],
});

describe("validateLifetimeInversionsAtCodegen", () => {
  describe("When a singleton consumer depends on a scoped registration key", () => {
    it("should throw naming both keys and lifetimes", () => {
      const plans = [
        grantRepositoryPlan,
        mkPlan({
          contractName: "GrantSync",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "grantSync",
          defaultImplementationName: "grantSync",
          implementations: [
            {
              implementationName: "grantSync",
              exportName: "buildGrantSync",
              modulePath: "fixtures/sync.ts",
              relImport: "../fixtures/sync.js",
              registrationKey: "grantSync",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      assert.throws(
        () =>
          validateLifetimeInversionsAtCodegen(
            [grantSyncFactory],
            plans,
            undefined,
            mkDemandSupply(),
            undefined,
          ),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /'grantSync' \(singleton\)/);
          assert.match(err.message, /'grantRepository' \(scoped\)/);
          assert.match(err.message, /allowLifetimeInversion/);
          return true;
        },
      );
    });
  });

  describe("When a singleton consumer depends on a transient registration key", () => {
    it("should warn and not throw", () => {
      const plans = [
        mkPlan({
          contractName: "Token",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "token",
          defaultImplementationName: "token",
          implementations: [
            {
              implementationName: "token",
              exportName: "buildToken",
              modulePath: "fixtures/token.ts",
              relImport: "../fixtures/token.js",
              registrationKey: "token",
              lifetime: "transient",
            },
          ],
        }),
        mkPlan({
          contractName: "GrantSync",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "grantSync",
          defaultImplementationName: "grantSync",
          implementations: [
            {
              implementationName: "grantSync",
              exportName: "buildGrantSync",
              modulePath: "fixtures/sync.ts",
              relImport: "../fixtures/sync.js",
              registrationKey: "grantSync",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      const warnings = captureWarnings(() => {
        validateLifetimeInversionsAtCodegen(
          [
            mkFactory({
              contractName: "GrantSync",
              implementationName: "grantSync",
              registrationKey: "grantSync",
              dependencyKeys: ["token"],
            }),
          ],
          plans,
          undefined,
          mkDemandSupply(),
          undefined,
        );
      });

      assert.strictEqual(warnings.length, 1);
      assert.match(
        warnings[0]!,
        /\[ioc\] \[lifetime-inversion\] 'grantSync' \(singleton\)/,
      );
      assert.match(warnings[0]!, /'token' \(transient\)/);
    });

    it("should name the runtime consequence — this warned edge throws under the default runtime", () => {
      const plans = [
        mkPlan({
          contractName: "Token",
          contractTypeRelImport: "../fixtures/contracts.js",
          implementations: [
            {
              exportName: "buildToken",
              implementationName: "token",
              modulePath: "fixtures/token.ts",
              relImport: "../fixtures/token.js",
              registrationKey: "token",
              lifetime: "transient",
            },
          ],
        }),
        mkPlan({
          contractName: "GrantSync",
          contractTypeRelImport: "../fixtures/contracts.js",
          implementations: [
            {
              exportName: "buildGrantSync",
              implementationName: "grantSync",
              modulePath: "fixtures/sync.ts",
              relImport: "../fixtures/sync.js",
              registrationKey: "grantSync",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      const warnings = captureWarnings(() => {
        validateLifetimeInversionsAtCodegen(
          [
            mkFactory({
              contractName: "GrantSync",
              implementationName: "grantSync",
              registrationKey: "grantSync",
              dependencyKeys: ["token"],
            }),
          ],
          plans,
          undefined,
          mkDemandSupply(),
          undefined,
        );
      });

      /* The severity gap made honest where it fires: our model warns, the default runtime errors. */
      assert.match(
        warnings[0]!,
        /Under the default runtime this edge throws at first resolve/,
      );
      assert.match(warnings[0]!, /Awilix strict mode unless you pass/);
      assert.match(
        warnings[0]!,
        /allowLifetimeInversion` suppresses this report only — it is not a runtime exemption/,
      );
    });
  });

  describe("When a scoped consumer depends on a transient registration key", () => {
    it("should warn and not throw", () => {
      const plans = [
        mkPlan({
          contractName: "Token",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "token",
          defaultImplementationName: "token",
          implementations: [
            {
              implementationName: "token",
              exportName: "buildToken",
              modulePath: "fixtures/token.ts",
              relImport: "../fixtures/token.js",
              registrationKey: "token",
              lifetime: "transient",
            },
          ],
        }),
        mkPlan({
          contractName: "RequestScope",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "requestScope",
          defaultImplementationName: "requestScope",
          implementations: [
            {
              implementationName: "requestScope",
              exportName: "buildRequestScope",
              modulePath: "fixtures/request.ts",
              relImport: "../fixtures/request.js",
              registrationKey: "requestScope",
              lifetime: "scoped",
            },
          ],
        }),
      ];

      const warnings = captureWarnings(() => {
        validateLifetimeInversionsAtCodegen(
          [
            mkFactory({
              contractName: "RequestScope",
              implementationName: "requestScope",
              registrationKey: "requestScope",
              dependencyKeys: ["token"],
            }),
          ],
          plans,
          undefined,
          mkDemandSupply(),
          undefined,
        );
      });

      assert.strictEqual(warnings.length, 1);
      assert.match(warnings[0]!, /'requestScope' \(scoped\)/);
      assert.match(warnings[0]!, /'token' \(transient\)/);
    });
  });

  describe("When lifetimes are equal or the dependency outlives the consumer", () => {
    it("should produce no findings", () => {
      const plans = [
        mkPlan({
          contractName: "A",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "a",
          defaultImplementationName: "a",
          implementations: [
            {
              implementationName: "a",
              exportName: "buildA",
              modulePath: "fixtures/a.ts",
              relImport: "../fixtures/a.js",
              registrationKey: "a",
              lifetime: "singleton",
            },
          ],
        }),
        mkPlan({
          contractName: "B",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "b",
          defaultImplementationName: "b",
          implementations: [
            {
              implementationName: "b",
              exportName: "buildB",
              modulePath: "fixtures/b.ts",
              relImport: "../fixtures/b.js",
              registrationKey: "b",
              lifetime: "scoped",
            },
          ],
        }),
        mkPlan({
          contractName: "C",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "c",
          defaultImplementationName: "c",
          implementations: [
            {
              implementationName: "c",
              exportName: "buildC",
              modulePath: "fixtures/c.ts",
              relImport: "../fixtures/c.js",
              registrationKey: "c",
              lifetime: "transient",
            },
          ],
        }),
      ];

      const warnings = captureWarnings(() => {
        validateLifetimeInversionsAtCodegen(
          [
            mkFactory({
              contractName: "A",
              implementationName: "a",
              registrationKey: "a",
              dependencyKeys: ["a"],
            }),
            mkFactory({
              contractName: "B",
              implementationName: "b",
              registrationKey: "b",
              dependencyKeys: ["b"],
            }),
            mkFactory({
              contractName: "C",
              implementationName: "c",
              registrationKey: "c",
              dependencyKeys: ["a"],
            }),
          ],
          plans,
          undefined,
          mkDemandSupply(),
          undefined,
        );
      });

      assert.deepStrictEqual(warnings, []);
    });
  });

  describe("When a singleton consumer depends on a scope-provided key", () => {
    it("should throw treating the dependency as scoped", () => {
      const plans = [
        mkPlan({
          contractName: "GrantSync",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "grantSync",
          defaultImplementationName: "grantSync",
          implementations: [
            {
              implementationName: "grantSync",
              exportName: "buildGrantSync",
              modulePath: "fixtures/sync.ts",
              relImport: "../fixtures/sync.js",
              registrationKey: "grantSync",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      assert.throws(
        () =>
          validateLifetimeInversionsAtCodegen(
            [
              mkFactory({
                contractName: "GrantSync",
                implementationName: "grantSync",
                registrationKey: "grantSync",
                dependencyKeys: ["viewerId"],
              }),
            ],
            plans,
            undefined,
            mkDemandSupply({
              entries: [
                {
                  key: "viewerId",
                  typeRef: { typeName: "string", imports: [] },
                  classification: "scope-provided",
                },
              ],
              scopeProvidedKeys: ["viewerId"],
            }),
            undefined,
          ),
        /'viewerId' \(scope-provided, per-request\)/,
      );
    });
  });

  describe("When a singleton consumer depends on a group with a scoped member", () => {
    it("should throw naming the group member", () => {
      const plans = [
        grantRepositoryPlan,
        mkPlan({
          contractName: "GrantSync",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "grantSync",
          defaultImplementationName: "grantSync",
          implementations: [
            {
              implementationName: "grantSync",
              exportName: "buildGrantSync",
              modulePath: "fixtures/sync.ts",
              relImport: "../fixtures/sync.js",
              registrationKey: "grantSync",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      const groups: IocGroupsManifest = {
        channels: {
          kind: "object",
          baseType: "Channels",
          baseTypeId: "channels-id",
          members: {
            grantRepository: {
              contractName: "GrantRepository",
              registrationKey: "grantRepository",
            },
          },
        },
      };

      assert.throws(
        () =>
          validateLifetimeInversionsAtCodegen(
            [
              mkFactory({
                contractName: "GrantSync",
                implementationName: "grantSync",
                registrationKey: "grantSync",
                dependencyKeys: ["channels"],
              }),
            ],
            plans,
            groups,
            mkDemandSupply(),
            undefined,
          ),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(
            err.message,
            /via group 'channels' member 'grantRepository'/,
          );
          assert.match(err.message, /'grantRepository' \(scoped\)/);
          return true;
        },
      );
    });
  });

  describe("When a singleton consumer depends on an accessKey whose default impl is scoped", () => {
    it("should throw resolving through the accessKey", () => {
      const plans = [
        mkPlan({
          contractName: "GrantRepository",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "grantRepository",
          accessKey: "repo",
          defaultImplementationName: "grantRepository",
          implementations: [
            {
              implementationName: "grantRepository",
              exportName: "buildGrantRepository",
              modulePath: "fixtures/repo.ts",
              relImport: "../fixtures/repo.js",
              registrationKey: "grantRepositoryImpl",
              lifetime: "scoped",
            },
          ],
        }),
        mkPlan({
          contractName: "GrantSync",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "grantSync",
          defaultImplementationName: "grantSync",
          implementations: [
            {
              implementationName: "grantSync",
              exportName: "buildGrantSync",
              modulePath: "fixtures/sync.ts",
              relImport: "../fixtures/sync.js",
              registrationKey: "grantSync",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      assert.throws(
        () =>
          validateLifetimeInversionsAtCodegen(
            [
              mkFactory({
                contractName: "GrantSync",
                implementationName: "grantSync",
                registrationKey: "grantSync",
                dependencyKeys: ["repo"],
              }),
            ],
            plans,
            undefined,
            mkDemandSupply(),
            undefined,
          ),
        /'repo' \(scoped\)/,
      );
    });
  });

  describe("When allowLifetimeInversion suppresses findings", () => {
    it("should drop all inversions when true", () => {
      const plans = [
        grantRepositoryPlan,
        mkPlan({
          contractName: "GrantSync",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "grantSync",
          defaultImplementationName: "grantSync",
          implementations: [
            {
              implementationName: "grantSync",
              exportName: "buildGrantSync",
              modulePath: "fixtures/sync.ts",
              relImport: "../fixtures/sync.js",
              registrationKey: "grantSync",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      const config: IocConfig = {
        registrations: {
          GrantSync: {
            grantSync: {
              allowLifetimeInversion: true,
            },
          },
        },
      };

      const warnings = captureWarnings(() => {
        validateLifetimeInversionsAtCodegen(
          [grantSyncFactory],
          plans,
          undefined,
          mkDemandSupply(),
          config,
        );
      });

      assert.deepStrictEqual(warnings, []);
    });

    it("should suppress only the listed dep key and still throw for other inversions", () => {
      const plans = [
        grantRepositoryPlan,
        mkPlan({
          contractName: "AuditLog",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "auditLog",
          defaultImplementationName: "auditLog",
          implementations: [
            {
              implementationName: "auditLog",
              exportName: "buildAuditLog",
              modulePath: "fixtures/audit.ts",
              relImport: "../fixtures/audit.js",
              registrationKey: "auditLog",
              lifetime: "scoped",
            },
          ],
        }),
        mkPlan({
          contractName: "GrantSync",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "grantSync",
          defaultImplementationName: "grantSync",
          implementations: [
            {
              implementationName: "grantSync",
              exportName: "buildGrantSync",
              modulePath: "fixtures/sync.ts",
              relImport: "../fixtures/sync.js",
              registrationKey: "grantSync",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      const config: IocConfig = {
        registrations: {
          GrantSync: {
            grantSync: {
              allowLifetimeInversion: ["grantRepository"],
            },
          },
        },
      };

      assert.throws(
        () =>
          validateLifetimeInversionsAtCodegen(
            [
              mkFactory({
                contractName: "GrantSync",
                implementationName: "grantSync",
                registrationKey: "grantSync",
                dependencyKeys: ["grantRepository", "auditLog"],
              }),
            ],
            plans,
            undefined,
            mkDemandSupply(),
            config,
          ),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /'auditLog' \(scoped\)/);
          assert.doesNotMatch(err.message, /'grantRepository' \(scoped\)/);
          return true;
        },
      );
    });
  });

  describe("When the inversion is error-level", () => {
    it("should NOT carry the runtime-consequence sentence — generation refuses, so no runtime is reached", () => {
      const plans = [
        mkPlan({
          contractName: "RequestScope",
          contractTypeRelImport: "../fixtures/contracts.js",
          implementations: [
            {
              exportName: "buildRequestScope",
              implementationName: "requestScope",
              modulePath: "fixtures/scope.ts",
              relImport: "../fixtures/scope.js",
              registrationKey: "requestScope",
              lifetime: "scoped",
            },
          ],
        }),
        mkPlan({
          contractName: "GrantSync",
          contractTypeRelImport: "../fixtures/contracts.js",
          implementations: [
            {
              exportName: "buildGrantSync",
              implementationName: "grantSync",
              modulePath: "fixtures/sync.ts",
              relImport: "../fixtures/sync.js",
              registrationKey: "grantSync",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      assert.throws(
        () =>
          validateLifetimeInversionsAtCodegen(
            [
              mkFactory({
                contractName: "GrantSync",
                implementationName: "grantSync",
                registrationKey: "grantSync",
                dependencyKeys: ["requestScope"],
              }),
            ],
            plans,
            undefined,
            mkDemandSupply(),
            undefined,
          ),
        (err: Error) =>
          !err.message.includes("Under the default runtime this edge throws"),
      );
    });
  });

  describe("When multiple error-level inversions exist", () => {
    it("should aggregate them into one thrown Error", () => {
      const plans = [
        grantRepositoryPlan,
        mkPlan({
          contractName: "AuditLog",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "auditLog",
          defaultImplementationName: "auditLog",
          implementations: [
            {
              implementationName: "auditLog",
              exportName: "buildAuditLog",
              modulePath: "fixtures/audit.ts",
              relImport: "../fixtures/audit.js",
              registrationKey: "auditLog",
              lifetime: "scoped",
            },
          ],
        }),
        mkPlan({
          contractName: "GrantSync",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "grantSync",
          defaultImplementationName: "grantSync",
          implementations: [
            {
              implementationName: "grantSync",
              exportName: "buildGrantSync",
              modulePath: "fixtures/sync.ts",
              relImport: "../fixtures/sync.js",
              registrationKey: "grantSync",
              lifetime: "singleton",
            },
          ],
        }),
        mkPlan({
          contractName: "ReportSync",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "reportSync",
          defaultImplementationName: "reportSync",
          implementations: [
            {
              implementationName: "reportSync",
              exportName: "buildReportSync",
              modulePath: "fixtures/report.ts",
              relImport: "../fixtures/report.js",
              registrationKey: "reportSync",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      assert.throws(
        () =>
          validateLifetimeInversionsAtCodegen(
            [
              mkFactory({
                contractName: "GrantSync",
                implementationName: "grantSync",
                registrationKey: "grantSync",
                dependencyKeys: ["grantRepository"],
              }),
              mkFactory({
                contractName: "ReportSync",
                implementationName: "reportSync",
                registrationKey: "reportSync",
                dependencyKeys: ["auditLog"],
              }),
            ],
            plans,
            undefined,
            mkDemandSupply(),
            undefined,
          ),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          const lines = err.message.split("\n");
          // Three registers, then the offenders: sentence, docs pointer, one line per inversion,
          // one fix line for the run.
          assert.strictEqual(lines.length, 5);
          assert.match(lines[0]!, /^\[ioc\] 2 lifetime inversions\./);
          assert.match(lines[1]!, /^→ docs: https:\/\/.*concepts\/lifetimes#/);
          assert.match(
            lines[2]!,
            /'grantSync' \(singleton\).*'grantRepository' \(scoped\)/,
          );
          assert.match(
            lines[3]!,
            /'reportSync' \(singleton\).*'auditLog' \(scoped\)/,
          );
          assert.match(lines[4]!, /allowLifetimeInversion/);
          return true;
        },
      );
    });
  });

  /**
   * The four shapes a consumer → group → member edge can take, and what each one used to do.
   *
   * A LOCAL group was ranked per member. The three composed shapes were not: a group key the app
   * does not declare locally died at the externals gate before the group branch was reached; a
   * locally-empty root whose members all arrive by composition produced zero candidates and was
   * read as "skip"; and a mixed root ranked its local members while dropping its composed ones with
   * no trace. All three are the same bug seen from three angles — composed supply was loaded and
   * never handed to this check — and strict mode cannot backstop any of them, because a group
   * member slot resolves lazily and never appears on Awilix's resolution stack.
   */
  describe("When a singleton consumer depends on a composed group", () => {
    it("should rank every member of a group key the app does not declare locally", () => {
      assert.throws(
        () =>
          validateLifetimeInversionsAtCodegen(
            [authServiceFactory(["writeServices"])],
            [authServicePlan],
            undefined,
            // The composed group root is external by classification — that is what used to end the
            // check here, one branch before the group hop.
            mkDemandSupply({ externalKeys: ["writeServices"] }),
            undefined,
            mkComposedSupply(WRITE_SERVICE_UNITS, [writeServicesRoot]),
          ),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /^\[ioc\] 3 lifetime inversions\./);
          for (const property of [
            "activatePendingUserWriteService",
            "archiveUserWriteService",
            "suspendUserWriteService",
          ]) {
            assert.match(
              err.message,
              new RegExp(`via group 'writeServices' member '${property}'`),
            );
          }
          // Named by the property a reader writes, not by the registration key behind it.
          assert.doesNotMatch(err.message, /member 'legacyArchiveWriter'/);
          // And attributed: the lifetime being complained about is declared in another package.
          assert.match(
            err.message,
            /'archiveUserWriteService' \(scoped, composed package "@test\/lib-media"\)/,
          );
          return true;
        },
      );
    });

    it("should rank composed members of a locally-empty group root", () => {
      // App mode allows a locally-empty root when a composed package contributes the same key;
      // `collectGroupMemberLeaves` returned nothing for it, which read as "nothing to rank".
      const groups: IocGroupsManifest = {
        writeServices: {
          kind: "object",
          baseType: "WriteService",
          baseTypeId: "write-services-id",
          members: {},
        },
      };

      assert.throws(
        () =>
          validateLifetimeInversionsAtCodegen(
            [authServiceFactory(["writeServices"])],
            [authServicePlan],
            groups,
            mkDemandSupply(),
            undefined,
            mkComposedSupply(WRITE_SERVICE_UNITS, [writeServicesRoot]),
          ),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /^\[ioc\] 3 lifetime inversions\./);
          assert.match(
            err.message,
            /via group 'writeServices' member 'suspendUserWriteService'/,
          );
          return true;
        },
      );
    });

    it("should rank local and composed members together for a mixed group", () => {
      const groups: IocGroupsManifest = {
        writeServices: {
          kind: "object",
          baseType: "WriteService",
          baseTypeId: "write-services-id",
          members: {
            localWriteService: {
              contractName: "LocalWriteService",
              registrationKey: "localWriteService",
            },
          },
        },
      };

      const plans = [
        authServicePlan,
        mkPlan({
          contractName: "LocalWriteService",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "localWriteService",
          defaultImplementationName: "localWriteService",
          implementations: [
            {
              implementationName: "localWriteService",
              exportName: "buildLocalWriteService",
              modulePath: "fixtures/localWrite.ts",
              relImport: "../fixtures/localWrite.js",
              registrationKey: "localWriteService",
              lifetime: "scoped",
            },
          ],
        }),
      ];

      assert.throws(
        () =>
          validateLifetimeInversionsAtCodegen(
            [authServiceFactory(["writeServices"])],
            plans,
            groups,
            mkDemandSupply(),
            undefined,
            mkComposedSupply(WRITE_SERVICE_UNITS, [writeServicesRoot]),
          ),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          // One local member plus three composed ones — the composed three used to be dropped
          // silently while the local one was reported, so the run looked complete and was not.
          assert.match(err.message, /^\[ioc\] 4 lifetime inversions\./);
          // The local member keeps its unannotated phrasing; only composed ones are attributed.
          assert.match(
            err.message,
            /via group 'writeServices' member 'localWriteService'/,
          );
          assert.match(err.message, /'localWriteService' \(scoped\)/);
          assert.match(
            err.message,
            /'activatePendingUserWriteService' \(scoped, composed package "@test\/lib-media"\)/,
          );
          return true;
        },
      );
    });

    it("should disclose a member whose lifetime it cannot read rather than drop it", () => {
      // The composed root names a member no manifest this run read registers — a stale or partial
      // composed manifest. Unrankable is not the same as clean, and the old `continue` said clean.
      const partialRoot: ComposedGroupRoot = {
        ...writeServicesRoot,
        members: [
          {
            contractName: "SuspendUserWriteService",
            registrationKey: "suspendUserWriteService",
            memberProperty: "suspendUserWriteService",
          },
        ],
      };

      const warnings = captureWarnings(() => {
        validateLifetimeInversionsAtCodegen(
          [authServiceFactory(["writeServices"])],
          [authServicePlan],
          undefined,
          mkDemandSupply({ externalKeys: ["writeServices"] }),
          undefined,
          mkComposedSupply([], [partialRoot]),
        );
      });

      assert.strictEqual(warnings.length, 1);
      assert.match(
        warnings[0]!,
        /group 'writeServices' member 'suspendUserWriteService'/,
      );
      assert.match(warnings[0]!, /UNRANKED, not cleared/);
      assert.match(
        warnings[0]!,
        /a composed group root names it, but no manifest this run read registers it/,
      );
    });

    it("should honour allowLifetimeInversion on the group key", () => {
      const config: IocConfig = {
        registrations: {
          AuthService: {
            authService: { allowLifetimeInversion: ["writeServices"] },
          },
        },
      };

      const warnings = captureWarnings(() => {
        validateLifetimeInversionsAtCodegen(
          [authServiceFactory(["writeServices"])],
          [authServicePlan],
          undefined,
          mkDemandSupply({ externalKeys: ["writeServices"] }),
          config,
          mkComposedSupply(WRITE_SERVICE_UNITS, [writeServicesRoot]),
        );
      });

      assert.deepStrictEqual(warnings, []);
    });
  });

  describe("When a singleton consumer depends directly on a composed registration", () => {
    it("should rank the composed lifetime and name the package", () => {
      assert.throws(
        () =>
          validateLifetimeInversionsAtCodegen(
            [authServiceFactory(["legacyArchiveWriter"])],
            [authServicePlan],
            undefined,
            mkDemandSupply({ externalKeys: ["legacyArchiveWriter"] }),
            undefined,
            mkComposedSupply(WRITE_SERVICE_UNITS),
          ),
        /'legacyArchiveWriter' \(scoped, composed package "@test\/lib-media"\)/,
      );
    });

    it("should rank a composed contract default slot through its alias", () => {
      assert.throws(
        () =>
          validateLifetimeInversionsAtCodegen(
            [authServiceFactory(["archiveUserWriteService"])],
            [authServicePlan],
            undefined,
            mkDemandSupply({ externalKeys: ["archiveUserWriteService"] }),
            undefined,
            mkComposedSupply(
              WRITE_SERVICE_UNITS,
              [],
              [["archiveUserWriteService", "legacyArchiveWriter"]],
            ),
          ),
        /'archiveUserWriteService' \(scoped, composed package "@test\/lib-media"\)/,
      );
    });
  });

  describe("When a key is genuinely supplied by the composing app", () => {
    it("should skip an external key no manifest registers", () => {
      const warnings = captureWarnings(() => {
        validateLifetimeInversionsAtCodegen(
          [authServiceFactory(["database", "logger"])],
          [authServicePlan],
          undefined,
          mkDemandSupply({ externalKeys: ["database", "logger"] }),
          undefined,
          mkComposedSupply(WRITE_SERVICE_UNITS, [writeServicesRoot]),
        );
      });

      assert.deepStrictEqual(warnings, []);
    });

    it("should still treat a scope-provided key as scoped even when a composed unit shares its name", () => {
      // Scope-provided wins: the app registers it per request on the scope, which overrides
      // whatever any manifest registered under that name at the root.
      assert.throws(
        () =>
          validateLifetimeInversionsAtCodegen(
            [authServiceFactory(["viewerId"])],
            [authServicePlan],
            undefined,
            mkDemandSupply({ scopeProvidedKeys: ["viewerId"] }),
            undefined,
            mkComposedSupply([
              mkComposedUnit("ViewerId", "viewerId", "singleton"),
            ]),
          ),
        /'viewerId' \(scope-provided, per-request\)/,
      );
    });
  });
});
