/**
 * @fileoverview Pins the shape that keeps config loading cheap, not the clock that noticed it was
 * expensive.
 *
 * The regression these guard against cost a field run 156 seconds of a 156-second `ioc validate`:
 * every `loadIocConfig` went through tsx's `tsImport`, which registers a fresh ESM hook per call
 * and never unregisters, and on tsx 4.22.0–4.22.4 those hooks are not independent — cost grew as
 * roughly 14^(N−1) in the number of live registrations. Four composed packages was enough.
 *
 * So the assertions below are structural wherever they can be. "One registration however many
 * packages" is a fact about the process that holds on every machine and every tsx version; "config
 * loading is fast" is a fact about this laptop today. The timing test is kept as a second net with
 * a wide margin, because the failure it catches is three orders of magnitude, not a few percent.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  clearConfigModuleCache,
  configLoaderRegistrationCount,
  importConfigModule,
} from "./configModuleLoader.js";
import { clearIocConfigCache, loadIocConfig } from "./loadIocConfig.js";

/** Names the composed packages the fixture builds. Four is the field's count; six is headroom. */
const PACKAGES = ["app", "media-core", "infrastructure", "notifications", "billing", "search"];

/**
 * A monorepo whose tsconfig sets `allowJs` — the field's trigger condition.
 *
 * `allowJs` is what opens tsx's extension fan-out for plain relative specifiers, and tsx resolves
 * the tsconfig from `process.cwd()` at REGISTER time, so the fixture is only faithful if the CLI's
 * cwd is the fixture root. Each config also imports two relative `.js` specifiers that resolve to
 * `.ts` files, which is the shape that makes the fan-out do real work.
 */
const buildFixture = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "ioc-cfgload-"));
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture-workspace", private: true, type: "module" }),
  );
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        allowJs: true,
        baseUrl: ".",
        paths: { "@shared/*": ["shared/*"] },
      },
    }),
  );

  for (const name of PACKAGES) {
    const src = path.join(root, "packages", name, "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(
      path.join(root, "packages", name, "package.json"),
      JSON.stringify({ name: `@fixture/${name}`, version: "1.0.0", type: "module" }),
    );
    writeFileSync(
      path.join(src, "scanPolicy.ts"),
      `export const scanDirs = ["src"];\n`,
    );
    writeFileSync(
      path.join(src, "lifetimes.ts"),
      `export const lifetimeMarkers = { Scoped: "scoped" } as const;\n`,
    );
    writeFileSync(
      path.join(src, "ioc.config.ts"),
      [
        `import { scanDirs } from "./scanPolicy.js";`,
        `import { lifetimeMarkers } from "./lifetimes.js";`,
        `export default {`,
        `  packageName: "@fixture/${name}",`,
        `  discovery: { scanDirs },`,
        `  lifetimeMarkers: { ...lifetimeMarkers },`,
        `};`,
        ``,
      ].join("\n"),
    );
  }
  return root;
};

const configPathFor = (root: string, name: string): string =>
  path.join(root, "packages", name, "src", "ioc.config.ts");

describe("config module loader", () => {
  let root: string;
  let originalCwd: string;

  before(() => {
    root = buildFixture();
    originalCwd = process.cwd();
    // tsx reads the tsconfig from cwd when the hook is REGISTERED, which happens lazily on the
    // first load below. Standing in the fixture is what makes `allowJs` apply.
    process.chdir(root);
  });

  after(() => {
    process.chdir(originalCwd);
  });

  describe("When configs for many packages are loaded in one process", () => {
    it("should register exactly one tsx hook regardless of package count", async () => {
      assert.equal(
        configLoaderRegistrationCount(),
        0,
        "no hook should exist before the first config load",
      );

      for (const name of PACKAGES) {
        await loadIocConfig(configPathFor(root, name));
      }

      assert.equal(
        configLoaderRegistrationCount(),
        1,
        `loading ${PACKAGES.length} package configs must leave exactly one live tsx registration`,
      );
    });

    it("should still hold one registration after reloading every config", async () => {
      for (const name of PACKAGES) {
        await loadIocConfig(configPathFor(root, name));
        await importConfigModule(configPathFor(root, name));
      }
      assert.equal(configLoaderRegistrationCount(), 1);
    });
  });

  describe("When the same config path is requested more than once", () => {
    it("should evaluate the config module exactly once", async () => {
      // The config records its own evaluations on a global, so the count is of MODULE EVALUATIONS
      // — the thing that actually costs — rather than of calls into the cache.
      const pkgRoot = path.join(root, "packages", "counted", "src");
      mkdirSync(pkgRoot, { recursive: true });
      writeFileSync(
        path.join(root, "packages", "counted", "package.json"),
        JSON.stringify({ name: "@fixture/counted", version: "1.0.0", type: "module" }),
      );
      const cfg = path.join(pkgRoot, "ioc.config.ts");
      writeFileSync(
        cfg,
        [
          `const g = globalThis as Record<string, unknown>;`,
          `g.__iocConfigEvaluations = ((g.__iocConfigEvaluations as number) ?? 0) + 1;`,
          `export default { packageName: "@fixture/counted", discovery: { scanDirs: ["src"] } };`,
          ``,
        ].join("\n"),
      );

      const evaluations = (): number =>
        ((globalThis as Record<string, unknown>).__iocConfigEvaluations as number) ?? 0;
      const before_ = evaluations();

      // Every route into config loading, including the two the freshness pass and the composition
      // context take, plus the same path spelled differently.
      await loadIocConfig(cfg);
      await loadIocConfig(cfg);
      await loadIocConfig(path.join(pkgRoot, ".", "ioc.config.ts"));
      await importConfigModule(cfg);

      assert.equal(
        evaluations() - before_,
        1,
        "the same config path must be imported once per process, not once per caller",
      );
    });
  });

  describe("When a config is rewritten in place", () => {
    it("should re-read it rather than serve the cached module", async () => {
      // `tsImport` used to get this for free: a fresh namespace per call meant a fresh module URL.
      // Under one stable registration the URL is stable too, so the content stamp is what keeps a
      // regenerated config from being answered from Node's ESM cache.
      const pkgRoot = path.join(root, "packages", "rewritten", "src");
      mkdirSync(pkgRoot, { recursive: true });
      const cfg = path.join(pkgRoot, "ioc.config.ts");

      writeFileSync(cfg, `export default { packageName: "before", discovery: { scanDirs: ["src"] } };\n`);
      const first = await loadIocConfig(cfg);
      assert.equal(first.packageName, "before");

      writeFileSync(
        cfg,
        `export default { packageName: "after", discovery: { scanDirs: ["src", "lib"] } };\n`,
      );
      const second = await loadIocConfig(cfg);
      assert.equal(second.packageName, "after");
      assert.deepEqual(second.discovery?.scanDirs, ["src", "lib"]);
    });
  });

  describe("When config load time is measured across a multi-package composition", () => {
    it("should stay flat rather than growing with the number of packages loaded", async () => {
      clearConfigModuleCache();
      clearIocConfigCache();

      const timings: { name: string; ms: number }[] = [];
      for (const name of PACKAGES) {
        const started = performance.now();
        await importConfigModule(configPathFor(root, name));
        timings.push({ name, ms: performance.now() - started });
      }

      // The first load pays for tsx's own startup, so it is the natural ceiling; every later load
      // is warm and should be well under it. Under the registration-per-load regression the LAST
      // package is the expensive one — the field measured 1.03 / 1.36 / 11.53 / 151.42s for four.
      const first = timings[0]!.ms;
      const later = timings.slice(1);
      const slowest = later.reduce((a, b) => (a.ms > b.ms ? a : b));
      const ceiling = Math.max(first, 100) * 4;

      assert.ok(
        slowest.ms < ceiling,
        `config load time must not grow with package count; first=${first.toFixed(0)}ms ` +
          `slowest-later=${slowest.name}@${slowest.ms.toFixed(0)}ms ceiling=${ceiling.toFixed(0)}ms ` +
          `(all: ${timings.map((t) => `${t.name}=${t.ms.toFixed(0)}ms`).join(" ")})`,
      );
    });
  });
});
