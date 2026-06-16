import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import type { IocGroupsManifest } from "../../core/manifest.js";
import { buildManifestArtifactSources } from "../writeManifest.js";
import { analyzeDemandSupply } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "../test-fixtures/demand-supply");
const projectRoot = path.join(__dirname, "../..");
const generatedDir = path.join(projectRoot, "generated");
const scanDirs = [{ absPath: fixtureDir }];

const channelsGroupManifest: IocGroupsManifest = {
  channels: {
    kind: "object",
    baseType: "NotificationChannel",
    baseTypeId: "/fake/NotificationChannel.ts:NotificationChannel",
    members: {
      emailChannel: {
        contractName: "EmailChannel",
        registrationKey: "emailChannel",
      },
      smsChannel: {
        contractName: "SmsChannel",
        registrationKey: "smsChannel",
      },
    },
  },
};

const makeProgram = (extraRoots: string[]): ts.Program =>
  ts.createProgram({
    rootNames: [
      path.join(fixtureDir, "channel-contracts.ts"),
      ...extraRoots,
    ],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });

const channelFactories = [
  {
    contractName: "EmailChannel",
    contractTypeRelImport: "../test-fixtures/demand-supply/channel-contracts.js",
    implementationName: "emailChannel",
    exportName: "buildEmailChannel",
    registrationKey: "emailChannel",
    modulePath: "same-package-group-factories.ts",
    relImport: "./same-package-group-factories.js",
  },
  {
    contractName: "SmsChannel",
    contractTypeRelImport: "../test-fixtures/demand-supply/channel-contracts.js",
    implementationName: "smsChannel",
    exportName: "buildSmsChannel",
    registrationKey: "smsChannel",
    modulePath: "same-package-group-factories.ts",
    relImport: "./same-package-group-factories.js",
  },
  {
    contractName: "NotificationService",
    contractTypeRelImport: "../test-fixtures/demand-supply/channel-contracts.js",
    implementationName: "notificationService",
    exportName: "buildNotificationService",
    registrationKey: "notificationService",
    modulePath: "same-package-group-factories.ts",
    relImport: "./same-package-group-factories.js",
  },
] as const;

describe("same-package IocGeneratedCradle indexed access", () => {
  describe("When a factory consumes a declared group via IocGeneratedCradle['channels']", () => {
    it("should not record a poisoned unknown demand entry for the group key", () => {
      const program = makeProgram([
        path.join(fixtureDir, "mock-ioc-generated-cradle-channels.ts"),
        path.join(fixtureDir, "same-package-group-factories.ts"),
      ]);

      const result = analyzeDemandSupply(channelFactories, {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
        groupsManifest: channelsGroupManifest,
      });

      const channels = result.entries.find((e) => e.key === "channels");
      assert.strictEqual(channels, undefined);
    });

    it("should emit the group member object type on IocGeneratedCradle", () => {
      const program = makeProgram([
        path.join(fixtureDir, "mock-ioc-generated-cradle-channels.ts"),
        path.join(fixtureDir, "same-package-group-factories.ts"),
      ]);

      const demandSupply = analyzeDemandSupply(channelFactories, {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
        groupsManifest: channelsGroupManifest,
      });

      const { typesSource } = buildManifestArtifactSources(
        channelFactories,
        [],
        channelsGroupManifest,
        path.join(generatedDir, "ioc-manifest.ts"),
        "ioc-manifest",
        { demandSupply },
      );

      assert.match(
        typesSource,
        /channels:\s*\{\s*emailChannel:\s*EmailChannel;\s*smsChannel:\s*SmsChannel;\s*\};/,
      );
      assert.ok(!typesSource.includes("channels: unknown"));
    });
  });

  describe("When the generated cradle file is absent on cold start", () => {
    it("should still analyze group consumption without aborting", () => {
      const program = makeProgram([
        path.join(fixtureDir, "cold-start-group-factories.ts"),
      ]);

      const coldStartFactories = channelFactories.map((factory) => ({
        ...factory,
        modulePath: "cold-start-group-factories.ts",
        relImport: "./cold-start-group-factories.js",
      }));

      assert.doesNotThrow(() =>
        analyzeDemandSupply(coldStartFactories, {
          program,
          projectRoot,
          scanDirs,
          generatedDir,
          groupsManifest: channelsGroupManifest,
        }),
      );
    });
  });

  describe("When a factory imports IocGeneratedCradle under an alias", () => {
    it("should resolve Cradle['channels'] to the group object type without reading the stale cradle", () => {
      const program = makeProgram([
        path.join(fixtureDir, "mock-ioc-generated-cradle-channels.ts"),
        path.join(fixtureDir, "same-package-group-aliased-factories.ts"),
      ]);

      const aliasedFactories = channelFactories.map((factory) => ({
        ...factory,
        modulePath: "same-package-group-aliased-factories.ts",
        relImport: "./same-package-group-aliased-factories.js",
      }));

      const demandSupply = analyzeDemandSupply(aliasedFactories, {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
        groupsManifest: channelsGroupManifest,
      });

      const channels = demandSupply.entries.find((e) => e.key === "channels");
      assert.strictEqual(channels, undefined);

      const { typesSource } = buildManifestArtifactSources(
        aliasedFactories,
        [],
        channelsGroupManifest,
        path.join(generatedDir, "ioc-manifest.ts"),
        "ioc-manifest",
        { demandSupply },
      );

      assert.match(
        typesSource,
        /channels:\s*\{\s*emailChannel:\s*EmailChannel;\s*smsChannel:\s*SmsChannel;\s*\};/,
      );
      assert.ok(!typesSource.includes("channels: unknown"));
    });
  });

  describe("When groupsManifest is omitted before demand analysis", () => {
    it("should throw for group keys to guard against reordered codegen passes", () => {
      const program = makeProgram([
        path.join(fixtureDir, "mock-ioc-generated-cradle-channels.ts"),
        path.join(fixtureDir, "same-package-group-factories.ts"),
      ]);

      assert.throws(
        () =>
          analyzeDemandSupply(channelFactories, {
            program,
            projectRoot,
            scanDirs,
            generatedDir,
          }),
        (err: Error) => {
          assert.match(
            err.message,
            /consumed cradle key "channels" on property "channels" that is not a known registration or group/,
          );
          return true;
        },
      );
    });
  });

  describe("When a factory references an unknown IocGeneratedCradle key", () => {
    it("should throw a clear diagnostic for the channel/channels typo", () => {
      const program = makeProgram([
        path.join(fixtureDir, "mock-ioc-generated-cradle-channels.ts"),
        path.join(fixtureDir, "same-package-group-factories.ts"),
      ]);

      const factories = [
        {
          contractName: "NotificationService",
          contractTypeRelImport:
            "../test-fixtures/demand-supply/channel-contracts.js",
          implementationName: "typoConsumer",
          exportName: "buildTypoCradleConsumer",
          registrationKey: "typoConsumer",
          modulePath: "same-package-group-factories.ts",
          relImport: "./same-package-group-factories.js",
        },
      ] as const;

      assert.throws(
        () =>
          analyzeDemandSupply(factories, {
            program,
            projectRoot,
            scanDirs,
            generatedDir,
            groupsManifest: channelsGroupManifest,
          }),
        (err: Error) => {
          assert.match(
            err.message,
            /consumed cradle key "channel" on property "channel" that is not a known registration or group/,
          );
          return true;
        },
      );
    });
  });

  describe("When a factory consumes a local registration via IocGeneratedCradle['albumRepository']", () => {
    it("should resolve the supplier contract type instead of unknown", () => {
      const program = makeProgram([
        path.join(fixtureDir, "mock-ioc-generated-cradle-channels.ts"),
        path.join(fixtureDir, "factories.ts"),
        path.join(fixtureDir, "cradle-indexed-registration-factory.ts"),
      ]);

      const factories = [
        {
          contractName: "AlbumRepository",
          contractTypeRelImport: "../test-fixtures/demand-supply/contracts.js",
          implementationName: "albumRepository",
          exportName: "buildAlbumRepository",
          registrationKey: "albumRepository",
          modulePath: "factories.ts",
          relImport: "./factories.js",
        },
        {
          contractName: "AlbumService",
          contractTypeRelImport: "../test-fixtures/demand-supply/contracts.js",
          implementationName: "albumServiceViaCradle",
          exportName: "buildAlbumServiceViaCradle",
          registrationKey: "albumServiceViaCradle",
          modulePath: "cradle-indexed-registration-factory.ts",
          relImport: "./cradle-indexed-registration-factory.js",
        },
      ] as const;

      const result = analyzeDemandSupply(factories, {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
      });

      const albumRepository = result.entries.find(
        (e) => e.key === "albumRepository",
      );
      assert.strictEqual(albumRepository?.typeRef.typeName, "AlbumRepository");
      assert.strictEqual(albumRepository?.classification, "local");
    });
  });

  describe("When registry types are regenerated twice", () => {
    it("should produce identical output", async () => {
      const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "ioc-same-package-group-"),
      );
      const tempGeneratedDir = path.join(tempRoot, "generated");
      await fs.mkdir(tempGeneratedDir, { recursive: true });

      const program = makeProgram([
        path.join(fixtureDir, "mock-ioc-generated-cradle-channels.ts"),
        path.join(fixtureDir, "same-package-group-factories.ts"),
      ]);

      const buildTypes = (): string => {
        const demandSupply = analyzeDemandSupply(channelFactories, {
          program,
          projectRoot: tempRoot,
          scanDirs,
          generatedDir: tempGeneratedDir,
          groupsManifest: channelsGroupManifest,
        });
        return buildManifestArtifactSources(
          channelFactories,
          [],
          channelsGroupManifest,
          path.join(tempGeneratedDir, "ioc-manifest.ts"),
          "ioc-manifest",
          { demandSupply },
        ).typesSource;
      };

      const first = buildTypes();
      const second = buildTypes();
      assert.strictEqual(first, second);
    });
  });
});
