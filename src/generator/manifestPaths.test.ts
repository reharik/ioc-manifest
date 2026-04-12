import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  computeManifestModuleSpecifier,
  emitBarePackageSpecifierFromNodeModulesPath,
  mapTypesPackageToRuntimePackage,
  normalizeEmittedModuleSpecifier,
  resolveWorkspacePackageRoot,
} from "./manifestPaths.js";

describe("computeManifestModuleSpecifier", () => {
  describe("When the file is under a scan dir with importMode root", () => {
    it("should return the import prefix only", () => {
      const projectRoot = path.join(path.sep, "proj", "app");
      const pkgRoot = path.join(projectRoot, "packages", "lib");
      const file = path.join(pkgRoot, "src", "repo.ts");
      const generatedDir = path.join(projectRoot, "generated");
      const scanDirs = [
        {
          absPath: pkgRoot,
          importPrefix: "@acme/lib",
          importMode: "root" as const,
        },
      ];
      assert.strictEqual(
        computeManifestModuleSpecifier(file, generatedDir, scanDirs),
        "@acme/lib",
      );
    });
  });

  describe("When the file is under a scan dir with importMode subpath", () => {
    it("should return prefix plus posix path from scan root without extension plus .js", () => {
      const projectRoot = path.join(path.sep, "proj", "app");
      const pkgRoot = path.join(projectRoot, "packages", "lib");
      const file = path.join(pkgRoot, "src", "repositories", "repo.ts");
      const generatedDir = path.join(projectRoot, "generated");
      const scanDirs = [
        {
          absPath: pkgRoot,
          importPrefix: "@acme/lib",
          importMode: "subpath" as const,
        },
      ];
      assert.strictEqual(
        computeManifestModuleSpecifier(file, generatedDir, scanDirs),
        "@acme/lib/src/repositories/repo.js",
      );
    });
  });

  describe("When the file is only matched by a local scan dir without importPrefix", () => {
    it("should emit a relative specifier from generatedDir", () => {
      const projectRoot = path.join(path.sep, "proj", "app");
      const srcRoot = path.join(projectRoot, "src");
      const file = path.join(srcRoot, "svc", "buildThing.ts");
      const generatedDir = path.join(projectRoot, "src", "generated");
      const scanDirs = [{ absPath: srcRoot }];
      assert.strictEqual(
        computeManifestModuleSpecifier(file, generatedDir, scanDirs),
        "../svc/buildThing.js",
      );
    });
  });

  describe("When the resolved declaration file is under node_modules", () => {
    it("should emit a bare package specifier with no node_modules segment", () => {
      const knexTypes = path.join(
        path.sep,
        "proj",
        "node_modules",
        "knex",
        "types",
        "index.d.ts",
      );
      assert.strictEqual(
        computeManifestModuleSpecifier(knexTypes, path.join(path.sep, "proj", "generated"), []),
        "knex",
      );
    });
  });

  describe("When the file is under @types for a DefinitelyTyped scoped mapping", () => {
    it("should map to the runtime scoped package name", () => {
      const typesPath = path.join(
        path.sep,
        "proj",
        "node_modules",
        "@types",
        "koa__router",
        "index.d.ts",
      );
      assert.strictEqual(
        computeManifestModuleSpecifier(typesPath, path.join(path.sep, "proj", "generated"), []),
        "@koa/router",
      );
    });
  });

  describe("When the declaration path is relative to projectRoot", () => {
    it("should resolve it before workspace matching", () => {
      const projectRoot = path.join(path.sep, "proj", "app");
      const fileRel = path.join("src", "logger", "core.ts");
      const generatedDir = path.join(projectRoot, "generated");
      const workspacePackageImportBases = [
        {
          absRoot: path.join(projectRoot, "src"),
          importBase: "@pkg/logger",
        },
      ];
      assert.strictEqual(
        computeManifestModuleSpecifier(fileRel, generatedDir, [], {
          projectRoot,
          workspacePackageImportBases,
        }),
        "@pkg/logger",
      );
    });
  });

  describe("When the file is under a configured workspacePackageImportBases root", () => {
    it("should emit the configured importBase instead of a long relative path", () => {
      const projectRoot = path.join(path.sep, "proj", "app");
      const file = path.join(
        projectRoot,
        "packages",
        "foundation",
        "infrastructure",
        "src",
        "logger",
        "coreLogger.ts",
      );
      const generatedDir = path.join(projectRoot, "generated");
      const scanDirs = [{ absPath: path.join(projectRoot, "src") }];
      const workspacePackageImportBases = [
        {
          absRoot: path.join(
            projectRoot,
            "packages",
            "foundation",
            "infrastructure",
            "src",
          ),
          importBase: "@packages/foundation/infrastructure",
        },
      ];
      assert.strictEqual(
        computeManifestModuleSpecifier(file, generatedDir, scanDirs, {
          workspacePackageImportBases,
        }),
        "@packages/foundation/infrastructure",
      );
    });
  });

  describe("When a preferred bare module specifier is provided", () => {
    it("should prefer it over deriving from the resolved declaration path", () => {
      const deep = path.join(
        path.sep,
        "proj",
        "node_modules",
        "knex",
        "types",
        "index.d.ts",
      );
      assert.strictEqual(
        computeManifestModuleSpecifier(deep, path.join(path.sep, "proj", "generated"), [], {
          preferredModuleSpecifier: "knex",
        }),
        "knex",
      );
    });

    it("should prefer the consumer import over the @types declaration path", () => {
      const typesPath = path.join(
        path.sep,
        "proj",
        "node_modules",
        "@types",
        "koa__router",
        "index.d.ts",
      );
      assert.strictEqual(
        computeManifestModuleSpecifier(
          typesPath,
          path.join(path.sep, "proj", "generated"),
          [],
          { preferredModuleSpecifier: "@koa/router" },
        ),
        "@koa/router",
      );
    });
  });
});

describe("emitBarePackageSpecifierFromNodeModulesPath", () => {
  describe("When the path points at a nested node_modules package", () => {
    it("should use the innermost owning package name", () => {
      const p = path.join(
        path.sep,
        "app",
        "node_modules",
        "a",
        "node_modules",
        "b",
        "index.js",
      );
      assert.strictEqual(emitBarePackageSpecifierFromNodeModulesPath(p), "b");
    });
  });
});

describe("mapTypesPackageToRuntimePackage", () => {
  describe("When the types package uses the scope__name convention", () => {
    it("should map @types/koa__router to @koa/router", () => {
      assert.strictEqual(
        mapTypesPackageToRuntimePackage("@types/koa__router"),
        "@koa/router",
      );
    });
  });

  describe("When the types package is unscoped", () => {
    it("should map @types/node to node", () => {
      assert.strictEqual(mapTypesPackageToRuntimePackage("@types/node"), "node");
    });
  });
});

describe("resolveWorkspacePackageRoot", () => {
  describe("When projectRoot is an app package inside a monorepo", () => {
    it("should resolve packages/ relative roots against an ancestor directory", () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ioc-ws-"));
      const repoRoot = path.join(tmp, "repo");
      const pkgSrc = path.join(repoRoot, "packages", "shared", "src");
      fs.mkdirSync(pkgSrc, { recursive: true });
      const appRoot = path.join(repoRoot, "apps", "web");
      fs.mkdirSync(appRoot, { recursive: true });
      const resolved = resolveWorkspacePackageRoot(
        appRoot,
        "packages/shared/src",
      );
      assert.strictEqual(path.normalize(resolved), path.normalize(pkgSrc));
    });
  });
});

describe("normalizeEmittedModuleSpecifier", () => {
  describe("When the specifier is a bare single-segment package", () => {
    it("should strip .ts and .js extensions", () => {
      assert.strictEqual(normalizeEmittedModuleSpecifier("knex.js"), "knex");
      assert.strictEqual(normalizeEmittedModuleSpecifier("knex.ts"), "knex");
    });

    it("should strip trailing /index", () => {
      assert.strictEqual(normalizeEmittedModuleSpecifier("pkg/index"), "pkg");
    });
  });

  describe("When the specifier is a relative path", () => {
    it("should collapse /index.js to a sibling .js import", () => {
      assert.strictEqual(
        normalizeEmittedModuleSpecifier("../foo/index.js"),
        "../foo.js",
      );
    });

    it("should strip .d.ts suffixes", () => {
      assert.strictEqual(normalizeEmittedModuleSpecifier("../foo.d.ts"), "../foo");
    });
  });

  describe("When the specifier is a workspace subpath import", () => {
    it("should preserve the .js extension", () => {
      assert.strictEqual(
        normalizeEmittedModuleSpecifier("@acme/lib/src/repositories/repo.js"),
        "@acme/lib/src/repositories/repo.js",
      );
    });
  });
});
