import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { analyzeDemandSupply } from "./index.js";
import { formatIocGeneratedCradleDestructureError } from "./enforceNamedDepsType.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "../test-fixtures/demand-supply");
const projectRoot = path.join(__dirname, "../..");

const makeProgram = (extraRoots: string[] = []): ts.Program => {
  const roots = [
    path.join(fixtureDir, "contracts.ts"),
    path.join(fixtureDir, "factories.ts"),
    ...extraRoots,
  ];
  return ts.createProgram({
    rootNames: roots,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });
};

const generatedDir = path.join(projectRoot, "generated");
const scanDirs = [{ absPath: fixtureDir }];

describe("analyzeDemandSupply", () => {
  describe("When factories demand external keys", () => {
    it("should classify unsatisfied demands as external", () => {
      const program = makeProgram();
      const factories = [
        {
          contractName: "UserService",
          contractTypeRelImport: "../test-fixtures/demand-supply/contracts.js",
          implementationName: "userService",
          exportName: "buildUserService",
          registrationKey: "userService",
          modulePath: "factories.ts",
          relImport: "./factories.js",
        },
      ] as const;

      const result = analyzeDemandSupply(factories, {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
      });

      assert.ok(result.externalKeys.includes("database"));
      assert.ok(result.externalKeys.includes("logger"));
      const database = result.entries.find((e) => e.key === "database");
      assert.strictEqual(database?.classification, "external");
    });
  });

  describe("When a demand is satisfied by a local factory supply", () => {
    it("should mark the key as local and omit it from external keys", () => {
      const program = makeProgram();
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
          implementationName: "albumService",
          exportName: "buildAlbumService",
          registrationKey: "albumService",
          modulePath: "factories.ts",
          relImport: "./factories.js",
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
      assert.strictEqual(albumRepository?.classification, "local");
      assert.ok(!result.externalKeys.includes("albumRepository"));
    });
  });

  describe("When a factory supplies a key with no internal demand", () => {
    it("should include the supply in cradle entries as local", () => {
      const program = makeProgram();
      const factories = [
        {
          contractName: "Logger",
          contractTypeRelImport: "../test-fixtures/demand-supply/contracts.js",
          implementationName: "orphanSupply",
          exportName: "buildOrphanSupply",
          registrationKey: "orphanSupply",
          modulePath: "factories.ts",
          relImport: "./factories.js",
        },
      ] as const;

      const result = analyzeDemandSupply(factories, {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
      });

      const orphan = result.entries.find((e) => e.key === "orphanSupply");
      assert.strictEqual(orphan?.classification, "local");
      assert.deepStrictEqual(result.externalKeys, []);
    });
  });

  describe("When two factories disagree on a demanded key type", () => {
    it("should throw with both factory locations and types", () => {
      const program = makeProgram();
      const factories = [
        {
          contractName: "UserService",
          contractTypeRelImport: "../test-fixtures/demand-supply/contracts.js",
          implementationName: "userService",
          exportName: "buildUserService",
          registrationKey: "userService",
          modulePath: "factories.ts",
          relImport: "./factories.js",
        },
        {
          contractName: "UserService",
          contractTypeRelImport: "../test-fixtures/demand-supply/contracts.js",
          implementationName: "userServiceAlt",
          exportName: "buildUserServiceAlt",
          registrationKey: "userServiceAlt",
          modulePath: "factories.ts",
          relImport: "./factories.js",
        },
      ] as const;

      assert.throws(
        () =>
          analyzeDemandSupply(factories, {
            program,
            projectRoot,
            scanDirs,
            generatedDir,
          }),
        (err: Error) => {
          assert.match(err.message, /Conflicting types for demanded key "database"/);
          assert.match(err.message, /buildUserService/);
          assert.match(err.message, /buildUserServiceAlt/);
          assert.match(err.message, /Database/);
          assert.match(err.message, /PostgresClient/);
          return true;
        },
      );
    });
  });

  describe("When group root keys satisfy demanded keys", () => {
    it("should treat group keys as local suppliers", () => {
      const program = makeProgram();
      const factories = [
        {
          contractName: "UserService",
          contractTypeRelImport: "../test-fixtures/demand-supply/contracts.js",
          implementationName: "userService",
          exportName: "buildUserService",
          registrationKey: "userService",
          modulePath: "factories.ts",
          relImport: "./factories.js",
        },
      ] as const;

      const result = analyzeDemandSupply(factories, {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
        groupsManifest: {
          database: [],
        },
      });

      const database = result.entries.find((e) => e.key === "database");
      assert.strictEqual(database?.classification, "local");
      assert.ok(!result.externalKeys.includes("database"));
    });
  });

  describe("When a factory destructures IocGeneratedCradle", () => {
    it("should throw the documented §3 error", () => {
      const program = makeProgram([
        path.join(fixtureDir, "mock-ioc-generated-cradle.ts"),
        path.join(fixtureDir, "ioc-generated-cradle-violation.ts"),
      ]);

      const factories = [
        {
          contractName: "Logger",
          contractTypeRelImport: "../test-fixtures/demand-supply/contracts.js",
          implementationName: "bad",
          exportName: "buildBad",
          registrationKey: "bad",
          modulePath: "ioc-generated-cradle-violation.ts",
          relImport: "./ioc-generated-cradle-violation.js",
        },
      ] as const;

      assert.throws(
        () =>
          analyzeDemandSupply(factories, {
            program,
            projectRoot,
            scanDirs,
            generatedDir,
          }),
        (err: Error) => {
          assert.ok(
            err.message.includes(
              formatIocGeneratedCradleDestructureError(projectRoot, {
                exportName: "buildBad",
                modulePath: "ioc-generated-cradle-violation.ts",
                line: 4,
              }).split("\n")[0]!,
            ),
          );
          assert.match(err.message, /per-package-manifest\.md §3/);
          return true;
        },
      );
    });
  });

  describe("When a factory uses an inline deps object type", () => {
    it("should throw with the inline literal error", () => {
      const program = makeProgram([path.join(fixtureDir, "inline-deps.ts")]);
      const factories = [
        {
          contractName: "Logger",
          contractTypeRelImport: "../test-fixtures/demand-supply/contracts.js",
          implementationName: "inline",
          exportName: "buildInline",
          registrationKey: "inline",
          modulePath: "inline-deps.ts",
          relImport: "./inline-deps.js",
        },
      ] as const;

      assert.throws(
        () =>
          analyzeDemandSupply(factories, {
            program,
            projectRoot,
            scanDirs,
            generatedDir,
          }),
        (err: Error) => {
          assert.match(err.message, /inline object type/);
          assert.match(err.message, /buildInline/);
          return true;
        },
      );
    });
  });
});
