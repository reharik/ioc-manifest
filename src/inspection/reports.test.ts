import assert from "node:assert";
import { describe, it } from "node:test";
import { analyzeBundlePlan } from "../bundles/resolveBundlePlan.js";
import type { IocContractManifest } from "../core/manifest.js";
import {
  IocDiscoverySkipReason,
  IocDiscoveryStatus,
} from "../generator/discoverFactories/discoveryOutcomeTypes.js";
import type { ResolvedContractRegistration } from "../generator/resolveRegistrationPlan.js";
import {
  buildBundleReport,
  buildDiscoveryReport,
  buildInspectionReport,
} from "./reports.js";

const makePlan = (
  contractName: string,
  contractKey: string,
): ResolvedContractRegistration => ({
  contractName,
  contractTypeRelImport: "../contracts.js",
  contractKey,
  collectionKey: undefined,
  defaultImplementationName: contractKey,
  implementations: [
    {
      implementationName: contractKey,
      exportName: `build${contractName}`,
      modulePath: "m.ts",
      relImport: "../m.js",
      registrationKey: contractKey,
      lifetime: "singleton",
    },
  ],
});

const sampleManifest = (): IocContractManifest => ({
  MediaStorage: {
    local: {
      exportName: "buildLocalMediaStorage",
      registrationKey: "localMediaStorage",
      modulePath: "src/media/buildLocalMediaStorage.ts",
      sourceFilePath: "src/media/buildLocalMediaStorage.ts",
      relImport: "../media/buildLocalMediaStorage.js",
      contractName: "MediaStorage",
      implementationName: "local",
      lifetime: "singleton",
      moduleIndex: 0,
      default: true,
    },
  },
  AlbumService: {
    albumService: {
      exportName: "buildAlbumService",
      registrationKey: "albumService",
      modulePath: "src/albums/buildAlbumService.ts",
      sourceFilePath: "src/albums/buildAlbumService.ts",
      relImport: "../albums/buildAlbumService.js",
      contractName: "AlbumService",
      implementationName: "albumService",
      lifetime: "scoped",
      moduleIndex: 1,
      default: true,
    },
  },
});

describe("Inspection reports", () => {
  describe("When buildInspectionReport runs on a valid manifest", () => {
    it("should list contracts, defaults, lifetimes, and source paths", () => {
      const report = buildInspectionReport(sampleManifest());
      assert.strictEqual(report.contracts.length, 2);
      const media = report.contracts.find((c) => c.contractName === "MediaStorage");
      assert.ok(media);
      assert.strictEqual(media.defaultImplementationName, "local");
      assert.strictEqual(media.implementations[0]?.lifecycle, "singleton");
      assert.ok(
        media.implementations[0]?.sourceFilePath.includes("buildLocalMediaStorage"),
      );
      assert.strictEqual(report.manifestIssues.length, 0);
    });
  });

  describe("When the manifest has multiple implementations without a default", () => {
    it("should surface a manifest validation issue", () => {
      const manifest: IocContractManifest = {
        MediaStorage: {
          a: {
            exportName: "buildA",
            registrationKey: "a",
            modulePath: "a.ts",
            sourceFilePath: "a.ts",
            relImport: "../a.js",
            contractName: "MediaStorage",
            implementationName: "a",
            lifetime: "singleton",
            moduleIndex: 0,
          },
          b: {
            exportName: "buildB",
            registrationKey: "b",
            modulePath: "b.ts",
            sourceFilePath: "b.ts",
            relImport: "../b.js",
            contractName: "MediaStorage",
            implementationName: "b",
            lifetime: "singleton",
            moduleIndex: 1,
          },
        },
      };
      const report = buildInspectionReport(manifest);
      assert.ok(
        report.manifestIssues.some(
          (i) => i.code === "multiple_implementations_no_default",
        ),
      );
    });
  });

  describe("When buildDiscoveryReport runs", () => {
    it("should format discovered and skipped exports from on-demand discovery files", () => {
      const report = buildDiscoveryReport([
        {
          sourceFilePath: "src/media/buildLocalMediaStorage.ts",
          outcomes: [
            {
              scope: "export",
              exportName: "buildLocalMediaStorage",
              status: IocDiscoveryStatus.DISCOVERED,
              contractName: "MediaStorage",
              implementationName: "localMediaStorage",
              registrationKey: "localMediaStorage",
              discoveredBy: "naming",
            },
          ],
        },
        {
          sourceFilePath: "src/media/localMediaStorage.ts",
          outcomes: [
            {
              scope: "file",
              status: IocDiscoveryStatus.SKIPPED,
              skipReason: IocDiscoverySkipReason.NO_MATCHING_EXPORT,
            },
          ],
        },
      ]);
      assert.strictEqual(report.files.length, 2);
      const discoveredFile = report.files.find((f) =>
        f.sourceFilePath.includes("buildLocal"),
      );
      assert.ok(discoveredFile?.rows.some((r) => r.status === "discovered"));
      const skippedFile = report.files.find((f) =>
        f.sourceFilePath.includes("localMediaStorage.ts"),
      );
      assert.ok(
        skippedFile?.rows.some(
          (r) => r.skipReason === IocDiscoverySkipReason.NO_MATCHING_EXPORT,
        ),
      );
    });
  });

  describe("When buildBundleReport runs on manifest insight", () => {
    it("should include declared refs and expanded contract names", () => {
      const report = buildBundleReport([
        {
          bundlePath: "services.read",
          declaredMembers: [
            { $bundleRef: "services.album" },
            "MediaStorage",
          ],
          expandedMembers: [
            { contractName: "AlbumService", registrationKey: "albumService" },
            { contractName: "MediaStorage", registrationKey: "mediaStorage" },
          ],
        },
      ]);
      assert.strictEqual(report.bundles.length, 1);
      assert.strictEqual(report.bundles[0]?.expandedMembers.length, 2);
      assert.strictEqual(report.issues.length, 0);
    });
  });

  describe("When analyzeBundlePlan reports invalid bundle references", () => {
    it("should attach formatted issues to the bundle report", () => {
      const plans: ResolvedContractRegistration[] = [
        makePlan("MediaStorage", "mediaStorage"),
      ];
      const analysis = analyzeBundlePlan(
        {
          services: {
            read: [{ $bundleRef: "services.typo" }],
          },
        },
        plans,
      );
      const report = buildBundleReport([], analysis);
      assert.ok(report.issues.length > 0);
      assert.ok(
        report.issues.some((i) => i.message.includes("unknown bundle path")),
      );
    });
  });

  describe("When analyzeBundlePlan detects a cycle", () => {
    it("should include a cycle description in bundle report issues", () => {
      const plans: ResolvedContractRegistration[] = [
        makePlan("ListAlbums", "listAlbums"),
      ];
      const analysis = analyzeBundlePlan(
        {
          services: {
            a: [{ $bundleRef: "services.b" }],
            b: [{ $bundleRef: "services.a" }],
          },
        },
        plans,
      );
      const report = buildBundleReport([], analysis);
      assert.ok(
        report.issues.some((i) => i.message.includes("Circular bundle reference")),
      );
    });
  });
});
