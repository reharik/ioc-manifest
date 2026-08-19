/**
 * Scope-root registration units, stage 1: DISCOVERY ONLY.
 *
 * Pins the marker-unwrap at the contract site (`ScopeRoot<TContract, TLbv>`, read the same way
 * `Promise<T>` is read), the variant set formed by factory identity, the wrong-arity hard error,
 * the captured-but-unresolved lbv type node, and — the load-bearing boundary for this stage — that
 * a scope root reaches no manifest: not the contract map, not `acceptedFactories`, not the
 * registration plan.
 *
 * Nothing here verifies the declared lbv (stage 2) or emits a builder (stage 3).
 */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { discoverFactories } from "./discoverFactories.js";
import { buildRegistrationPlan } from "../resolveRegistrationPlan.js";
import {
  buildDiscoveryReport,
  formatDiscoveryReport,
} from "../../inspection/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "..", "test-fixtures", "scope-roots");
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

const fixture = (name: string): string => path.join(fixtureDir, name);

const discover = (files: string[], collectFileRecords = false) => {
  const program = ts.createProgram({
    rootNames: files,
    options: compilerOptions,
  });
  return discoverFactories(
    files,
    program,
    projectRoot,
    "build",
    { projectRoot, scanDirs: [{ absPath: srcDir }], generatedDir },
    undefined,
    collectFileRecords ? { collectFileRecords: true } : undefined,
  );
};

const routerFixtures = (): string[] => [
  fixture("contracts.ts"),
  fixture("routers.ts"),
];

describe("scope-root registration units (stage 1: discovery)", () => {
  describe("When a factory returns ScopeRoot<C, Lbv>", () => {
    it("should discover it as a scope root whose contract is C", () => {
      const { scopeRoots } = discover(routerFixtures());

      const auth = scopeRoots.find((r) => r.exportName === "buildAuthRouter");
      assert.ok(auth);
      assert.strictEqual(auth.isScopeRoot, true);
      assert.strictEqual(auth.contractName, "IRouter");
      assert.ok(auth.contractDeclAbsPath.endsWith("contracts.ts"));
      assert.strictEqual(auth.variantName, "authRouter");
      assert.strictEqual(auth.unitKind, "factory");
    });

    it("should record the lifetime as scoped", () => {
      const { scopeRoots } = discover(routerFixtures());

      for (const root of scopeRoots) {
        assert.strictEqual(root.lifetime, "scoped");
      }
    });

    it("should read the marker through a Promise wrapper, like any other contract site", () => {
      const { scopeRoots } = discover(routerFixtures());

      const worker = scopeRoots.find(
        (r) => r.exportName === "buildWorkerRouter",
      );
      assert.ok(worker);
      assert.strictEqual(worker.contractName, "IRouter");
    });
  });

  describe("When several factories return ScopeRoot of the same contract", () => {
    it("should record them as variants of one scope root, keyed by factory identity", () => {
      const { scopeRoots } = discover(routerFixtures());

      const forRouter = scopeRoots.filter((r) => r.contractName === "IRouter");
      assert.strictEqual(forRouter.length, 3);
      assert.deepStrictEqual(
        forRouter.map((r) => r.variantName).sort(),
        ["authRouter", "publicRouter", "workerRouter"],
      );
      // The variant is the factory identity — module path + export name — never a type parameter.
      assert.deepStrictEqual(
        forRouter.map((r) => r.exportName).sort(),
        ["buildAuthRouter", "buildPublicRouter", "buildWorkerRouter"],
      );
      for (const variant of forRouter) {
        assert.ok(variant.modulePath.endsWith("routers.ts"));
      }
    });

    it("should keep each variant's own declared lbv set", () => {
      const { scopeRoots } = discover(routerFixtures());

      const byVariant = new Map(
        scopeRoots.map((r) => [r.variantName, r.lbvTypeText]),
      );
      assert.strictEqual(byVariant.get("authRouter"), "{ viewerId: string }");
      assert.strictEqual(
        byVariant.get("publicRouter"),
        "{ publicLinkId: string }",
      );
      assert.strictEqual(
        byVariant.get("workerRouter"),
        "{ viewerId: ViewerId; uow: UnitOfWork }",
      );
    });
  });

  describe("When the declared lbv type is captured", () => {
    it("should keep it as an unresolved type node, exactly as written", () => {
      const { scopeRoots } = discover(routerFixtures());

      const worker = scopeRoots.find((r) => r.variantName === "workerRouter");
      assert.ok(worker);

      // Captured as a raw AST node: no checker resolution, no normalization, no verification.
      assert.ok(ts.isTypeNode(worker.lbvTypeNode));
      assert.ok(ts.isTypeLiteralNode(worker.lbvTypeNode));
      assert.strictEqual(worker.lbvTypeNode.getText(), worker.lbvTypeText);

      // The member types are still the written names — `ViewerId` was not followed to `string`.
      const memberTypes = worker.lbvTypeNode.members.map((m) =>
        ts.isPropertySignature(m) ? (m.type?.getText() ?? "") : "",
      );
      assert.deepStrictEqual(memberTypes, ["ViewerId", "UnitOfWork"]);
    });
  });

  describe("When ScopeRoot is written with the wrong number of type arguments", () => {
    it("should throw a hard error naming the offender and the expected form", () => {
      assert.throws(
        () => discover([fixture("contracts.ts"), fixture("wrong-arity.ts")]),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /wrong number of type arguments/);
          assert.match(message, /ScopeRoot<TContract, TLbv>/);
          assert.match(message, /"buildBrokenRouter"/);
          assert.match(message, /wrong-arity\.ts/);
          assert.match(message, /declared, never inferred/);
          return true;
        },
      );
    });
  });

  describe("When an ordinary factory sits alongside scope roots", () => {
    it("should discover it unchanged and keep it out of the scope-root set", () => {
      const { acceptedFactories, contractMap, scopeRoots } =
        discover(routerFixtures());

      const clock = acceptedFactories.find(
        (f) => f.exportName === "buildSystemClock",
      );
      assert.ok(clock);
      assert.strictEqual(clock.contractName, "Clock");
      assert.strictEqual(clock.registrationKey, "systemClock");
      assert.strictEqual(clock.implementationName, "systemClock");
      assert.ok(contractMap.get("Clock")?.has("systemClock"));

      assert.ok(!scopeRoots.some((r) => r.exportName === "buildSystemClock"));
    });
  });

  describe("When stage-1 discovery finishes", () => {
    it("should keep scope roots out of the contract map, accepted factories and plan", () => {
      const { acceptedFactories, contractMap, scopeRoots } =
        discover(routerFixtures());

      assert.strictEqual(scopeRoots.length, 3);
      // The stage-1 boundary: discovered and reported, never manifest-emitted. A scope root claims
      // no cradle key, so it must reach neither the contract map nor the registration plan.
      assert.strictEqual(contractMap.has("IRouter"), false);
      assert.ok(
        !acceptedFactories.some((f) => f.contractName === "IRouter"),
      );

      const plan = buildRegistrationPlan(contractMap);
      assert.deepStrictEqual(
        plan.map((c) => c.contractName),
        ["Clock"],
      );
    });
  });

  describe("When the discovery report is built (ioc inspect --discovery)", () => {
    it("should categorize each scope-root export and list the variants per root contract", () => {
      const { discoveryFiles, scopeRoots } = discover(routerFixtures(), true);

      const report = buildDiscoveryReport({ discoveryFiles, scopeRoots });

      const rows = report.files.flatMap((f) => f.rows);
      const authRow = rows.find((r) => r.exportName === "buildAuthRouter");
      assert.ok(authRow);
      assert.strictEqual(authRow.status, "discovered");
      assert.strictEqual(authRow.isScopeRoot, true);
      assert.strictEqual(authRow.contractName, "IRouter");
      assert.strictEqual(authRow.declaredLbv, "{ viewerId: string }");

      const clockRow = rows.find((r) => r.exportName === "buildSystemClock");
      assert.ok(clockRow);
      assert.strictEqual(clockRow.isScopeRoot, undefined);

      assert.strictEqual(report.scopeRoots.length, 1);
      const root = report.scopeRoots[0]!;
      assert.strictEqual(root.contractName, "IRouter");
      assert.strictEqual(root.lifetime, "scoped");
      assert.deepStrictEqual(
        root.variants.map((v) => v.variantName),
        ["authRouter", "publicRouter", "workerRouter"],
      );

      const text = formatDiscoveryReport(report, { color: false });
      assert.match(text, /Scope roots:/);
      assert.match(text, /IRouter \(lifetime: scoped; not manifest-emitted/);
      assert.match(text, /unit: scope-root/);
      assert.match(text, /root contract: IRouter/);
      assert.match(text, /declared lbv: \{ viewerId: string \}/);
      assert.match(text, /variant: authRouter/);
      // The ordinary factory still reports as an ordinary registration.
      assert.match(text, /registrationKey: systemClock/);
    });

    it("should report no scope roots when the input carries none", () => {
      const { discoveryFiles, scopeRoots } = discover(
        [fixture("contracts.ts")],
        true,
      );

      const report = buildDiscoveryReport({ discoveryFiles, scopeRoots });
      assert.deepStrictEqual(report.scopeRoots, []);
      assert.ok(!formatDiscoveryReport(report, { color: false }).includes("Scope roots:"));
    });
  });
});
