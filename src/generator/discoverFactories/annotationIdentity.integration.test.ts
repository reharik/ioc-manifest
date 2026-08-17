/**
 * v3 annotation-based contract identity (stage 1): the contract is the factory's written return
 * type annotation, resolved syntactically to its declaration. Pins the newly legal forms (plain
 * aliases, named union aliases), import-alias resolution, Promise unwrapping, the aggregated
 * invalid-annotation errors, same-name collision detection, and the lint-autofix scenario
 * (`interface Foo extends Base {}` → `type Foo = Base` keeps identical contract behavior).
 */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { discoverFactories } from "./discoverFactories.js";
import { buildRegistrationPlan } from "../resolveRegistrationPlan.js";
import { buildGroupPlan } from "../../groups/resolveGroupPlan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(
  __dirname,
  "..",
  "test-fixtures",
  "annotation-identity",
);
const projectRoot = path.resolve(fixtureDir, "../../../..");
const srcDir = path.join(projectRoot, "src");
const generatedDir = path.join(srcDir, "generated");

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
};

const makeProgram = (rootFiles: string[]): ts.Program =>
  ts.createProgram({ rootNames: rootFiles, options: compilerOptions });

const fixture = (name: string): string => path.join(fixtureDir, name);

const discover = (files: string[]) => {
  const program = makeProgram(files);
  const result = discoverFactories(files, program, projectRoot, "build", {
    projectRoot,
    scanDirs: [{ absPath: srcDir }],
    generatedDir,
  });
  return { program, ...result };
};

describe("annotation-based contract identity (v3)", () => {
  describe("When a factory is annotated with a plain type alias of a base", () => {
    it("should treat the alias as a distinct contract, never collapsed to its target", () => {
      const { acceptedFactories } = discover([
        fixture("contracts.ts"),
        fixture("factories.ts"),
      ]);

      const f = acceptedFactories.find((x) => x.exportName === "buildQueueTask");
      assert.ok(f);
      assert.strictEqual(f.contractName, "QueueTask");
      assert.notStrictEqual(f.contractName, "WorkerTaskBase");
      assert.ok(f.contractDeclAbsPath?.endsWith("contracts.ts"));
    });
  });

  describe("When a factory is annotated with a named union alias", () => {
    it("should discover it as a first-class contract", () => {
      const { acceptedFactories } = discover([
        fixture("contracts.ts"),
        fixture("factories.ts"),
      ]);

      const f = acceptedFactories.find(
        (x) => x.exportName === "buildTaskDecision",
      );
      assert.ok(f);
      assert.strictEqual(f.contractName, "TaskDecision");
    });
  });

  describe("When the annotation is an import-aliased name", () => {
    it("should resolve to the same contract as a direct import of the declaration", () => {
      const { acceptedFactories, contractMap } = discover([
        fixture("contracts.ts"),
        fixture("factories.ts"),
        fixture("aliased-import-factory.ts"),
      ]);

      const aliased = acceptedFactories.find(
        (x) => x.exportName === "buildAliasedQueueTask",
      );
      const direct = acceptedFactories.find(
        (x) => x.exportName === "buildQueueTask",
      );
      assert.ok(aliased);
      assert.ok(direct);
      assert.strictEqual(aliased.contractName, "QueueTask");
      assert.strictEqual(
        aliased.contractDeclAbsPath,
        direct.contractDeclAbsPath,
      );

      const impls = contractMap.get("QueueTask");
      assert.ok(impls);
      assert.deepStrictEqual(
        Array.from(impls.keys()).sort(),
        ["aliasedQueueTask", "queueTask"],
      );
    });
  });

  describe("When a factory returns Promise<T>", () => {
    it("should unwrap the Promise and identify the contract as T", () => {
      const { acceptedFactories } = discover([
        fixture("contracts.ts"),
        fixture("async-factory.ts"),
      ]);

      const f = acceptedFactories.find(
        (x) => x.exportName === "buildAsyncQueueTask",
      );
      assert.ok(f);
      assert.strictEqual(f.contractName, "QueueTask");
    });
  });

  describe("When group membership is computed from annotation identity", () => {
    it("should include alias-of-base and empty-extends contracts, and exclude union aliases", () => {
      const files = [
        fixture("contracts.ts"),
        fixture("factories.ts"),
        fixture("aliased-import-factory.ts"),
      ];
      const program = makeProgram(files);
      const { contractMap } = discoverFactories(
        files,
        program,
        projectRoot,
        "build",
        {
          projectRoot,
          scanDirs: [{ absPath: srcDir }],
          generatedDir,
        },
      );

      const plans = buildRegistrationPlan(contractMap);
      const groupResult = buildGroupPlan(
        { tasks: { kind: "collection", baseType: "WorkerTaskBase" } },
        plans,
        { program, generatedDir, scanDirs: [{ absPath: srcDir }] },
      );

      assert.ok(groupResult);
      const plan = groupResult.plans.find((p) => p.groupName === "tasks");
      assert.ok(plan && plan.kind === "collection");

      const memberContracts = new Set(
        plan.members.map((m) => m.contractName),
      );
      // Lint-autofix pin: the alias form (`type QueueTask = WorkerTaskBase`) and the v2
      // empty-extends form behave identically — both are group members via nominal heritage.
      assert.ok(memberContracts.has("QueueTask"));
      assert.ok(memberContracts.has("EmptyExtendsTask"));
      // Named union aliases have no heritage: valid contract, member of no groups.
      assert.ok(!memberContracts.has("TaskDecision"));

      const memberKeys = plan.members
        .map((m) => m.registrationKey)
        .sort((a, b) => a.localeCompare(b));
      assert.deepStrictEqual(memberKeys, [
        "aliasedQueueTask",
        "emptyExtendsTask",
        "queueTask",
      ]);
    });
  });

  describe("When prefix-matched factories lack a return type annotation", () => {
    it("should throw one aggregated error listing every offender", () => {
      assert.throws(
        () => discover([fixture("missing-annotation-factories.ts")]),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(
            message,
            /2 factory export\(s\) have missing or invalid return type annotations/,
          );
          assert.match(message, /explicit return type annotation naming its contract/);
          assert.match(message, /"buildNoAnnotationOne"/);
          assert.match(message, /"buildNoAnnotationTwo"/);
          assert.match(message, /missing-annotation-factories\.ts/);
          return true;
        },
      );
    });
  });

  describe("When a factory annotation is an inline object literal", () => {
    it("should throw with guidance to declare a named type", () => {
      assert.throws(
        () => discover([fixture("inline-object-factory.ts")]),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /"buildInlineObject"/);
          assert.match(message, /inline object literal annotation/);
          assert.match(message, /contract must be a named type/);
          return true;
        },
      );
    });
  });

  describe("When two different declarations share a contract name", () => {
    it("should throw a hard aggregated error naming both declaration sites", () => {
      assert.throws(
        () => discover([fixture("collision-a.ts"), fixture("collision-b.ts")]),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /Contract name collision/);
          assert.match(message, /"DupContract"/);
          assert.match(message, /collision-a\.ts/);
          assert.match(message, /collision-b\.ts/);
          assert.match(message, /"buildDupA"/);
          assert.match(message, /"buildDupB"/);
          return true;
        },
      );
    });
  });
});
