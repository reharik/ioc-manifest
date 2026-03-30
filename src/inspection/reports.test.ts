import assert from "node:assert";
import { describe, it } from "node:test";
import type { IocContractManifest } from "../core/manifest.js";
import {
  IocDiscoverySkipReason,
  IocDiscoveryStatus,
} from "../generator/discoverFactories/discoveryOutcomeTypes.js";
import { buildDiscoveryReport, buildInspectionReport } from "./reports.js";

const sampleManifest = (): IocContractManifest => ({
  MediaStorage: {
    local: {
      exportName: "buildLocalMediaStorage",
      registrationKey: "localMediaStorage",
      modulePath: "src/media/buildLocalMediaStorage.ts",
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
        media.implementations[0]?.modulePath.includes("buildLocalMediaStorage"),
      );
      assert.strictEqual(report.manifestIssues.length, 0);
    });
  });

  describe("When the manifest has multiple implementations and one matches the contract registration key", () => {
    it("should not report a missing-default issue", () => {
      const manifest: IocContractManifest = {
        Widget: {
          primaryWidget: {
            exportName: "buildPrimary",
            registrationKey: "primaryWidget",
            modulePath: "p.ts",
            relImport: "../p.js",
            contractName: "Widget",
            implementationName: "primaryWidget",
            lifetime: "singleton",
            moduleIndex: 0,
          },
          widget: {
            exportName: "buildWidget",
            registrationKey: "widget",
            modulePath: "w.ts",
            relImport: "../w.js",
            contractName: "Widget",
            implementationName: "widget",
            lifetime: "singleton",
            moduleIndex: 1,
          },
        },
      };
      const report = buildInspectionReport(manifest);
      assert.strictEqual(report.manifestIssues.length, 0);
      const w = report.contracts.find((c) => c.contractName === "Widget");
      assert.ok(w);
      assert.strictEqual(w.defaultImplementationName, "widget");
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
          modulePath: "src/media/buildLocalMediaStorage.ts",
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
          modulePath: "src/media/localMediaStorage.ts",
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
        f.modulePath.includes("buildLocal"),
      );
      assert.ok(discoveredFile?.rows.some((r) => r.status === "discovered"));
      const skippedFile = report.files.find((f) =>
        f.modulePath.includes("localMediaStorage.ts"),
      );
      assert.ok(
        skippedFile?.rows.some(
          (r) => r.skipReason === IocDiscoverySkipReason.NO_MATCHING_EXPORT,
        ),
      );
    });
  });
});
