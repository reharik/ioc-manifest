import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { IocGroupsManifest } from "../core/manifest.js";
import type { DemandSupplyAnalysisResult } from "./analyzeDemandSupply/index.js";
import type { DiscoveredFactory } from "./types.js";
import type { ResolvedContractRegistration } from "./resolveRegistrationPlan.js";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";
import {
  buildManifestArtifactSources,
  importResolvesToRegistryFile,
  writeManifest,
} from "./writeManifest.js";

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

  describe("When a unit demands cradle keys", () => {
    it("should write the keys into the manifest and declare the feature", async () => {
      // What a COMPOSING app reads to walk edges into this package: `dependencyContractNames`
      // names contract types and is silent about a plain-typed dependency like `viewerId: string`,
      // so the keys are written alongside it.
      const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "ioc-write-manifest-"),
      );
      const generatedDir = path.join(tempRoot, "src", "generated");
      await fs.mkdir(generatedDir, { recursive: true });
      const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");

      const acceptedFactories: DiscoveredFactory[] = [
        mkFactory({
          contractName: "Reader",
          implementationName: "reader",
          exportName: "buildReader",
          registrationKey: "reader",
          dependencyKeys: ["clock", "viewerId"],
        }),
      ];
      const plans: ResolvedContractRegistration[] = [
        mkPlan({
          contractName: "Reader",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "reader",
          defaultImplementationName: "reader",
          implementations: [
            {
              implementationName: "reader",
              exportName: "buildReader",
              modulePath: "fixtures/impl.ts",
              relImport: "../fixtures/impl.js",
              registrationKey: "reader",
              lifetime: "scoped",
              dependencyKeys: ["clock", "viewerId"],
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

      assert.match(
        manifestSource,
        /dependencyKeys: \["clock","viewerId"\],/,
      );
      // The sibling export, not a property of `iocManifest`: every unrecognized top-level property
      // of the manifest object is read back as a GROUP ROOT, by this runtime and by older ones.
      assert.match(
        manifestSource,
        /export const IOC_MANIFEST_FEATURES = \["dependencyKeys", "lifetimeSource"\] as const;/,
      );
      assert.ok(
        !/^\s*IOC_MANIFEST_FEATURES:/m.test(manifestSource),
        "the feature list must never become a manifest property",
      );
    });

    it("should write the lifetime's provenance beside the lifetime it explains", async () => {
      // The stated blind spot of `ioc explain` since it shipped: a manifest recorded WHAT the
      // lifetime resolved to and nothing about what decided it, so a composing app could say
      // nothing at all about a composed unit's lifetime — the one unit whose sources the reader
      // cannot go and open.
      const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "ioc-write-manifest-"),
      );
      const generatedDir = path.join(tempRoot, "src", "generated");
      await fs.mkdir(generatedDir, { recursive: true });
      const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");

      const acceptedFactories: DiscoveredFactory[] = [
        mkFactory({
          contractName: "Reader",
          implementationName: "reader",
          exportName: "buildReader",
          registrationKey: "reader",
        }),
      ];
      const plans: ResolvedContractRegistration[] = [
        mkPlan({
          contractName: "Reader",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "reader",
          defaultImplementationName: "reader",
          implementations: [
            {
              implementationName: "reader",
              exportName: "buildReader",
              modulePath: "fixtures/impl.ts",
              relImport: "../fixtures/impl.js",
              registrationKey: "reader",
              lifetime: "scoped",
              lifetimeSource: "lifetime-marker",
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

      assert.match(manifestSource, /lifetimeSource: "lifetime-marker",/);
      assert.match(
        manifestSource,
        /export const IOC_MANIFEST_FEATURES = \["dependencyKeys", "lifetimeSource"\] as const;/,
      );
    });

    it("should omit the field entirely for a unit that demands nothing", async () => {
      const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "ioc-write-manifest-"),
      );
      const generatedDir = path.join(tempRoot, "src", "generated");
      await fs.mkdir(generatedDir, { recursive: true });
      const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");

      const acceptedFactories: DiscoveredFactory[] = [
        mkFactory({ contractName: "Svc", implementationName: "svc" }),
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
              exportName: "buildX",
              modulePath: "fixtures/impl.ts",
              relImport: "../fixtures/impl.js",
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

      // Same omit-when-empty discipline every other optional field follows. The feature export is
      // what makes the absence readable — without it, "no keys" and "old manifest" look alike.
      assert.ok(!/^\s*dependencyKeys:/m.test(manifestSource));
      // Provenance follows the same rule: a plan built without a lifetime context carries none, so
      // none is written, and the feature export is what tells the two absences apart.
      assert.ok(!/^\s*lifetimeSource:/m.test(manifestSource));
      assert.match(
        manifestSource,
        /export const IOC_MANIFEST_FEATURES = \["dependencyKeys", "lifetimeSource"\] as const;/,
      );
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

      // Each group root also gets an exported PascalCase type alias.
      assert.match(
        typesSource,
        /export type WidgetGroup = ReadonlyArray<Widget>;/,
      );
      assert.match(
        typesSource,
        /export type WidgetObjectGroup = \{[\s\S]*?widget:\s*Widget;[\s\S]*?\};/,
      );

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
      assert.match(
        mainSource,
        new RegExp(`\\bmanifestSchemaVersion:\\s*${MANIFEST_SCHEMA_VERSION}\\b`),
      );
    });

    it("should skip a group type alias that would collide with an imported contract type and warn", async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ioc-write-manifest-"));
      const generatedDir = path.join(tempRoot, "src", "generated");
      await fs.mkdir(generatedDir, { recursive: true });
      const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");

      const acceptedFactories: DiscoveredFactory[] = [
        mkFactory({
          contractName: "Channel",
          implementationName: "emailChannel",
          registrationKey: "emailChannel",
          modulePath: "fixtures/e.ts",
          relImport: "../fixtures/e.js",
        }),
      ];
      const plans: ResolvedContractRegistration[] = [
        mkPlan({
          contractName: "Channel",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "channel",
          accessKey: "emailChannel",
          defaultImplementationName: "emailChannel",
          implementations: [
            {
              implementationName: "emailChannel",
              exportName: "buildEmailChannel",
              modulePath: "fixtures/e.ts",
              relImport: "../fixtures/e.js",
              registrationKey: "emailChannel",
              lifetime: "singleton",
            },
          ],
        }),
      ];

      // Group key PascalCases to "Channel", colliding with the imported contract type.
      const groups: IocGroupsManifest = {
        channel: {
          kind: "collection",
          baseType: "Channel",
          baseTypeId: "/fake/Channel.ts:Channel",
          members: [{ contractName: "Channel", registrationKey: "emailChannel" }],
        },
      };

      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map((a) => String(a)).join(" "));
      };
      try {
        await writeWithDemandSupply(
          acceptedFactories,
          plans,
          groups,
          manifestOutPath,
        );
      } finally {
        console.warn = originalWarn;
      }

      const typesSource = await fs.readFile(
        path.join(generatedDir, "ioc-registry.types.ts"),
        "utf8",
      );
      assert.ok(
        !/export type Channel\b/.test(typesSource),
        "colliding alias must not be emitted",
      );
      assert.match(typesSource, /\bchannel:\s*ReadonlyArray<Channel>;/);
      assert.ok(
        warnings.some(
          (w) => w.includes("[ioc-warn]") && w.includes('group "channel"'),
        ),
        "a collision warning should be emitted",
      );
    });
  });

  describe("When a resolved type pulls in another package's IocGeneratedCradle", () => {
    const mkEntry = (
      key: string,
      typeName: string,
      imports: DemandSupplyAnalysisResult["entries"][number]["typeRef"]["imports"],
    ): DemandSupplyAnalysisResult["entries"][number] => ({
      key,
      typeRef: { typeName, imports },
      classification: "local",
    });

    const buildTypes = (
      demandSupply: DemandSupplyAnalysisResult,
    ): string =>
      buildManifestArtifactSources(
        [],
        [],
        undefined,
        path.join(os.tmpdir(), "ioc-self-import", "ioc-manifest.ts"),
        "ioc-manifest",
        { demandSupply },
      ).typesSource;

    it("should never import a name this file also declares (no TS2440 self-import)", () => {
      const typesSource = buildTypes({
        entries: [
          mkEntry("container", "IocGeneratedCradle", [
            {
              typeName: "IocGeneratedCradle",
              relImport: "../../lib-foo/src/generated/ioc-registry.types.js",
              useDefaultImport: false,
            },
          ]),
          mkEntry("database", "Database", [
            {
              typeName: "Database",
              relImport: "../fixtures/contracts.js",
              useDefaultImport: false,
            },
          ]),
        ],
        externalKeys: [],
        scopeProvidedKeys: [],
      });

      // The file declares its own cradle interface and must not also import that name.
      assert.match(typesSource, /export interface IocGeneratedCradle \{/);
      assert.doesNotMatch(typesSource, /import[^\n]*IocGeneratedCradle/);
      // The self-import bucket held only that name, so the whole import line is dropped.
      assert.doesNotMatch(typesSource, /ioc-registry\.types\.js/);
      // Legitimate imports from other specifiers are untouched.
      assert.match(
        typesSource,
        /import type \{ Database \} from "\.\.\/fixtures\/contracts\.js";/,
      );
      // A stripped bucket must never leave behind an empty import.
      assert.doesNotMatch(typesSource, /import type \{\s*\} from/);
    });

    it("should strip only the declared name from a shared bucket, keeping co-located imports", () => {
      const shared = "../../lib-foo/src/generated/ioc-registry.types.js";
      const typesSource = buildTypes({
        entries: [
          mkEntry("container", "IocGeneratedCradle", [
            {
              typeName: "IocGeneratedCradle",
              relImport: shared,
              useDefaultImport: false,
            },
            { typeName: "PublicThing", relImport: shared, useDefaultImport: false },
          ]),
        ],
        externalKeys: [],
        scopeProvidedKeys: [],
      });

      // The co-located public type still imports; the declared name is gone from the import.
      assert.match(
        typesSource,
        /import type \{ PublicThing \} from "\.\.\/\.\.\/lib-foo\/src\/generated\/ioc-registry\.types\.js";/,
      );
      assert.doesNotMatch(typesSource, /import[^\n]*IocGeneratedCradle/);
      assert.doesNotMatch(typesSource, /import type \{\s*\} from/);
    });
  });

  describe("When an implementation is a class registration unit", () => {
    it("should emit kind: \"class\" for it and omit kind for factories", () => {
      const plans = [
        mkPlan({
          contractName: "Svc",
          contractTypeRelImport: "../fixtures/contracts.js",
          contractKey: "svc",
          defaultImplementationName: "classSvc",
          implementations: [
            {
              unitKind: "class",
              implementationName: "classSvc",
              exportName: "ClassSvc",
              registrationKey: "classSvc",
              modulePath: "fixtures/ClassSvc.ts",
              relImport: "../fixtures/ClassSvc.js",
              lifetime: "singleton",
              discoveredBy: "implements",
            },
            {
              implementationName: "factorySvc",
              exportName: "buildFactorySvc",
              registrationKey: "factorySvc",
              modulePath: "fixtures/impl.ts",
              relImport: "../fixtures/impl.js",
              lifetime: "singleton",
              discoveredBy: "naming",
            },
          ],
        }),
      ];

      const { mainSource } = buildManifestArtifactSources(
        [
          mkFactory({
            contractName: "Svc",
            implementationName: "classSvc",
            unitKind: "class",
            exportName: "ClassSvc",
            modulePath: "fixtures/ClassSvc.ts",
            relImport: "../fixtures/ClassSvc.js",
          }),
          mkFactory({
            contractName: "Svc",
            implementationName: "factorySvc",
            exportName: "buildFactorySvc",
          }),
        ],
        plans,
        undefined,
        "/tmp/ioc-manifest.ts",
        "ioc-manifest",
        { demandSupply: mkDemandSupplyFromPlans(plans) },
      );

      assert.match(mainSource, /"classSvc": \{\s*\n\s*kind: "class",/);
      const factoryBlock = mainSource.slice(mainSource.indexOf("factorySvc: {"));
      assert.ok(
        !factoryBlock.slice(0, factoryBlock.indexOf("},")).includes("kind:"),
        "factory units must not restate the default kind",
      );
    });
  });

});

describe("importResolvesToRegistryFile", () => {
  describe("When the specifier points at the generated registry file", () => {
    it("matches the emitted .js specifier against the .ts file (absolute generatedDir)", () => {
      const generatedDir = path.join(os.tmpdir(), "ioc-gen");
      assert.strictEqual(
        importResolvesToRegistryFile("./ioc-registry.types.js", generatedDir),
        true,
      );
    });

    it("matches the extensionless specifier", () => {
      const generatedDir = path.join(os.tmpdir(), "ioc-gen");
      assert.strictEqual(
        importResolvesToRegistryFile("./ioc-registry.types", generatedDir),
        true,
      );
    });

    it("matches when generatedDir is project-relative", () => {
      // The bug's failure shape: a relative generatedDir. path.resolve reconciles it against cwd,
      // so a self-import specifier still resolves to the registry file.
      assert.strictEqual(
        importResolvesToRegistryFile(
          "./ioc-registry.types.js",
          "src/generated",
        ),
        true,
      );
    });

    it("matches a specifier that climbs back to the generated dir's own file", () => {
      // generatedDir is `.../ioc-gen`; a specifier that climbs out and back resolves to the same
      // registry file, so it is still a self-import.
      const generatedDir = path.join(os.tmpdir(), "ioc-gen");
      assert.strictEqual(
        importResolvesToRegistryFile(
          "../ioc-gen/ioc-registry.types.js",
          generatedDir,
        ),
        true,
      );
    });
  });

  describe("When the specifier is not the registry file", () => {
    it("rejects a bare package specifier", () => {
      assert.strictEqual(
        importResolvesToRegistryFile("knex", path.join(os.tmpdir(), "ioc-gen")),
        false,
      );
    });

    it("rejects a sibling contract module", () => {
      assert.strictEqual(
        importResolvesToRegistryFile(
          "../contracts.js",
          path.join(os.tmpdir(), "ioc-gen"),
        ),
        false,
      );
    });

    it("rejects a same-named file in a different directory", () => {
      assert.strictEqual(
        importResolvesToRegistryFile(
          "../other/ioc-registry.types.js",
          path.join(os.tmpdir(), "ioc-gen"),
        ),
        false,
      );
    });
  });
});
