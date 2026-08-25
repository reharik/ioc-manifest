/**
 * Scope-root openers ACROSS a package boundary.
 *
 * The demand side and the supply side are written by two different runs of the generator, in two
 * different packages, and the only thing that joins them is the opener KEY. This suite pins that
 * both halves agree on it: the app resolves its demand to `openLibraryRouterScope` and stops asking
 * the composing app for it, and `composeManifests` claims that same string when the library's
 * manifest is merged in.
 */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { composeManifests } from "../../runtime/composeManifests.js";
import { baseManifest, implMeta } from "../../test-support/manifestFixtures.js";
import type { DiscoveredFactory } from "../types.js";
import { buildManifestArtifactSources } from "../writeManifest.js";
import { analyzeDemandSupply } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(
  __dirname,
  "../test-fixtures/cross-package-opener",
);
const appDir = path.join(fixtureRoot, "app");
const projectRoot = appDir;
const generatedDir = path.join(appDir, "generated");
const scanDirs = [{ absPath: path.join(appDir, "src") }];
const factoryFile = path.join(appDir, "src/buildRouterGateway.ts");

/** The key the library's opener is registered under, on both sides of the boundary. */
const OPENER_KEY = "openLibraryRouterScope";

const loadFixtureProgram = (): ts.Program => {
  const configPath = path.join(fixtureRoot, "tsconfig.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.ok(!configFile.error);
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    fixtureRoot,
    undefined,
    configPath,
  );
  assert.strictEqual(parsed.errors.length, 0);
  return ts.createProgram({ rootNames: [factoryFile], options: parsed.options });
};

const appFactories: DiscoveredFactory[] = [
  {
    contractName: "RouterGateway",
    contractTypeRelImport: "./buildRouterGateway.js",
    implementationName: "routerGateway",
    exportName: "buildRouterGateway",
    registrationKey: "routerGateway",
    modulePath: "buildRouterGateway.ts",
    relImport: "./buildRouterGateway.js",
  },
];

const analyze = (composedOpenerKeys?: readonly string[]) =>
  analyzeDemandSupply(appFactories, {
    program: loadFixtureProgram(),
    projectRoot,
    scanDirs,
    generatedDir,
    composedOpenerKeys,
  });

describe("cross-package scope-root opener consumption", () => {
  describe("When an app factory injects a composed package's opener", () => {
    it("should resolve the demand to the opener key composition claims", () => {
      const result = analyze([OPENER_KEY]);

      const entry = result.entries.find((e) => e.key === OPENER_KEY);
      assert.ok(entry, `expected a cradle entry for ${OPENER_KEY}`);
      // Carried by reference to the LIBRARY's alias, through the package's `iocTypes` export —
      // never expanded into the opener's function type.
      assert.strictEqual(entry.typeRef.typeName, "OpenLibraryRouterScope");
      assert.deepStrictEqual(
        entry.typeRef.imports.map((i) => [i.typeName, i.relImport]),
        [["OpenLibraryRouterScope", "@test/lib-router/iocTypes"]],
      );
    });

    it("should not ask the composing app for a key composition already supplies", () => {
      const result = analyze([OPENER_KEY]);

      assert.ok(!result.externalKeys.includes(OPENER_KEY));

      const { typesSource } = buildManifestArtifactSources(
        appFactories,
        [],
        undefined,
        path.join(generatedDir, "ioc-manifest.ts"),
        "ioc-manifest",
        { demandSupply: result },
      );

      assert.match(
        typesSource,
        /^ {2}openLibraryRouterScope: OpenLibraryRouterScope;$/m,
      );
      assert.match(
        typesSource,
        /import type \{ OpenLibraryRouterScope \} from "@test\/lib-router\/iocTypes";/,
      );
      assert.match(typesSource, /export interface IocExternals \{\}/);
      // The handle stays a handle: its signature is never printed into the app's cradle.
      assert.ok(!typesSource.includes("dispose: () => Promise<void>"));
    });

    it("should still treat the key as an external when nothing composes it", () => {
      // The control. Without the composed manifest, no one supplies the key and the app must be
      // asked for it — which is the ordinary unregistered-demand rule, unchanged.
      const result = analyze();

      assert.ok(result.externalKeys.includes(OPENER_KEY));
    });
  });

  describe("When the library manifest is composed", () => {
    it("should claim the same key the app's demand resolved to", () => {
      const app = baseManifest(
        {
          RouterGateway: {
            routerGateway: implMeta({
              contractName: "RouterGateway",
              implementationName: "routerGateway",
            }),
          },
        },
        [{ buildRouterGateway: () => ({}) }],
      );
      const library = baseManifest({}, [{ buildLibraryRouter: () => ({}) }], {
        scopeRoots: {
          IRouter: {
            libraryRouter: {
              exportName: "buildLibraryRouter",
              openerKey: OPENER_KEY,
              variantKey: "libraryRouter",
              contractName: "IRouter",
              variantName: "libraryRouter",
              modulePath: "libraryRouter.ts",
              relImport: "../libraryRouter.js",
              lbvKeys: ["requestId"],
              moduleIndex: 0,
            },
          },
        },
      });

      const merged = composeManifests([app, library]);

      // The join: the string the demand side resolved to is the string the supply side registers.
      assert.strictEqual(
        merged.scopeRoots!.IRouter!.libraryRouter!.openerKey,
        OPENER_KEY,
      );
      assert.strictEqual(
        analyze([OPENER_KEY]).entries.find((e) => e.key === OPENER_KEY)?.key,
        merged.scopeRoots!.IRouter!.libraryRouter!.openerKey,
      );
    });
  });
});
