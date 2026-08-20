/**
 * Runtime half of scope-roots stage 3: what an emitted opener actually does.
 *
 * A scope is a container. The opener is the generated equivalent of composition for the Nth
 * container — it creates the child scope, registers the declared late-bound values on it, resolves
 * the variant eagerly, and hands back a disposer. Nothing here reads generated files: the manifest
 * rows are written by hand so the behaviour under test is the runtime's, not the generator's.
 */
import assert from "node:assert";
import { describe, it } from "node:test";
import { asValue, createContainer, type AwilixContainer } from "awilix";
import type {
  IocModuleNamespace,
  IocRegisterableManifest,
} from "../core/manifest.js";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";
import { registerIocFromManifest } from "./bootstrap.js";
import { isIocResolutionError } from "./iocResolutionError.js";

type Viewer = { id: string };
type RequestReport = { render: () => string; viewer: Viewer };
type OpenedReportScope = {
  requestReport: RequestReport;
  dispose: () => Promise<void>;
};
type OpenReportScope = (lbv: { viewer: Viewer }) => OpenedReportScope;

let builds = 0;

const moduleImports: readonly IocModuleNamespace[] = [
  {
    buildAuditLog: () => ({ record: (event: string) => event }),
    buildRequestReport: ({
      viewer,
      auditLog,
      label,
    }: {
      viewer: Viewer;
      auditLog: { record: (event: string) => string };
      label: string;
    }): RequestReport => {
      builds += 1;
      return {
        viewer,
        render: () => `${label}:${auditLog.record(viewer.id)}`,
      };
    },
    buildThrowingReport: (): RequestReport => {
      throw new Error("variant construction failed");
    },
  },
];

const manifest = (
  overrides?: Partial<IocRegisterableManifest>,
): IocRegisterableManifest => ({
  manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
  moduleImports,
  contracts: {
    AuditLog: {
      auditLog: {
        exportName: "buildAuditLog",
        registrationKey: "auditLog",
        modulePath: "auditLog.ts",
        relImport: "../auditLog.js",
        contractName: "AuditLog",
        implementationName: "auditLog",
        lifetime: "singleton",
        moduleIndex: 0,
        default: true,
      },
    },
  },
  scopeRoots: {
    RequestReport: {
      requestReport: {
        exportName: "buildRequestReport",
        openerKey: "openRequestReportScope",
        variantKey: "requestReport",
        contractName: "RequestReport",
        variantName: "requestReport",
        modulePath: "requestReport.ts",
        relImport: "../requestReport.js",
        lbvKeys: ["viewer"],
        moduleIndex: 0,
      },
    },
  },
  ...overrides,
});

const boot = (
  m: IocRegisterableManifest = manifest(),
): AwilixContainer<Record<string, unknown>> => {
  const root = createContainer<Record<string, unknown>>({
    injectionMode: "PROXY",
  });
  registerIocFromManifest(root, [m]);
  /* A container constant the variant reads through the parent chain. Registered on the ROOT so the
     outer-scope test below can shadow it and show which container the child was created from. */
  root.register({ label: asValue("root") });
  return root;
};

/** Records every scope a container opens, so the opener's child scope is observable in a test. */
const spyOnScopes = (
  container: AwilixContainer<Record<string, unknown>>,
): AwilixContainer<Record<string, unknown>>[] => {
  const created: AwilixContainer<Record<string, unknown>>[] = [];
  const original = container.createScope.bind(container);
  (
    container as unknown as { createScope: () => AwilixContainer<object> }
  ).createScope = () => {
    const scope = original() as AwilixContainer<Record<string, unknown>>;
    created.push(scope);
    return scope;
  };
  return created;
};

describe("scope-root openers (runtime)", () => {
  describe("When an opener is resolved from the cradle", () => {
    it("should be registered under its own key and take one lbv argument", () => {
      const root = boot();

      const open = root.cradle.openRequestReportScope as OpenReportScope;
      assert.strictEqual(typeof open, "function");
      assert.strictEqual(open.length, 1);
      // The variant itself claims no cradle key — the opener is the only way in.
      assert.strictEqual(root.hasRegistration("requestReport"), false);
    });

    it("should resolve the variant eagerly and return it under the variant key", () => {
      const root = boot();
      const before = builds;

      const opened = (root.cradle.openRequestReportScope as OpenReportScope)({
        viewer: { id: "u_1" },
      });

      // Eager: the variant exists the moment the opener returns, with no lazy handle to force.
      assert.strictEqual(builds, before + 1);
      assert.strictEqual(opened.requestReport.viewer.id, "u_1");
      assert.strictEqual(opened.requestReport.render(), "root:u_1");
      // One container, one resolve: the return is the variant and a disposer, nothing else.
      assert.deepStrictEqual(Object.keys(opened).sort(), [
        "dispose",
        "requestReport",
      ]);
    });

    it("should give each opening its own scope and its own late-bound values", () => {
      const root = boot();
      const open = root.cradle.openRequestReportScope as OpenReportScope;

      const a = open({ viewer: { id: "u_1" } });
      const b = open({ viewer: { id: "u_2" } });

      assert.strictEqual(a.requestReport.viewer.id, "u_1");
      assert.strictEqual(b.requestReport.viewer.id, "u_2");
      assert.notStrictEqual(a.requestReport, b.requestReport);
    });
  });

  describe("When the opener is resolved from a scope rather than the root", () => {
    it("should create its child scope from the scope that resolved it", () => {
      const root = boot();
      const outer = root.createScope<{ label: string }>();
      outer.register({ label: asValue("outer") });
      const scopes = spyOnScopes(
        outer as unknown as AwilixContainer<Record<string, unknown>>,
      );

      const opened = (outer.cradle.openRequestReportScope as OpenReportScope)({
        viewer: { id: "u_3" },
      });

      // `label` is registered on the OUTER scope and reaches the variant through the parent chain,
      // which is only possible if the child was created from the resolving scope.
      assert.strictEqual(opened.requestReport.render(), "outer:u_3");
      assert.strictEqual(scopes.length, 1);
    });

    it("should keep the container handle out of what the caller receives", () => {
      const root = boot();

      const opened = (root.cradle.openRequestReportScope as OpenReportScope)({
        viewer: { id: "u_4" },
      });

      // The opener is the sanctioned scope-resolver handle: no cradle, no container, no scope.
      for (const value of Object.values(opened)) {
        assert.ok(
          typeof value !== "object" ||
            value === null ||
            !("createScope" in (value as object)),
        );
      }
    });
  });

  describe("When an opened scope is disposed", () => {
    it("should dispose the child scope", async () => {
      const root = boot();
      const scopes = spyOnScopes(root);

      const opened = (root.cradle.openRequestReportScope as OpenReportScope)({
        viewer: { id: "u_5" },
      });
      const scope = scopes[0]!;
      assert.ok(scope.cache.has("requestReport"));

      await opened.dispose();

      // Awilix's dispose runs the scope's disposers and clears its cache; that emptied cache is the
      // observable end of the scope's life.
      assert.strictEqual(scope.cache.size, 0);
    });

    it("should make a second dispose a no-op that still awaits the first", async () => {
      const root = boot();
      const scopes = spyOnScopes(root);

      const opened = (root.cradle.openRequestReportScope as OpenReportScope)({
        viewer: { id: "u_6" },
      });

      let disposeCalls = 0;
      const scope = scopes[0]!;
      const realDispose = scope.dispose.bind(scope);
      (scope as unknown as { dispose: () => Promise<void> }).dispose = () => {
        disposeCalls += 1;
        return realDispose();
      };

      const first = opened.dispose();
      const second = opened.dispose();

      // Same promise handed back, so the second close neither disposes twice nor resolves early.
      assert.strictEqual(first, second);
      await Promise.all([first, second]);
      await opened.dispose();
      assert.strictEqual(disposeCalls, 1);
    });
  });

  describe("When the caller omits a declared late-bound value", () => {
    it("should say which key is missing rather than register undefined", () => {
      const root = boot();
      const open = root.cradle.openRequestReportScope as OpenReportScope;

      assert.throws(
        () => (open as (lbv: unknown) => unknown)({}),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /"viewer" was not supplied/);
          assert.match(message, /openRequestReportScope/);
          assert.match(message, /requires all of them at every call/);
          return true;
        },
      );
    });
  });

  describe("When the variant fails to construct", () => {
    it("should propagate through the instrumented resolution path", () => {
      const root = boot(
        manifest({
          scopeRoots: {
            RequestReport: {
              requestReport: {
                exportName: "buildThrowingReport",
                openerKey: "openRequestReportScope",
                variantKey: "requestReport",
                contractName: "RequestReport",
                variantName: "requestReport",
                modulePath: "requestReport.ts",
                relImport: "../requestReport.js",
                lbvKeys: ["viewer"],
                moduleIndex: 0,
              },
            },
          },
        }),
      );

      assert.throws(
        () =>
          (root.cradle.openRequestReportScope as OpenReportScope)({
            viewer: { id: "u_7" },
          }),
        (error: unknown) => {
          // Routed through `asFunction` like every other unit, so the variant gets the same
          // manifest-aware error the root path gives an ordinary factory.
          assert.ok(isIocResolutionError(error));
          assert.match(error.message, /requestReport/);
          return true;
        },
      );
    });
  });

  describe("When the manifest declares no scope roots", () => {
    it("should register nothing extra", () => {
      const { scopeRoots: _omitted, ...withoutScopeRoots } = manifest();
      const root = boot(withoutScopeRoots as IocRegisterableManifest);

      assert.strictEqual(root.hasRegistration("openRequestReportScope"), false);
      assert.strictEqual(root.hasRegistration("auditLog"), true);
    });
  });
});
