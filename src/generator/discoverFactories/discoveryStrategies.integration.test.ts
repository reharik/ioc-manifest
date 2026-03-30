import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import {
  IocDiscoverySkipReason,
  IocDiscoveryStatus,
} from "./discoveryOutcomeTypes.js";
import type { DiscoveredFactory } from "../types.js";
import { discoverFactories } from "./discoverFactories.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(
  __dirname,
  "..",
  "test-fixtures",
  "discovery-strategies",
);
const projectRoot = path.resolve(fixtureDir, "../../../..");
const srcDir = path.join(projectRoot, "src");
const generatedDir = path.join(srcDir, "generated");

const makeProgram = (): ts.Program => {
  const roots = [
    path.join(fixtureDir, "contract.ts"),
    path.join(fixtureDir, "naming-factories.ts"),
    path.join(fixtureDir, "extra-naming-factories.ts"),
    path.join(fixtureDir, "create-factories.ts"),
    path.join(fixtureDir, "both-matching-factories.ts"),
    path.join(fixtureDir, "invalid-factory.ts"),
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

const sortByExportName = (factories: DiscoveredFactory[]): DiscoveredFactory[] =>
  [...factories].sort((a, b) => a.exportName.localeCompare(b.exportName));

const byExportName = (
  factories: DiscoveredFactory[],
  exportName: string,
): DiscoveredFactory | undefined =>
  factories.find((f) => f.exportName === exportName);

const expectFactory = (
  factories: DiscoveredFactory[],
  exportName: string,
): DiscoveredFactory => {
  const f = byExportName(factories, exportName);
  assert.ok(f, `Expected to discover export "${exportName}"`);
  return f;
};

describe("Discovery strategies (discoverFactories)", () => {
  describe("When naming convention discovery is enabled", () => {
    it("should discover build* factories by default prefix", () => {
      const program = makeProgram();
      const namingFile = path.join(fixtureDir, "naming-factories.ts");

      const { acceptedFactories } = discoverFactories(
        [namingFile],
        program,
        projectRoot,
        "build",
        {
          srcDir,
          generatedDir,
        },
      );

      const sorted = sortByExportName(acceptedFactories);
      assert.strictEqual(sorted.length, 1);
      const f = expectFactory(sorted, "buildFoo");
      assert.strictEqual(f.contractName, "Foo");
      assert.strictEqual(f.implementationName, "foo");
    });

    it("should discover create* factories when a custom prefix is configured", () => {
      const program = makeProgram();
      const createFile = path.join(fixtureDir, "create-factories.ts");

      const { acceptedFactories } = discoverFactories(
        [createFile],
        program,
        projectRoot,
        "create",
        {
          srcDir,
          generatedDir,
        },
      );

      const f = expectFactory(acceptedFactories, "createCustom");
      assert.strictEqual(f.contractName, "Foo");
      assert.strictEqual(f.implementationName, "custom");
    });

    it("should not discover non-matching exports by naming alone", () => {
      const program = makeProgram();
      const namingFile = path.join(fixtureDir, "naming-factories.ts");

      const { acceptedFactories } = discoverFactories(
        [namingFile],
        program,
        projectRoot,
        "build",
        {
          srcDir,
          generatedDir,
        },
      );

      assert.ok(
        !acceptedFactories.some((f) => f.exportName === "notDiscoveredByNaming"),
        "Expected naming-only discovery to ignore non-matching exports",
      );
    });
  });

  describe("When naming convention discovery handles plain factory exports", () => {
    it("should use naming-derived implementation name for the configured prefix", () => {
      const program = makeProgram();
      const bothFile = path.join(
        fixtureDir,
        "both-matching-factories.ts",
      );

      const { acceptedFactories } = discoverFactories(
        [bothFile],
        program,
        projectRoot,
        "create",
        {
          srcDir,
          generatedDir,
        },
      );

      assert.strictEqual(acceptedFactories.length, 1);
      const f = acceptedFactories[0]!;
      assert.strictEqual(f.exportName, "createBoth");
      assert.strictEqual(f.implementationName, "both");
    });
  });

  describe("When factories fail contract/return-type validation", () => {
    it("should skip the export with contract_not_resolved and omit it from accepted factories", () => {
      const program = makeProgram();
      const invalidFile = path.join(fixtureDir, "invalid-factory.ts");

      const { acceptedFactories, discoveryFiles } = discoverFactories(
        [invalidFile],
        program,
        projectRoot,
        "build",
        {
          srcDir,
          generatedDir,
        },
        undefined,
        { collectFileRecords: true },
      );

      assert.strictEqual(acceptedFactories.length, 0);
      const record = discoveryFiles.find((f) =>
        f.sourceFilePath.endsWith("invalid-factory.ts"),
      );
      assert.ok(record);
      const exportOutcome = record.outcomes.find(
        (o) => o.scope === "export" && o.exportName === "buildInvalid",
      );
      assert.ok(exportOutcome && exportOutcome.scope === "export");
      if (exportOutcome.scope === "export") {
        assert.strictEqual(exportOutcome.status, IocDiscoveryStatus.SKIPPED);
        assert.strictEqual(
          exportOutcome.skipReason,
          IocDiscoverySkipReason.CONTRACT_NOT_RESOLVED,
        );
      }
    });
  });

  describe("When multiple modules each define naming-convention factories", () => {
    it("should discover factories from multiple files in one pass", () => {
      const program = makeProgram();
      const namingFile = path.join(fixtureDir, "naming-factories.ts");
      const extraFile = path.join(fixtureDir, "extra-naming-factories.ts");

      const { acceptedFactories } = discoverFactories(
        [namingFile, extraFile],
        program,
        projectRoot,
        "build",
        {
          srcDir,
          generatedDir,
        },
      );

      const exports = new Set(acceptedFactories.map((f) => f.exportName));
      assert.ok(exports.has("buildFoo"));
      assert.ok(exports.has("buildExtra"));
    });
  });
});

