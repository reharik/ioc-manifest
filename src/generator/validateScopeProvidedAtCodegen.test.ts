import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { analyzeDemandSupply } from "./analyzeDemandSupply/index.js";
import { validateScopeProvidedAtCodegen } from "./validateScopeProvidedAtCodegen.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "test-fixtures/demand-supply");
const projectRoot = path.join(__dirname, "..");
const generatedDir = path.join(projectRoot, "generated");
const scanDirs = [{ absPath: fixtureDir }];

const makeProgram = (): ts.Program =>
  ts.createProgram({
    rootNames: [
      path.join(fixtureDir, "contracts.ts"),
      path.join(fixtureDir, "factories.ts"),
    ],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });

const userServiceFactory = {
  contractName: "UserService",
  contractTypeRelImport: "../test-fixtures/demand-supply/contracts.js",
  implementationName: "userService",
  exportName: "buildUserService",
  registrationKey: "userService",
  modulePath: "factories.ts",
  relImport: "./factories.js",
} as const;

const albumFactories = [
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

describe("validateScopeProvidedAtCodegen", () => {
  describe("When a declared key is demanded and reclassified as scope-provided", () => {
    it("should not warn or throw", () => {
      const program = makeProgram();
      const demandSupply = analyzeDemandSupply([userServiceFactory], {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
        scopeProvided: ["database"],
      });

      assert.strictEqual(
        demandSupply.entries.find((e) => e.key === "database")?.classification,
        "scope-provided",
      );

      const warnings = captureWarnings(() => {
        validateScopeProvidedAtCodegen(["database"], demandSupply);
      });

      assert.deepStrictEqual(warnings, []);
    });
  });

  describe("When a declared key matches no demanded dependency", () => {
    it("should warn and allow generation to continue", () => {
      const program = makeProgram();
      const demandSupply = analyzeDemandSupply([userServiceFactory], {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
      });

      const warnings = captureWarnings(() => {
        validateScopeProvidedAtCodegen(["viewerId"], demandSupply);
      });

      assert.strictEqual(warnings.length, 1);
      assert.match(
        warnings[0]!,
        /scopeProvided declares "viewerId" but no factory demands it/,
      );
    });
  });

  describe("When a declared key is also built locally", () => {
    it("should throw naming the key", () => {
      const program = makeProgram();
      const demandSupply = analyzeDemandSupply(albumFactories, {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
        scopeProvided: ["albumRepository"],
      });

      assert.strictEqual(
        demandSupply.entries.find((e) => e.key === "albumRepository")
          ?.classification,
        "local",
      );

      assert.throws(
        () => validateScopeProvidedAtCodegen(["albumRepository"], demandSupply),
        /scopeProvided declares "albumRepository", but it is built by a local supplier/,
      );
    });
  });

  describe("When multiple declared keys mix valid and dead entries", () => {
    it("should warn once for each dead key and not throw for valid ones", () => {
      const program = makeProgram();
      const demandSupply = analyzeDemandSupply([userServiceFactory], {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
        scopeProvided: ["database"],
      });

      const warnings = captureWarnings(() => {
        validateScopeProvidedAtCodegen(["database", "viewerId"], demandSupply);
      });

      assert.strictEqual(warnings.length, 1);
      assert.match(
        warnings[0]!,
        /scopeProvided declares "viewerId" but no factory demands it/,
      );
    });
  });
});
