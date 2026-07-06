import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import type { IocConfig } from "../../config/iocConfig.js";
import { discoverFactories } from "../discoverFactories/discoverFactories.js";
import { buildRegistrationPlan } from "../resolveRegistrationPlan.js";
import { buildManifestArtifactSources } from "../writeManifest.js";
import { buildGroupPlan, type IocGroupsConfig } from "../../groups/resolveGroupPlan.js";
import { buildBoundedGroupCollectionTypeRefs } from "../../groups/boundedGroupCollectionType.js";
import { analyzeDemandSupply } from "./index.js";
import { emitTypeReference } from "./emitTypeReference.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(
  __dirname,
  "../test-fixtures/generated-alias-selfimport",
);
const projectRoot = path.join(__dirname, "../..");
const generatedDir = path.join(fixtureDir, "generated");
const registryTypesPath = path.join(generatedDir, "ioc-registry.types.ts");
const contractsPath = path.join(fixtureDir, "contracts.ts");
const factoriesPath = path.join(fixtureDir, "factories.ts");
const scanDirs = [{ absPath: fixtureDir }];

// A project-relative `generatedDir`, as produced by a composed/monorepo run. The 2.3.1 guard
// compared `path.normalize(absolute) === path.normalize(relative)`, which never matched, so the
// same-file guard missed and the generated file imported itself. `path.resolve` reconciles this
// against cwd, so `path.resolve(cwd, relGeneratedDir)` === the absolute `generatedDir`.
const relGeneratedDir = path.relative(process.cwd(), generatedDir);

const groups: IocGroupsConfig = {
  sweepTasks: { kind: "collection", baseType: "SweepTask" },
  workerTasks: { kind: "collection", baseType: "WorkerTask" },
};

const makeProgram = (): ts.Program =>
  ts.createProgram({
    rootNames: [contractsPath, registryTypesPath, factoriesPath],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });

const emitCtxForFile = (
  program: ts.Program,
  sourceFile: ts.SourceFile,
  gd: string = generatedDir,
): {
  program: ts.Program;
  projectRoot: string;
  scanDirs: typeof scanDirs;
  generatedDir: string;
  contextSourceFile: ts.SourceFile;
} => ({
  program,
  projectRoot,
  scanDirs,
  generatedDir: gd,
  contextSourceFile: sourceFile,
});

const depPropertyType = (
  program: ts.Program,
  exportName: string,
  propName: string,
): ts.Type => {
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(factoriesPath)!;
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
  const paramType = checker.getTypeAtLocation(param);
  const prop = checker
    .getPropertiesOfType(checker.getApparentType(paramType))
    .find((p) => p.getName() === propName)!;
  return checker.getTypeOfSymbol(prop);
};

const buildTypesSource = (
  gd: string = generatedDir,
  withRegistryTypesBuildContext = false,
): { typesSource: string; warnings: string[] } => {
  const program = makeProgram();
  const config = { discovery: { scanDirs: "." }, groups } as unknown as IocConfig;
  const { contractMap, acceptedFactories } = discoverFactories(
    [factoriesPath],
    program,
    projectRoot,
    "build",
    { projectRoot, scanDirs, generatedDir: gd },
    config,
  );
  const plans = buildRegistrationPlan(contractMap, config);
  const groupResult = buildGroupPlan(groups, plans, {
    program,
    generatedDir: gd,
    scanDirs,
  });
  const demandSupply = analyzeDemandSupply(acceptedFactories, {
    program,
    projectRoot,
    scanDirs,
    generatedDir: gd,
    groupsManifest: groupResult?.manifest,
  });
  const boundedGroupCollectionTypeRefs = buildBoundedGroupCollectionTypeRefs(
    groupResult?.manifest,
    { program, generatedDir: gd, scanDirs, projectRoot },
  );

  const warnings: string[] = [];
  const prevWarn = console.warn;
  console.warn = (msg: unknown) => {
    warnings.push(String(msg));
  };
  try {
    const { typesSource } = buildManifestArtifactSources(
      acceptedFactories,
      plans,
      groupResult?.manifest,
      path.join(gd, "ioc-manifest.ts"),
      "ioc-manifest",
      {
        demandSupply,
        boundedGroupCollectionTypeRefs,
        ...(withRegistryTypesBuildContext
          ? {
              registryTypesBuildContext: {
                program,
                generatedDir: gd,
                scanDirs,
                projectRoot,
              },
            }
          : {}),
      },
    );
    return { typesSource, warnings };
  } finally {
    console.warn = prevWarn;
  }
};

/** Type-check a generated `ioc-registry.types.ts` source string in isolation. */
const typecheckGeneratedSource = (source: string): readonly ts.Diagnostic[] => {
  // Rewrite `../contracts.js` to an absolute specifier so the standalone file resolves the fixture.
  const rewritten = source.replace(
    /from "\.\.\/contracts\.js"/g,
    `from ${JSON.stringify(contractsPath.replace(/\.ts$/, ".js"))}`,
  );
  const virtualPath = path.join(generatedDir, "__typecheck-probe.ts");
  const host = ts.createCompilerHost({});
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, langVersion, onError, shouldCreate) => {
    if (path.normalize(fileName) === path.normalize(virtualPath)) {
      return ts.createSourceFile(fileName, rewritten, langVersion, true);
    }
    return originalGetSourceFile(fileName, langVersion, onError, shouldCreate);
  };
  const program = ts.createProgram({
    rootNames: [virtualPath],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
    host,
  });
  const probe = program.getSourceFile(virtualPath)!;
  return program.getSemanticDiagnostics(probe);
};

describe("generated group-alias self-import guard", () => {
  describe("When a factory dep resolves to a type declared in the generated output file", () => {
    it("emits the bare local name with no import spec", () => {
      const program = makeProgram();
      const checker = program.getTypeChecker();
      const type = depPropertyType(program, "buildSweepReport", "pendingSweeps");
      const ref = emitTypeReference(
        checker,
        type,
        emitCtxForFile(program, program.getSourceFile(factoriesPath)!),
      );
      assert.ok(ref);
      assert.strictEqual(ref.typeName, "SweepTasks");
      assert.deepStrictEqual(ref.imports, []);
    });
  });

  describe("When a factory imports a group alias from the generated file (warm regen)", () => {
    it("produces no self-import, keeps the alias declaration, and typechecks", () => {
      const { typesSource } = buildTypesSource();

      // No import from the registry-types file into itself.
      assert.doesNotMatch(typesSource, /from ["'][^"']*ioc-registry\.types(\.js)?["']/);
      // The consumed alias is still declared and exported (reserved-name collision is gone).
      assert.match(typesSource, /export type SweepTasks = ReadonlyArray<SweepTask>;/);
      // The property resolves against the local declaration, not an import.
      assert.match(typesSource, /pendingSweeps:\s*SweepTasks;/);

      // The generated file typechecks (no TS2303/TS2304/TS2459).
      const diagnostics = typecheckGeneratedSource(typesSource);
      const messages = diagnostics.map((d) =>
        ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      );
      assert.deepStrictEqual(messages, [], messages.join("\n"));
    });
  });

  describe("When a group's alias is not imported anywhere (regression control)", () => {
    it("declares the alias inline with no self-import and no collision warning", () => {
      const { typesSource, warnings } = buildTypesSource();

      assert.match(typesSource, /export type WorkerTasks = ReadonlyArray<WorkerTask>;/);
      assert.match(typesSource, /workerTasks:\s*ReadonlyArray<WorkerTask>;/);
      assert.ok(
        !warnings.some((w) => /workerTasks/i.test(w) && /collide/i.test(w)),
        `unexpected collision warning: ${warnings.join("\n")}`,
      );
    });
  });

  // REGRESSION: 2.3.1 shipped because every fixture used an ABSOLUTE generatedDir. A composed run
  // passes a project-relative generatedDir, and the old `path.normalize`-based guard never matched
  // absolute-vs-relative, so the file imported itself. These cases pin the relative path down.
  describe("When generatedDir is project-relative (composed run)", () => {
    it("emits the bare local name with no import spec (direct emit)", () => {
      const program = makeProgram();
      const checker = program.getTypeChecker();
      const type = depPropertyType(program, "buildSweepReport", "pendingSweeps");
      const ref = emitTypeReference(
        checker,
        type,
        emitCtxForFile(
          program,
          program.getSourceFile(factoriesPath)!,
          relGeneratedDir,
        ),
      );
      assert.ok(ref);
      assert.strictEqual(ref.typeName, "SweepTasks");
      assert.deepStrictEqual(ref.imports, []);
    });

    it("produces no self-import, keeps the alias declaration, and typechecks", () => {
      const { typesSource } = buildTypesSource(relGeneratedDir);

      assert.doesNotMatch(typesSource, /from ["'][^"']*ioc-registry\.types(\.js)?["']/);
      assert.match(typesSource, /export type SweepTasks = ReadonlyArray<SweepTask>;/);
      assert.match(typesSource, /pendingSweeps:\s*SweepTasks;/);

      const diagnostics = typecheckGeneratedSource(typesSource);
      const messages = diagnostics.map((d) =>
        ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      );
      assert.deepStrictEqual(messages, [], messages.join("\n"));
    });
  });

  // Composed-run codegen path (registryTypesBuildContext supplied): enabling it activates the
  // contract-import resolution branch AND the Fix B self-import exclusion in reservedTopLevelNames
  // seeding. Confirms the full composed path emits correct output under both path shapes.
  describe("When registryTypesBuildContext is supplied (composed run)", () => {
    it("keeps the alias declaration and emits no self-import (absolute generatedDir)", () => {
      const { typesSource } = buildTypesSource(generatedDir, true);

      assert.doesNotMatch(typesSource, /from ["'][^"']*ioc-registry\.types(\.js)?["']/);
      assert.match(typesSource, /export type SweepTasks = ReadonlyArray<SweepTask>;/);
      assert.match(typesSource, /pendingSweeps:\s*SweepTasks;/);

      const diagnostics = typecheckGeneratedSource(typesSource);
      const messages = diagnostics.map((d) =>
        ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      );
      assert.deepStrictEqual(messages, [], messages.join("\n"));
    });

    it("keeps the alias declaration and emits no self-import (relative generatedDir)", () => {
      const { typesSource } = buildTypesSource(relGeneratedDir, true);

      assert.doesNotMatch(typesSource, /from ["'][^"']*ioc-registry\.types(\.js)?["']/);
      assert.match(typesSource, /export type SweepTasks = ReadonlyArray<SweepTask>;/);
      assert.match(typesSource, /pendingSweeps:\s*SweepTasks;/);

      const diagnostics = typecheckGeneratedSource(typesSource);
      const messages = diagnostics.map((d) =>
        ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      );
      assert.deepStrictEqual(messages, [], messages.join("\n"));
    });
  });
});
