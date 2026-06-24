import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IocConfig } from "../config/iocConfig.js";
import type { IocGroupsManifest } from "../core/manifest.js";
import type { DemandSupplyAnalysisResult } from "./analyzeDemandSupply/index.js";
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
    "contractName" | "contractTypeRelImport" | "defaultImplementationName" | "implementations"
  > &
    Partial<ResolvedContractRegistration>,
): ResolvedContractRegistration => {
  const contractKey = partial.contractKey ?? partial.contractName[0]!.toLowerCase() + partial.contractName.slice(1);
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
      assert.match(warnings[0]!, /\[ioc\] Lifetime inversion: 'grantSync' \(singleton\)/);
      assert.match(warnings[0]!, /'token' \(transient\)/);
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
          assert.match(err.message, /via group 'channels' member 'grantRepository'/);
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
          assert.strictEqual(lines.length, 3);
          assert.match(lines[0]!, /'grantSync' \(singleton\).*'grantRepository' \(scoped\)/);
          assert.match(lines[1]!, /'reportSync' \(singleton\).*'auditLog' \(scoped\)/);
          assert.match(lines[2]!, /allowLifetimeInversion/);
          return true;
        },
      );
    });
  });
});
