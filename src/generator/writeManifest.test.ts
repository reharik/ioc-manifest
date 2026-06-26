import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { IocGroupsManifest } from "../core/manifest.js";
import type { DemandSupplyAnalysisResult } from "./analyzeDemandSupply/index.js";
import type { DiscoveredFactory } from "./types.js";
import type { ResolvedContractRegistration } from "./resolveRegistrationPlan.js";
import { writeManifest } from "./writeManifest.js";

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
  const contractKey = partial.contractKey ?? "svc";
  return {
    ...partial,
    contractKey,
    accessKey: partial.accessKey ?? contractKey,
  };
};

const mkDemandSupplyFromPlans = (
  plans: readonly ResolvedContractRegistration[],
): DemandSupplyAnalysisResult => {
  const byKey = new Map<
    string,
    DemandSupplyAnalysisResult["entries"][number]
  >();

  for (const plan of plans) {
    for (const impl of plan.implementations) {
      byKey.set(impl.registrationKey, {
        key: impl.registrationKey,
        typeRef: {
          typeName: plan.contractName,
          imports: [
            {
              typeName: plan.contractName,
              relImport: plan.contractTypeRelImport,
              useDefaultImport: false,
            },
          ],
        },
        classification: "local",
      });
    }
  }

  const entries = Array.from(byKey.values()).sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  return { entries, externalKeys: [], scopeProvidedKeys: [] };
};

const writeWithDemandSupply = async (
  acceptedFactories: DiscoveredFactory[],
  plans: ResolvedContractRegistration[],
  groups: IocGroupsManifest | undefined,
  manifestOutPath: string,
): Promise<void> =>
  writeManifest(
    acceptedFactories,
    plans,
    groups,
    manifestOutPath,
    "ioc-manifest",
    { demandSupply: mkDemandSupplyFromPlans(plans) },
  );

describe("writeManifest", () => {
  describe("When writing generated outputs repeatedly", () => {
    it("should remain deterministic and idempotent for the same inputs", async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ioc-write-manifest-"));
      const generatedDir = path.join(tempRoot, "src", "generated");
      await fs.mkdir(generatedDir, { recursive: true });
      const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");

      const acceptedFactories: DiscoveredFactory[] = [
        mkFactory({
          contractName: "Svc",
          implementationName: "svc",
          exportName: "buildSvc",
          registrationKey: "svc",
          modulePath: "fixtures/svc.ts",
          relImport: "../fixtures/svc.js",
        }),
      ];
      const plans: ResolvedContractRegistration[] = [
        mkPlan({
          contractName: "Svc",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "svc",
          defaultImplementationName: "svc",
          implementations: [
            {
              implementationName: "svc",
              exportName: "buildSvc",
              modulePath: "fixtures/svc.ts",
              relImport: "../fixtures/svc.js",
              registrationKey: "svc",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      await writeWithDemandSupply(
        acceptedFactories,
        plans,
        undefined,
        manifestOutPath,
      );
      const manifestFirst = await fs.readFile(manifestOutPath, "utf8");
      const typesPath = path.join(generatedDir, "ioc-registry.types.ts");
      const typesFirst = await fs.readFile(typesPath, "utf8");

      await writeWithDemandSupply(
        acceptedFactories,
        plans,
        undefined,
        manifestOutPath,
      );
      const manifestSecond = await fs.readFile(manifestOutPath, "utf8");
      const typesSecond = await fs.readFile(typesPath, "utf8");

      assert.strictEqual(manifestSecond, manifestFirst);
      assert.strictEqual(typesSecond, typesFirst);
    });
  });

  describe("When replacing existing generated files", () => {
    it("should fully replace old content and avoid stale tmp files on success", async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ioc-write-manifest-"));
      const generatedDir = path.join(tempRoot, "src", "generated");
      await fs.mkdir(generatedDir, { recursive: true });
      const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");
      const typesPath = path.join(generatedDir, "ioc-registry.types.ts");

      await fs.writeFile(manifestOutPath, "OLD_CONTENT_SHOULD_BE_REPLACED", "utf8");
      await fs.writeFile(typesPath, "OLD_TYPES_SHOULD_BE_REPLACED", "utf8");

      const acceptedFactories: DiscoveredFactory[] = [
        mkFactory({
          contractName: "Svc",
          implementationName: "svc",
          exportName: "buildSvc",
          registrationKey: "svc",
          modulePath: "fixtures/svc.ts",
          relImport: "../fixtures/svc.js",
        }),
      ];
      const plans: ResolvedContractRegistration[] = [
        mkPlan({
          contractName: "Svc",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "svc",
          defaultImplementationName: "svc",
          implementations: [
            {
              implementationName: "svc",
              exportName: "buildSvc",
              modulePath: "fixtures/svc.ts",
              relImport: "../fixtures/svc.js",
              registrationKey: "svc",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      await writeWithDemandSupply(
        acceptedFactories,
        plans,
        undefined,
        manifestOutPath,
      );

      const manifestSource = await fs.readFile(manifestOutPath, "utf8");
      const typesSource = await fs.readFile(typesPath, "utf8");
      assert.ok(!manifestSource.includes("OLD_CONTENT_SHOULD_BE_REPLACED"));
      assert.ok(!typesSource.includes("OLD_TYPES_SHOULD_BE_REPLACED"));
      assert.ok(manifestSource.includes("export const iocManifest"));
      assert.ok(typesSource.includes("export interface IocGeneratedCradle"));
      assert.ok(typesSource.includes("export interface IocExternals"));
      assert.ok(typesSource.includes("export interface IocScopeProvided {}"));
      assert.ok(!typesSource.includes("registering onto a request child scope"));
      assert.match(
        manifestSource,
        /export const IOC_SCOPE_PROVIDED_KEYS = \[\] as const;/,
      );

      const files = await fs.readdir(generatedDir);
      assert.ok(
        files.every((name) => !name.includes(".tmp-")),
        "temporary files should not remain after successful replacement",
      );
    });
  });

  describe("When demand supply includes external keys", () => {
    it("should emit IocExternals with only external demanded keys", async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ioc-write-manifest-"));
      const generatedDir = path.join(tempRoot, "src", "generated");
      await fs.mkdir(generatedDir, { recursive: true });
      const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");

      const acceptedFactories: DiscoveredFactory[] = [
        mkFactory({
          contractName: "UserService",
          implementationName: "userService",
          registrationKey: "userService",
          modulePath: "fixtures/u.ts",
          relImport: "../fixtures/u.js",
        }),
      ];
      const plans: ResolvedContractRegistration[] = [
        mkPlan({
          contractName: "UserService",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "userService",
          defaultImplementationName: "userService",
          implementations: [
            {
              implementationName: "userService",
              exportName: "buildUserService",
              modulePath: "fixtures/u.ts",
              relImport: "../fixtures/u.js",
              registrationKey: "userService",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      const demandSupply: DemandSupplyAnalysisResult = {
        entries: [
          {
            key: "database",
            typeRef: {
              typeName: "Database",
              imports: [
                {
                  typeName: "Database",
                  relImport: "../fixtures/contracts.js",
                  useDefaultImport: false,
                },
              ],
            },
            classification: "external",
          },
          {
            key: "logger",
            typeRef: {
              typeName: "Logger",
              imports: [
                {
                  typeName: "Logger",
                  relImport: "../fixtures/contracts.js",
                  useDefaultImport: false,
                },
              ],
            },
            classification: "external",
          },
          {
            key: "userService",
            typeRef: {
              typeName: "UserService",
              imports: [
                {
                  typeName: "UserService",
                  relImport: "../fixtures/contracts.js",
                  useDefaultImport: false,
                },
              ],
            },
            classification: "local",
          },
        ],
        externalKeys: ["database", "logger"],
        scopeProvidedKeys: [],
      };

      await writeManifest(
        acceptedFactories,
        plans,
        undefined,
        manifestOutPath,
        "ioc-manifest",
        { demandSupply },
      );

      const typesSource = await fs.readFile(
        path.join(generatedDir, "ioc-registry.types.ts"),
        "utf8",
      );
      const cradleBody = typesSource.match(
        /export interface IocGeneratedCradle \{([\s\S]*?)\}\n\nexport interface IocExternals/,
      )?.[1];
      assert.ok(cradleBody !== undefined);
      assert.ok(!/\bdatabase:/.test(cradleBody));
      assert.ok(!/\blogger:/.test(cradleBody));
      assert.match(cradleBody, /\buserService:\s*UserService;/);
      assert.match(
        typesSource,
        /export interface IocExternals \{\n  database: Database;\n  logger: Logger;\n\}/,
      );
      assert.ok(typesSource.includes("export interface IocScopeProvided {}"));
      assert.ok(!typesSource.includes("registering onto a request child scope"));

      const manifestSource = await fs.readFile(manifestOutPath, "utf8");
      assert.match(
        manifestSource,
        /export const IOC_SCOPE_PROVIDED_KEYS = \[\] as const;/,
      );
    });
  });

  describe("When demand supply includes scope-provided keys", () => {
    it("should emit IocScopeProvided and omit those keys from IocExternals", async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ioc-write-manifest-"));
      const generatedDir = path.join(tempRoot, "src", "generated");
      await fs.mkdir(generatedDir, { recursive: true });
      const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");

      const acceptedFactories: DiscoveredFactory[] = [
        mkFactory({
          contractName: "UserService",
          implementationName: "userService",
          registrationKey: "userService",
          modulePath: "fixtures/u.ts",
          relImport: "../fixtures/u.js",
        }),
      ];
      const plans: ResolvedContractRegistration[] = [
        mkPlan({
          contractName: "UserService",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "userService",
          defaultImplementationName: "userService",
          implementations: [
            {
              implementationName: "userService",
              exportName: "buildUserService",
              modulePath: "fixtures/u.ts",
              relImport: "../fixtures/u.js",
              registrationKey: "userService",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      const demandSupply: DemandSupplyAnalysisResult = {
        entries: [
          {
            key: "viewerId",
            typeRef: {
              typeName: "string",
              imports: [],
            },
            classification: "scope-provided",
          },
          {
            key: "logger",
            typeRef: {
              typeName: "Logger",
              imports: [
                {
                  typeName: "Logger",
                  relImport: "../fixtures/contracts.js",
                  useDefaultImport: false,
                },
              ],
            },
            classification: "external",
          },
          {
            key: "userService",
            typeRef: {
              typeName: "UserService",
              imports: [
                {
                  typeName: "UserService",
                  relImport: "../fixtures/contracts.js",
                  useDefaultImport: false,
                },
              ],
            },
            classification: "local",
          },
        ],
        externalKeys: ["logger"],
        scopeProvidedKeys: ["viewerId"],
      };

      await writeManifest(
        acceptedFactories,
        plans,
        undefined,
        manifestOutPath,
        "ioc-manifest",
        { demandSupply },
      );

      const typesSource = await fs.readFile(
        path.join(generatedDir, "ioc-registry.types.ts"),
        "utf8",
      );
      const manifestSource = await fs.readFile(manifestOutPath, "utf8");

      assert.match(typesSource, /registering onto a request child scope/);
      assert.match(
        typesSource,
        /registering onto a request child scope[\s\S]*export interface IocScopeProvided \{\n  viewerId: string;\n\}/,
      );
      assert.match(
        typesSource,
        /export interface IocExternals \{\n  logger: Logger;\n\}/,
      );
      assert.match(
        manifestSource,
        /export const IOC_SCOPE_PROVIDED_KEYS = \["viewerId"\] as const;/,
      );
      const externalsBlock = typesSource.match(
        /export interface IocExternals \{([\s\S]*?)\}/,
      )?.[1];
      assert.ok(externalsBlock !== undefined);
      assert.ok(!/\bviewerId:/.test(externalsBlock));
    });
  });

  describe("When a contract has only one implementation", () => {
    it("should emit the default contract key but no plural collection property", async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ioc-write-manifest-"));
      const generatedDir = path.join(tempRoot, "src", "generated");
      await fs.mkdir(generatedDir, { recursive: true });
      const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");

      const acceptedFactories: DiscoveredFactory[] = [
        mkFactory({
          contractName: "OnlyOne",
          implementationName: "only",
          registrationKey: "onlyOne",
          modulePath: "fixtures/o.ts",
          relImport: "../fixtures/o.js",
        }),
      ];
      const plans: ResolvedContractRegistration[] = [
        mkPlan({
          contractName: "OnlyOne",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "onlyOne",
          defaultImplementationName: "only",
          implementations: [
            {
              implementationName: "only",
              exportName: "buildOnly",
              modulePath: "fixtures/o.ts",
              relImport: "../fixtures/o.js",
              registrationKey: "onlyOne",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      await writeWithDemandSupply(
        acceptedFactories,
        plans,
        undefined,
        manifestOutPath,
      );

      const typesSource = await fs.readFile(
        path.join(generatedDir, "ioc-registry.types.ts"),
        "utf8",
      );
      assert.match(typesSource, /\bonlyOne:\s*OnlyOne;/);
      assert.ok(!typesSource.includes("onlyOnes:"));
    });
  });

  describe("When a contract has multiple implementations", () => {
    it("should emit factory supply keys plus the contract default on IocGeneratedCradle", async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ioc-write-manifest-"));
      const generatedDir = path.join(tempRoot, "src", "generated");
      await fs.mkdir(generatedDir, { recursive: true });
      const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");

      const acceptedFactories: DiscoveredFactory[] = [
        mkFactory({
          contractName: "Widget",
          implementationName: "primaryWidget",
          registrationKey: "primaryWidget",
          modulePath: "fixtures/p.ts",
          relImport: "../fixtures/p.js",
        }),
        mkFactory({
          contractName: "Widget",
          implementationName: "widget",
          registrationKey: "widget",
          modulePath: "fixtures/w.ts",
          relImport: "../fixtures/w.js",
        }),
      ];
      const plans: ResolvedContractRegistration[] = [
        mkPlan({
          contractName: "Widget",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "widget",
          defaultImplementationName: "widget",
          implementations: [
            {
              implementationName: "primaryWidget",
              exportName: "buildPrimary",
              modulePath: "fixtures/p.ts",
              relImport: "../fixtures/p.js",
              registrationKey: "primaryWidget",
              lifetime: "singleton",
            },
            {
              implementationName: "widget",
              exportName: "buildWidget",
              modulePath: "fixtures/w.ts",
              relImport: "../fixtures/w.js",
              registrationKey: "widget",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      await writeWithDemandSupply(
        acceptedFactories,
        plans,
        undefined,
        manifestOutPath,
      );

      const typesSource = await fs.readFile(
        path.join(generatedDir, "ioc-registry.types.ts"),
        "utf8",
      );
      assert.match(typesSource, /\bwidget:\s*Widget;/);
      assert.ok(!typesSource.includes("widgets:"));
      assert.match(typesSource, /\bprimaryWidget:\s*Widget;/);
      assert.ok(!typesSource.includes("Record<"));
    });

    it("should emit accessKey as the singular cradle property when it differs from the convention key", async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ioc-write-manifest-"));
      const generatedDir = path.join(tempRoot, "src", "generated");
      await fs.mkdir(generatedDir, { recursive: true });
      const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");

      const acceptedFactories: DiscoveredFactory[] = [
        mkFactory({
          contractName: "Knex",
          implementationName: "database",
          registrationKey: "database",
          modulePath: "fixtures/k.ts",
          relImport: "../fixtures/k.js",
        }),
      ];
      const plans: ResolvedContractRegistration[] = [
        mkPlan({
          contractName: "Knex",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "knex",
          accessKey: "database",
          defaultImplementationName: "database",
          implementations: [
            {
              implementationName: "database",
              exportName: "buildDatabase",
              modulePath: "fixtures/k.ts",
              relImport: "../fixtures/k.js",
              registrationKey: "database",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      await writeWithDemandSupply(
        acceptedFactories,
        plans,
        undefined,
        manifestOutPath,
      );

      const typesSource = await fs.readFile(
        path.join(generatedDir, "ioc-registry.types.ts"),
        "utf8",
      );
      assert.match(typesSource, /\bdatabase:\s*Knex;/);
      assert.ok(!/\bknex:\s*Knex\b/.test(typesSource));
    });

    it("should emit configured group roots as ReadonlyArray and object types", async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ioc-write-manifest-"));
      const generatedDir = path.join(tempRoot, "src", "generated");
      await fs.mkdir(generatedDir, { recursive: true });
      const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");

      const acceptedFactories: DiscoveredFactory[] = [
        mkFactory({
          contractName: "Widget",
          implementationName: "primaryWidget",
          registrationKey: "primaryWidget",
          modulePath: "fixtures/p.ts",
          relImport: "../fixtures/p.js",
        }),
        mkFactory({
          contractName: "Widget",
          implementationName: "widget",
          registrationKey: "widget",
          modulePath: "fixtures/w.ts",
          relImport: "../fixtures/w.js",
        }),
      ];
      const plans: ResolvedContractRegistration[] = [
        mkPlan({
          contractName: "Widget",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "widget",
          defaultImplementationName: "widget",
          implementations: [
            {
              implementationName: "primaryWidget",
              exportName: "buildPrimary",
              modulePath: "fixtures/p.ts",
              relImport: "../fixtures/p.js",
              registrationKey: "primaryWidget",
              lifetime: "singleton",
            },
            {
              implementationName: "widget",
              exportName: "buildWidget",
              modulePath: "fixtures/w.ts",
              relImport: "../fixtures/w.js",
              registrationKey: "widget",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      const groups: IocGroupsManifest = {
        widgetGroup: {
          kind: "collection",
          baseType: "Widget",
          baseTypeId: "/fake/Widget.ts:Widget",
          members: [
            { contractName: "Widget", registrationKey: "primaryWidget" },
            { contractName: "Widget", registrationKey: "widget" },
          ],
        },
        widgetObjectGroup: {
          kind: "object",
          baseType: "Widget",
          baseTypeId: "/fake/Widget.ts:Widget",
          members: {
            widget: { contractName: "Widget", registrationKey: "widget" },
          },
        },
      };

      await writeWithDemandSupply(
        acceptedFactories,
        plans,
        groups,
        manifestOutPath,
      );

      const typesSource = await fs.readFile(
        path.join(generatedDir, "ioc-registry.types.ts"),
        "utf8",
      );
      assert.match(typesSource, /\bwidgetGroup:\s*ReadonlyArray</);
      assert.match(typesSource, /\bwidgetObjectGroup:\s*\{/);
      assert.match(typesSource, /\bwidget:\s*Widget\b/);

      const mainSource = await fs.readFile(manifestOutPath, "utf8");
      assert.ok(
        !/\bgroups\s*:/.test(mainSource),
        "group roots must be top-level manifest properties, not nested under groups",
      );
      assert.match(mainSource, /\bwidgetGroup\s*:/);
      assert.match(mainSource, /\bwidgetObjectGroup\s*:/);
      assert.match(
        mainSource,
        /IocGeneratedContainerManifest<\s*IocManifestGroupRoots\s*>/,
      );
      assert.match(mainSource, /\bmanifestSchemaVersion:\s*2\b/);
    });
  });
});
