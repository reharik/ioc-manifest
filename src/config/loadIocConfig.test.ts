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

  describe("When workspacePackageImportBases entry has extra keys", () => {
    it("should throw", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-ws-"));
      const cfg = path.join(root, "ioc.config.ts");
      writeFileSync(
        cfg,
        `export default { discovery: { scanDirs: "src", workspacePackageImportBases: [
          { root: "packages/a", importBase: "@a/a", extra: 1 }
        ] } };`,
      );
      await assert.rejects(
        () => loadIocConfig(cfg),
        /unknown property .*extra/,
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
});
