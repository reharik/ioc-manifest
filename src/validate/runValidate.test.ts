import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { IocConfig } from "../config/iocConfig.js";
import {
  manifestSource,
  typesSource,
} from "../test-support/manifestFixtures.js";
import {
  LIBRARY_MODE_VALIDATE_MESSAGE,
  printValidateResult,
  runValidate,
} from "./runValidate.js";

describe("runValidate", () => {
  describe("When the config is library mode", () => {
    it("should return library-mode without loading manifests", async () => {
      const config = {
        discovery: { scanDirs: "src", generatedDir: "src/generated" },
      } as IocConfig;

      const result = await runValidate({
        projectRoot: "/tmp",
        configPath: "/tmp/ioc.config.ts",
        config,
        json: false,
      });

      assert.deepEqual(result, { kind: "library-mode" });
      assert.strictEqual(printValidateResult(result, false), 0);
    });
  });

  describe("When composed package manifest files are missing", () => {
    it("should return a load-error result", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-validate-load-"));
      const pkgDir = path.join(root, "node_modules", "@test", "missing");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "host", type: "module" }),
      );
      writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({
          name: "@test/missing",
          exports: { "./iocManifest": "./ioc-manifest.ts" },
        }),
      );

      mkdirSync(path.join(root, "src", "generated"), { recursive: true });
      writeFileSync(
        path.join(root, "src", "generated", "ioc-manifest.ts"),
        manifestSource(`Local: { l: { registrationKey: "l" } }`),
      );
      writeFileSync(
        path.join(root, "src", "generated", "ioc-registry.types.ts"),
        typesSource("l: string", ""),
      );
      writeFileSync(
        path.join(root, "src", "ioc.config.ts"),
        `export default { discovery: { scanDirs: "src", generatedDir: "src/generated" }, composedManifests: ["@test/missing"] };`,
      );

      const config = {
        discovery: { scanDirs: "src", generatedDir: "src/generated" },
        composedManifests: ["@test/missing"],
      } as IocConfig;

      const result = await runValidate({
        projectRoot: root,
        configPath: path.join(root, "src", "ioc.config.ts"),
        config,
        json: false,
      });

      assert.strictEqual(result.kind, "load-error");
      if (result.kind === "load-error") {
        assert.match(result.message, /@test\/missing/);
      }
      assert.strictEqual(printValidateResult(result, false), 1);
    });
  });

  describe("When app manifests are valid on disk", () => {
    it("should return a passing report", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-validate-ok-"));
      const libDir = path.join(root, "node_modules", "@test", "lib");
      mkdirSync(libDir, { recursive: true });
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "host", type: "module" }),
      );
      writeFileSync(
        path.join(libDir, "package.json"),
        JSON.stringify({
          name: "@test/lib",
          exports: {
            "./iocManifest": "./ioc-manifest.ts",
            "./iocTypes": "./ioc-registry.types.ts",
          },
        }),
      );
      writeFileSync(
        path.join(libDir, "ioc-manifest.ts"),
        manifestSource(`Storage: { s: { registrationKey: "storage" } }`),
      );
      writeFileSync(
        path.join(libDir, "ioc-registry.types.ts"),
        typesSource("storage: unknown", ""),
      );

      mkdirSync(path.join(root, "src", "generated"), { recursive: true });
      writeFileSync(
        path.join(root, "src", "generated", "ioc-manifest.ts"),
        manifestSource(`App: { a: { registrationKey: "app" } }`),
      );
      writeFileSync(
        path.join(root, "src", "generated", "ioc-registry.types.ts"),
        typesSource("app: string; storage: unknown", ""),
      );

      const config = {
        discovery: { scanDirs: "src", generatedDir: "src/generated" },
        composedManifests: ["@test/lib"],
      } as IocConfig;

      const result = await runValidate({
        projectRoot: root,
        configPath: path.join(root, "src", "ioc.config.ts"),
        config,
        json: false,
      });

      assert.strictEqual(result.kind, "report");
      if (result.kind === "report") {
        assert.strictEqual(result.report.errorCount, 0);
      }
    });
  });
});

describe("LIBRARY_MODE_VALIDATE_MESSAGE", () => {
  describe("When printed for library mode", () => {
    it("should mention inspect", () => {
      assert.match(LIBRARY_MODE_VALIDATE_MESSAGE, /inspect/);
    });
  });
});
