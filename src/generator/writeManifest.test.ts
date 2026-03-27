import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
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
): ResolvedContractRegistration => ({
  contractKey: partial.contractKey ?? "svc",
  collectionKey: partial.collectionKey,
  ...partial,
});

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

      await writeManifest(
        acceptedFactories,
        plans,
        undefined,
        manifestOutPath,
        "ioc-manifest",
      );

      const manifestSource = await fs.readFile(manifestOutPath, "utf8");
      const typesSource = await fs.readFile(typesPath, "utf8");
      assert.ok(!manifestSource.includes("OLD_CONTENT_SHOULD_BE_REPLACED"));
      assert.ok(!typesSource.includes("OLD_TYPES_SHOULD_BE_REPLACED"));
      assert.ok(manifestSource.includes("iocManifestByContract"));
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
});
