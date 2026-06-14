import assert from "node:assert";
import { describe, it } from "node:test";
import { asValue, createContainer } from "awilix";
import type { IocContractManifest, IocModuleNamespace } from "../core/manifest.js";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";
import { registerIocFromManifest } from "./bootstrap.js";
import { isIocResolutionError } from "./iocResolutionError.js";

describe("registerIocFromManifest — scope-provided dependency safety", () => {
  const manifest: IocContractManifest = {
    ViewerReadService: {
      viewerReadService: {
        exportName: "buildViewerReadService",
        registrationKey: "viewerReadService",
        modulePath: "viewerReadService.ts",
        relImport: "../viewerReadService.js",
        contractName: "ViewerReadService",
        implementationName: "viewerReadService",
        lifetime: "scoped",
        moduleIndex: 0,
        default: true,
      },
    },
  };
  const moduleImports: readonly IocModuleNamespace[] = [
    {
      buildViewerReadService: ({ viewerId }: { viewerId: string }) => ({
        whoami: () => viewerId,
      }),
    },
  ];

  const build = () => {
    const root = createContainer({ injectionMode: "PROXY" });
    registerIocFromManifest(root, [
      {
        manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
        contracts: manifest,
        moduleImports,
      },
    ]);
    return root;
  };

  describe("When scope-provided keys are declared", () => {
    it("should never register the scope-provided key at root", () => {
      const root = build();
      assert.strictEqual(root.hasRegistration("viewerId"), false);
    });
  });

  describe("When the scoped service is resolved at root without the scope value", () => {
    it("should throw an ioc resolution error", () => {
      const root = build();
      try {
        root.resolve("viewerReadService");
        assert.fail("expected resolution to throw — viewerId is not registered at root");
      } catch (error) {
        assert.ok(isIocResolutionError(error), "expected an ioc resolution error");
      }
    });
  });

  describe("When a child scope registers the scope-provided value", () => {
    it("should resolve the scoped service correctly", () => {
      const root = build();
      const scope = root.createScope();
      scope.register({ viewerId: asValue("u-123") });
      const svc = scope.resolve("viewerReadService") as { whoami: () => string };
      assert.strictEqual(svc.whoami(), "u-123");
    });
  });
});
