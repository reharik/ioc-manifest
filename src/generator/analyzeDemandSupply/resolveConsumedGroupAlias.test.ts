import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import type { IocGroupsManifest } from "../../core/manifest.js";
import type { DiscoveredFactory } from "../types.js";
import { buildManifestArtifactSources } from "../writeManifest.js";
import { analyzeDemandSupply } from "./index.js";
import {
  depsPropertyTypeNodeByName,
  tryParseConsumedGroupAliasKey,
} from "./resolveIocGeneratedCradleIndexedAccess.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "../test-fixtures/consumed-group-alias");
const projectRoot = path.join(__dirname, "../..");
// The generated dir intentionally does NOT exist on disk — this is the cold-start condition.
const generatedDir = path.join(fixtureDir, "generated");
const contractsPath = path.join(fixtureDir, "contracts.ts");
const factoriesPath = path.join(fixtureDir, "factories.ts");
const shadowFactoriesPath = path.join(fixtureDir, "factories-local-shadow.ts");
const scanDirs = [{ absPath: fixtureDir }];

const groupsManifest: IocGroupsManifest = {
  channels: {
    kind: "object",
    baseType: "NotificationChannel",
    baseTypeId: "/fake/NotificationChannel.ts:NotificationChannel",
    members: {
      emailChannel: {
        contractName: "EmailChannel",
        registrationKey: "emailChannel",
      },
    },
  },
  sweepTasks: {
    kind: "collection",
    baseType: "SweepTask",
    baseTypeId: "/fake/SweepTask.ts:SweepTask",
    members: [{ contractName: "SweepTask", registrationKey: "sweepTask" }],
  },
};

/** Program built WITHOUT the generated registry-types file — the named alias imports do not
 * resolve, exactly as on a cold start / clean CI run. */
const makeColdStartProgram = (): ts.Program =>
  ts.createProgram({
    rootNames: [contractsPath, factoriesPath, shadowFactoriesPath],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });

/** The `ts.Type` of a factory's single (destructured) deps parameter. */
const depsParamType = (
  program: ts.Program,
  filePath: string,
  exportName: string,
): ts.Type => {
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(filePath)!;
  const stmt = sf.statements.find(
    (s) =>
      ts.isVariableStatement(s) &&
      s.declarationList.declarations.some(
        (d) => ts.isIdentifier(d.name) && d.name.text === exportName,
      ),
  ) as ts.VariableStatement;
  const decl = stmt.declarationList.declarations[0]!;
  const fn = decl.initializer as ts.ArrowFunction;
  const param = fn.parameters[0]!;
  return checker.getTypeAtLocation(param);
};

const parseAliasKey = (
  program: ts.Program,
  filePath: string,
  exportName: string,
  propName: string,
  manifest: IocGroupsManifest | undefined,
): string | undefined => {
  const checker = program.getTypeChecker();
  const nodes = depsPropertyTypeNodeByName(
    checker,
    depsParamType(program, filePath, exportName),
  );
  return tryParseConsumedGroupAliasKey(checker, nodes.get(propName), manifest);
};

const channelFactories: DiscoveredFactory[] = [
  {
    contractName: "EmailChannel",
    contractTypeRelImport: "../test-fixtures/consumed-group-alias/contracts.js",
    implementationName: "emailChannel",
    exportName: "buildEmailChannel",
    registrationKey: "emailChannel",
    modulePath: "factories.ts",
    relImport: "./factories.js",
  },
  {
    contractName: "SweepTask",
    contractTypeRelImport: "../test-fixtures/consumed-group-alias/contracts.js",
    implementationName: "sweepTask",
    exportName: "buildSweepTask",
    registrationKey: "sweepTask",
    modulePath: "factories.ts",
    relImport: "./factories.js",
  },
  {
    contractName: "NotificationService",
    contractTypeRelImport: "../test-fixtures/consumed-group-alias/contracts.js",
    implementationName: "notificationService",
    exportName: "buildNotificationService",
    registrationKey: "notificationService",
    modulePath: "factories.ts",
    relImport: "./factories.js",
  },
  {
    contractName: "SweepReport",
    contractTypeRelImport: "../test-fixtures/consumed-group-alias/contracts.js",
    implementationName: "sweepReport",
    exportName: "buildSweepReport",
    registrationKey: "sweepReport",
    modulePath: "factories.ts",
    relImport: "./factories.js",
  },
];

describe("tryParseConsumedGroupAliasKey", () => {
  describe("reverse-mapping a named group-alias import to its group key (cold start)", () => {
    it("resolves an object-group alias imported by name to its group key", () => {
      const program = makeColdStartProgram();
      assert.strictEqual(
        parseAliasKey(
          program,
          factoriesPath,
          "buildNotificationService",
          "chans",
          groupsManifest,
        ),
        "channels",
      );
    });

    it("resolves a collection-group alias imported by name to its group key", () => {
      const program = makeColdStartProgram();
      assert.strictEqual(
        parseAliasKey(
          program,
          factoriesPath,
          "buildSweepReport",
          "pending",
          groupsManifest,
        ),
        "sweepTasks",
      );
    });
  });

  describe("leaving non-group-alias references alone", () => {
    it("returns undefined for a non-alias name imported from the registry file", () => {
      const program = makeColdStartProgram();
      assert.strictEqual(
        parseAliasKey(
          program,
          factoriesPath,
          "buildNonAlias",
          "cradle",
          groupsManifest,
        ),
        undefined,
      );
    });

    it("returns undefined for a locally-declared type that shares a group-alias name", () => {
      const program = makeColdStartProgram();
      assert.strictEqual(
        parseAliasKey(
          program,
          shadowFactoriesPath,
          "buildShadow",
          "chans",
          groupsManifest,
        ),
        undefined,
      );
    });

    it("returns undefined when no groups manifest is available", () => {
      const program = makeColdStartProgram();
      assert.strictEqual(
        parseAliasKey(
          program,
          factoriesPath,
          "buildNotificationService",
          "chans",
          undefined,
        ),
        undefined,
      );
    });
  });
});

describe("cold-start group-alias consumption through demand analysis", () => {
  describe("When a factory consumes a group via a NAMED alias import and the generated file is absent", () => {
    it("analyzes without aborting and records no poisoned demand for the group", () => {
      const program = makeColdStartProgram();

      let demandSupply!: ReturnType<typeof analyzeDemandSupply>;
      assert.doesNotThrow(() => {
        demandSupply = analyzeDemandSupply(channelFactories, {
          program,
          projectRoot,
          scanDirs,
          generatedDir,
          groupsManifest,
        });
      });

      // The consuming deps short-circuit to group resolution: no per-property demand entries.
      const keys = demandSupply.entries.map((e) => e.key);
      assert.ok(!keys.includes("chans"), `unexpected demand 'chans' in ${keys}`);
      assert.ok(!keys.includes("pending"), `unexpected demand 'pending' in ${keys}`);
      assert.ok(!keys.includes("channels"), `unexpected demand 'channels' in ${keys}`);
      assert.ok(
        !keys.includes("sweepTasks"),
        `unexpected demand 'sweepTasks' in ${keys}`,
      );
    });

    it("writes registry types that declare the group aliases (regen completes)", () => {
      const program = makeColdStartProgram();
      const demandSupply = analyzeDemandSupply(channelFactories, {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
        groupsManifest,
      });

      const { typesSource } = buildManifestArtifactSources(
        channelFactories,
        [],
        groupsManifest,
        path.join(generatedDir, "ioc-manifest.ts"),
        "ioc-manifest",
        { demandSupply },
      );

      assert.match(typesSource, /export type Channels =/);
      assert.match(typesSource, /export type SweepTasks = ReadonlyArray<SweepTask>;/);
      // Cold start must never import the not-yet-existing generated file into itself.
      assert.doesNotMatch(
        typesSource,
        /from ["'][^"']*ioc-registry\.types(\.js)?["']/,
      );
    });
  });
});
