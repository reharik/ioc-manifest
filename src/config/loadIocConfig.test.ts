import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  loadIocConfig,
  resolveIocConfigPath,
  resolveProjectRootFromIocConfigPath,
} from "./loadIocConfig.js";

describe("loadIocConfig", () => {
  describe("When the exported object has an unknown top-level key", () => {
    it("should throw with ioc-config prefix", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-loadcfg-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default { discovery: { scanDirs: "src" }, notAllowed: true };`,
      );
      await assert.rejects(
        () => loadIocConfig(cfg),
        /unknown property .*notAllowed/,
      );
    });
  });

  describe("When discovery has unknown property", () => {
    it("should throw with ioc-config prefix", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-disc-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default { discovery: { scanDirs: "src", typo: 1 } };`,
      );
      await assert.rejects(
        () => loadIocConfig(cfg),
        /discovery.*unknown property .*typo/,
      );
    });
  });

  describe("When discovery sets workspacePackageImportBases", () => {
    it("should throw a v2 removal error", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-ws-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default { discovery: { scanDirs: "src", workspacePackageImportBases: [
          { root: "packages/a", importBase: "@a/a" }
        ] } };`,
      );
      await assert.rejects(
        () => loadIocConfig(cfg),
        /workspacePackageImportBases was removed in v2/,
      );
    });
  });

  describe("When registration override has unknown property", () => {
    it("should throw", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-reg-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default { discovery: { scanDirs: "src" }, registrations: {
          Foo: { bar: { lifetime: "singleton", foo: 1 } }
        } };`,
      );
      await assert.rejects(
        () => loadIocConfig(cfg),
        /unknown property .*foo/,
      );
    });
  });

  describe("When the config is valid minimal shape", () => {
    it("should return discovery settings", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-ok-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default { discovery: { scanDirs: "src" } };`,
      );
      const c = await loadIocConfig(cfg);
      assert.equal(c.discovery.scanDirs, "src");
    });
  });

  describe("When composedManifests includes a duplicate package", () => {
    it("should reject the config", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-dup-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default { discovery: { scanDirs: "src" }, composedManifests: ["@a/pkg", "@a/pkg"] };`,
      );
      await assert.rejects(
        () => loadIocConfig(cfg),
        /composedManifests contains duplicate entry/,
      );
    });
  });

  describe("When composedManifests includes the local package name", () => {
    it("should reject self-composition", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-self-"));
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "@test/app" }),
      );
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default { discovery: { scanDirs: "src" }, composedManifests: ["@test/app"] };`,
      );
      await assert.rejects(
        () => loadIocConfig(cfg),
        /cannot include this package's own name/,
      );
    });
  });

  describe("When manifestExportPath is set in app mode", () => {
    it("should reject the config", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-mep-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default { discovery: { scanDirs: "src" }, composedManifests: ["@a/pkg"], manifestExportPath: "./out" };`,
      );
      await assert.rejects(
        () => loadIocConfig(cfg),
        /manifestExportPath is only valid in library mode/,
      );
    });
  });

  describe("When source is set without composedManifests", () => {
    it("should reject the config", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-src-lib-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default { discovery: { scanDirs: "src" }, registrations: {
          AlbumRepository: { albumRepository: { source: "local" } }
        } };`,
      );
      await assert.rejects(
        () => loadIocConfig(cfg),
        /source.*only valid when composedManifests is set/,
      );
    });
  });

  describe("When source references a package not in composedManifests", () => {
    it("should reject the config", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-src-miss-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default { discovery: { scanDirs: "src" }, composedManifests: ["@a/pkg"],
          registrations: { AlbumRepository: { albumRepository: { source: "@b/other" } } } };`,
      );
      await assert.rejects(
        () => loadIocConfig(cfg),
        /not listed in composedManifests/,
      );
    });
  });

  describe("When package.json has no name and composedManifests is set", () => {
    it("should require packageName in config", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-noname-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default { discovery: { scanDirs: "src" }, composedManifests: ["@a/pkg"] };`,
      );
      await assert.rejects(
        () => loadIocConfig(cfg),
        /Unable to determine local package name/,
      );
    });
  });
});

describe("resolveProjectRootFromIocConfigPath", () => {
  describe("When config lives under src/", () => {
    it("should return the parent of src as the package root", () => {
      const pkg = path.join("/work", "apps", "api");
      const cfg = path.join(pkg, "src", "ioc.config.ts");
      assert.equal(resolveProjectRootFromIocConfigPath(cfg), pkg);
    });
  });

  describe("When config lives at package root", () => {
    it("should return the directory containing the config file", () => {
      const pkg = path.join("/work", "apps", "api");
      const cfg = path.join(pkg, "ioc.config.ts");
      assert.equal(resolveProjectRootFromIocConfigPath(cfg), pkg);
    });
  });
});

describe("resolveIocConfigPath", () => {
  describe("When walking upward from a monorepo root", () => {
    it("should find src/ioc.config.ts in a nested package via downward search", () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-walk-"));
      const appRoot = path.join(root, "apps", "api");
      mkdirSync(path.join(appRoot, "src"), { recursive: true });
      const expected = path.join(appRoot, "src", "ioc.config.ts");
      writeFileSync(expected, "");

      const resolved = resolveIocConfigPath(root);
      assert.equal(resolved, expected);
    });

    it("should throw when several nested src/ioc.config.ts files exist", () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-multi-"));
      for (const seg of ["app-a", "app-b"] as const) {
        const dir = path.join(root, "apps", seg, "src");
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, "ioc.config.ts"), "");
      }
      assert.throws(() => resolveIocConfigPath(root), /Multiple src\/ioc\.config\.ts/);
    });
  });

  describe("When ioc.config.ts sits at package root", () => {
    it("should prefer src/ioc.config.ts when both exist", () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-both-"));
      mkdirSync(path.join(root, "src"), { recursive: true });
      const inSrc = path.join(root, "src", "ioc.config.ts");
      const atRoot = path.join(root, "ioc.config.ts");
      writeFileSync(inSrc, "");
      writeFileSync(atRoot, "");

      const resolved = resolveIocConfigPath(root);
      assert.equal(resolved, inSrc);
    });
  });

  describe("When no config exists in the walk", () => {
    it("should fall back to <searchStart>/src/ioc.config.ts", () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-miss-"));
      const resolved = resolveIocConfigPath(root);
      assert.equal(resolved, path.join(root, "src", "ioc.config.ts"));
    });
  });

  describe("When an explicit relative path is passed", () => {
    it("should resolve relative to searchStartDir", () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-explicit-"));
      const resolved = resolveIocConfigPath(root, "cfg/ioc.config.ts");
      assert.equal(resolved, path.join(root, "cfg", "ioc.config.ts"));
    });
  });

  describe("When groupBaseTypeAliases is set in library mode", () => {
    it("should reject the field", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-alias-lib-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default {
          discovery: { scanDirs: "src" },
          groupBaseTypeAliases: { g: ["/a:Foo", "/b:Foo"] },
        };`,
      );
      await assert.rejects(
        () => loadIocConfig(cfg),
        /groupBaseTypeAliases is only valid in app mode/,
      );
    });
  });

  describe("When groupBaseTypeAliases has fewer than two entries", () => {
    it("should reject the alias set", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-alias-short-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default {
          discovery: { scanDirs: "src" },
          composedManifests: ["@pkg/a"],
          groupBaseTypeAliases: { g: ["/only:Foo"] },
        };`,
      );
      await assert.rejects(
        () => loadIocConfig(cfg),
        /at least 2 canonical identifier strings/,
      );
    });
  });

  describe("When lifetimeMarkers is an empty object", () => {
    it("should accept the config", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-lifetime-markers-empty-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default { discovery: { scanDirs: "src" }, lifetimeMarkers: {} };`,
      );
      const loaded = await loadIocConfig(cfg);
      assert.deepEqual(loaded.lifetimeMarkers, {});
    });
  });

  describe("When lifetimeMarkers has an invalid lifetime value", () => {
    it("should reject the entry", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-lifetime-markers-bad-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default {
          discovery: { scanDirs: "src" },
          lifetimeMarkers: { IScoped: "request" },
        };`,
      );
      await assert.rejects(
        () => loadIocConfig(cfg),
        /lifetimeMarkers\."IScoped" must be singleton \| scoped \| transient/,
      );
    });
  });

  describe("When lifetimeMarkers has duplicate lifetime values across keys", () => {
    it("should accept the config", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-lifetime-markers-dup-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default {
          discovery: { scanDirs: "src" },
          lifetimeMarkers: { IScoped: "scoped", RequestScoped: "scoped" },
        };`,
      );
      const loaded = await loadIocConfig(cfg);
      assert.deepEqual(loaded.lifetimeMarkers, {
        IScoped: "scoped",
        RequestScoped: "scoped",
      });
    });
  });

  describe("When scopeProvided is absent", () => {
    it("should accept the config", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-scope-provided-absent-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default { discovery: { scanDirs: "src" } };`,
      );
      const loaded = await loadIocConfig(cfg);
      assert.equal(loaded.scopeProvided, undefined);
    });
  });

  describe("When scopeProvided is a valid string array in library mode", () => {
    it("should accept the config", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-scope-provided-lib-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default {
          discovery: { scanDirs: "src" },
          scopeProvided: ["viewerId", "requestId"],
        };`,
      );
      const loaded = await loadIocConfig(cfg);
      assert.deepEqual(loaded.scopeProvided, ["viewerId", "requestId"]);
    });
  });

  describe("When scopeProvided is a valid string array in app mode", () => {
    it("should accept the config", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-scope-provided-app-"));
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "@test/app" }),
      );
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default {
          discovery: { scanDirs: "src" },
          composedManifests: ["@pkg/a"],
          scopeProvided: ["viewerId"],
        };`,
      );
      const loaded = await loadIocConfig(cfg);
      assert.deepEqual(loaded.scopeProvided, ["viewerId"]);
    });
  });

  describe("When scopeProvided is not an array", () => {
    it("should reject the field", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-scope-provided-not-array-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default {
          discovery: { scanDirs: "src" },
          scopeProvided: { viewerId: true },
        };`,
      );
      await assert.rejects(
        () => loadIocConfig(cfg),
        /scopeProvided must be an array when set/,
      );
    });
  });

  describe("When scopeProvided contains an empty string", () => {
    it("should reject the entry", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-scope-provided-empty-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default {
          discovery: { scanDirs: "src" },
          scopeProvided: ["viewerId", ""],
        };`,
      );
      await assert.rejects(
        () => loadIocConfig(cfg),
        /scopeProvided\[1\] must be a non-empty string/,
      );
    });
  });

  describe("When scopeProvided contains a non-string element", () => {
    it("should reject the entry", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-scope-provided-non-string-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default {
          discovery: { scanDirs: "src" },
          scopeProvided: ["viewerId", 1],
        };`,
      );
      await assert.rejects(
        () => loadIocConfig(cfg),
        /scopeProvided\[1\] must be a non-empty string/,
      );
    });
  });

  describe("When scopeProvided contains a duplicate key", () => {
    it("should reject the field naming the repeated key", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-scope-provided-dup-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default {
          discovery: { scanDirs: "src" },
          scopeProvided: ["viewerId", "requestId", "viewerId"],
        };`,
      );
      await assert.rejects(
        () => loadIocConfig(cfg),
        /scopeProvided contains duplicate entry "viewerId"/,
      );
    });
  });
});
