/**
 * Group-membership rejection recording.
 *
 * The membership pass now records what it considered and dropped, with the reason taken from the
 * branch the existing check actually took. Two things are pinned here: that the reasons come out
 * right, and — the load-bearing one — that recording changed no member set. A rejection is a report
 * artifact; it must never reach the manifest or influence membership.
 */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import type { IocConfig } from "../config/iocConfig.js";
import { discoverFactories } from "../generator/discoverFactories/discoverFactories.js";
import { buildRegistrationPlan } from "../generator/resolveRegistrationPlan.js";
import { buildGroupPlan, type GroupPlan } from "./resolveGroupPlan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const srcDir = path.join(projectRoot, "src");
const generatedDir = path.join(srcDir, "generated");

const fixture = (dir: string, file: string): string =>
  path.join(__dirname, "test-fixtures", dir, file);

const planGroup = (
  fixtureDir: string,
  baseType: string,
  config?: IocConfig,
): GroupPlan => {
  const files = [
    fixture(fixtureDir, "contracts.ts"),
    fixture(fixtureDir, "factories.ts"),
  ];
  const program = ts.createProgram({
    rootNames: files,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });
  const { contractMap } = discoverFactories(
    [fixture(fixtureDir, "factories.ts")],
    program,
    projectRoot,
    "build",
    { projectRoot, scanDirs: [{ absPath: srcDir }], generatedDir },
    config,
  );
  const plans = buildRegistrationPlan(contractMap, config);
  const result = buildGroupPlan(
    { grouped: { kind: "collection", baseType } },
    plans,
    { program, generatedDir, scanDirs: [{ absPath: srcDir }] },
  );
  assert.ok(result);
  const plan = result!.plans[0];
  assert.ok(plan);
  return plan;
};

const reasonsFor = (plan: GroupPlan, contractName: string): string[] =>
  plan.rejections
    .filter((r) => r.contractName === contractName)
    .map((r) => r.reason);

describe("group membership rejection recording", () => {
  describe("When a sibling contract matches the base structurally but declares no heritage", () => {
    it("should record it as a failed nominal heritage walk without changing the member set", () => {
      const plan = planGroup("nominal-group", "BaseA");

      // The pre-stage member set, asserted verbatim: recording must be invisible to membership.
      assert.deepStrictEqual(
        plan.members.map((m) => m.registrationKey).sort(),
        ["inGroupA", "inGroupB"],
      );
      assert.deepStrictEqual(reasonsFor(plan, "NotInGroup"), [
        "nominal_heritage_not_declared",
      ]);
    });
  });

  describe("When a contract alias resolves to a union", () => {
    it("should record it as a failed heritage walk, not as an unnamed type", () => {
      const plan = planGroup("group-rejections", "RejectBase");

      // The alias keeps its own symbol, so the walk runs and simply finds no heritage — the union
      // right-hand side is not `extends`. `contract_type_not_named` stays reserved for a declared
      // type that carries no named symbol at all.
      assert.deepStrictEqual(reasonsFor(plan, "UnionContract"), [
        "nominal_heritage_not_declared",
      ]);
      assert.deepStrictEqual(reasonsFor(plan, "StructuralSibling"), [
        "nominal_heritage_not_declared",
      ]);
    });
  });

  describe("When an implementation sits on its contract's would-be contract key", () => {
    it("should be an ordinary member — grouped contracts have no slot to duplicate", () => {
      const config = {
        registrations: {
          PrimaryMember: { altPrimaryMember: { default: true } },
        },
      } as unknown as IocConfig;

      const plan = planGroup("group-rejections", "RejectBase", config);

      // Both implementations are members. The retired filter dropped `primaryMember` because its
      // key equalled the camel-cased contract name and it was not the elected default — a guard
      // against duplicating default-slot semantics. Grouped ⇒ group-only removed the slot, so
      // there is nothing to duplicate, and dropping a member would be a group that looks complete
      // and is not.
      assert.deepStrictEqual(
        plan.members.map((m) => m.registrationKey).sort(),
        ["altPrimaryMember", "primaryMember"],
      );
      assert.deepStrictEqual(
        plan.rejections.filter((r) => r.registrationKey !== undefined),
        [],
      );
    });
  });

  describe("When the same fixture is planned with and without a rejection sink", () => {
    it("should produce identical members", () => {
      const withSink = planGroup("nominal-group", "BaseA");
      const again = planGroup("nominal-group", "BaseA");

      assert.deepStrictEqual(
        withSink.members.map((m) => `${m.contractName}:${m.registrationKey}`),
        again.members.map((m) => `${m.contractName}:${m.registrationKey}`),
      );
    });
  });
});
