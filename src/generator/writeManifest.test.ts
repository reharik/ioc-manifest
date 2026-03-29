import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { IocGroupsManifest } from "../core/manifest.js";
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

      await writeManifest(
        acceptedFactories,
        plans,
        undefined,
        manifestOutPath,
        "ioc-manifest",
      );
      const manifestFirst = await fs.readFile(manifestOutPath, "utf8");
      const supportPath = path.join(generatedDir, "ioc-manifest.support.ts");
      const supportFirst = await fs.readFile(supportPath, "utf8");
      const typesPath = path.join(generatedDir, "ioc-registry.types.ts");
      const typesFirst = await fs.readFile(typesPath, "utf8");

      await writeManifest(
        acceptedFactories,
        plans,
        undefined,
        manifestOutPath,
        "ioc-manifest",
      );
      const manifestSecond = await fs.readFile(manifestOutPath, "utf8");
      const supportSecond = await fs.readFile(supportPath, "utf8");
      const typesSecond = await fs.readFile(typesPath, "utf8");

      assert.strictEqual(manifestSecond, manifestFirst);
      assert.strictEqual(supportSecond, supportFirst);
      assert.strictEqual(typesSecond, typesFirst);
    });
  });

  describe("When replacing existing generated files", () => {
    it("should fully replace old content and avoid stale tmp files on success", async () => {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ioc-write-manifest-"));
      const generatedDir = path.join(tempRoot, "src", "generated");
      await fs.mkdir(generatedDir, { recursive: true });
      const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");
      const supportPath = path.join(generatedDir, "ioc-manifest.support.ts");
      const typesPath = path.join(generatedDir, "ioc-registry.types.ts");

      await fs.writeFile(manifestOutPath, "OLD_CONTENT_SHOULD_BE_REPLACED", "utf8");
      await fs.writeFile(supportPath, "OLD_SUPPORT_SHOULD_BE_REPLACED", "utf8");
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

      await writeManifest(
        acceptedFactories,
        plans,
        undefined,
        manifestOutPath,
        "ioc-manifest",
      );

      const manifestSource = await fs.readFile(manifestOutPath, "utf8");
      const supportSource = await fs.readFile(supportPath, "utf8");
      const typesSource = await fs.readFile(typesPath, "utf8");
      assert.ok(!manifestSource.includes("OLD_CONTENT_SHOULD_BE_REPLACED"));
      assert.ok(!supportSource.includes("OLD_SUPPORT_SHOULD_BE_REPLACED"));
      assert.ok(!typesSource.includes("OLD_TYPES_SHOULD_BE_REPLACED"));
      assert.ok(manifestSource.includes("export const iocManifest"));
      assert.ok(supportSource.includes("iocRegistrationManifest"));
      assert.ok(typesSource.includes("export interface IocGeneratedTypes"));
      assert.ok(
        typesSource.includes("export type IocGeneratedCradle = IocGeneratedTypes"),
      );

      const files = await fs.readdir(generatedDir);
      assert.ok(
        files.every((name) => !name.includes(".tmp-")),
        "temporary files should not remain after successful replacement",
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
          collectionKey: undefined,
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

      await writeManifest(
        acceptedFactories,
        plans,
        undefined,
        manifestOutPath,
        "ioc-manifest",
      );

      const typesSource = await fs.readFile(
        path.join(generatedDir, "ioc-registry.types.ts"),
        "utf8",
      );
      assert.match(typesSource, /\bonlyOne:\s*OnlyOne\b/);
      assert.ok(!typesSource.includes("onlyOnes:"));
    });
  });

  describe("When a contract has multiple implementations", () => {
    it("should emit only the contract default and collection keys on IocGeneratedTypes, not each registration key", async () => {
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
          collectionKey: "widgets",
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

      await writeManifest(
        acceptedFactories,
        plans,
        undefined,
        manifestOutPath,
        "ioc-manifest",
      );

      const typesSource = await fs.readFile(
        path.join(generatedDir, "ioc-registry.types.ts"),
        "utf8",
      );
      assert.match(typesSource, /\bwidget:\s*Widget\b/);
      assert.match(typesSource, /\bwidgets:\s*ReadonlyArray<\s*Widget\s*>\s*;/);
      assert.ok(!typesSource.includes("Record<"));
      assert.ok(!typesSource.includes("primaryWidget: Widget"));
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
          collectionKey: undefined,
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

      await writeManifest(
        acceptedFactories,
        plans,
        undefined,
        manifestOutPath,
        "ioc-manifest",
      );

      const typesSource = await fs.readFile(
        path.join(generatedDir, "ioc-registry.types.ts"),
        "utf8",
      );
      assert.match(typesSource, /\bdatabase:\s*Knex\b/);
      assert.ok(!/\bknex:\s*Knex\b/.test(typesSource));
    });

    it("should keep automatic plural collections as ReadonlyArray even when groups are configured", async () => {
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
          collectionKey: "widgets",
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
        widgetGroup: [
          { contractName: "Widget", registrationKey: "primaryWidget" },
          { contractName: "Widget", registrationKey: "widget" },
        ],
        widgetObjectGroup: {
          widget: { contractName: "Widget", registrationKey: "widget" },
        },
      };

      await writeManifest(
        acceptedFactories,
        plans,
        groups,
        manifestOutPath,
        "ioc-manifest",
      );

      const typesSource = await fs.readFile(
        path.join(generatedDir, "ioc-registry.types.ts"),
        "utf8",
      );
      assert.match(typesSource, /\bwidgets:\s*ReadonlyArray<\s*Widget\s*>\s*;/);
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
    });
  });
});
