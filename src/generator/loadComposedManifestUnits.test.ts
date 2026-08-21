/**
 * Parsing a composed package manifest into walk-ready supply.
 *
 * The contract under test is a reconstruction one: what comes out of here must match what
 * `registerIocFromManifest` will register from the same file — implementation keys, contract
 * default-slot aliases, group roots — because a walk built on a different picture of the container
 * than the one that will exist is worse than no walk at all.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  loadComposedManifestSupply,
  parseComposedManifestSupplySource,
} from "./loadComposedManifestUnits.js";

const manifestSource = (options?: {
  dependencyKeys?: boolean;
  features?: boolean;
  accessKey?: boolean;
}): string => `export const iocManifest = {
  manifestSchemaVersion: 3,

  moduleImports: [],

  contracts: {
    APIClient: {
      restClient: {
        exportName: "buildRestClient",
        registrationKey: "restClient",
        modulePath: "clients/buildRestClient.ts",
        relImport: "../clients/buildRestClient.js",
        contractName: "APIClient",
        implementationName: "restClient",
        lifetime: "singleton",
        moduleIndex: 0,
        default: true,${options?.accessKey === true ? `\n        accessKey: "httpClient",` : ""}${
          options?.dependencyKeys === false
            ? ""
            : `\n        dependencyKeys: ["baseUrl", "logger"],`
        }
      },
      graphClient: {
        exportName: "buildGraphClient",
        registrationKey: "graphClient",
        modulePath: "clients/buildGraphClient.ts",
        relImport: "../clients/buildGraphClient.js",
        contractName: "APIClient",
        implementationName: "graphClient",
        lifetime: "scoped",
        moduleIndex: 1,
      },
    },
  },

  // readers
  readers: {
    kind: "collection",
    baseType: "Reader",
    baseTypeId: "@test/lib/src/types/Reader.ts:Reader",
    members: [
      { contractName: "APIClient", registrationKey: "restClient" },
      { contractName: "APIClient", registrationKey: "graphClient" },
    ],
  },

  // namedReaders
  namedReaders: {
    kind: "object",
    baseType: "Reader",
    baseTypeId: "@test/lib/src/types/Reader.ts:Reader",
    members: {
      rest: { contractName: "APIClient", registrationKey: "restClient" },
    },
  },
} as const;

export const IOC_SCOPE_PROVIDED_KEYS = [] as const;
${options?.features === false ? "" : `\nexport const IOC_MANIFEST_FEATURES = ["dependencyKeys"] as const;\n`}`;

const parse = (options?: Parameters<typeof manifestSource>[0]) =>
  parseComposedManifestSupplySource(
    manifestSource(options),
    "/pkg/generated/ioc-manifest.ts",
    "@test/lib",
  );

describe("parseComposedManifestSupplySource", () => {
  describe("When a generated manifest declares contracts", () => {
    it("should return one unit per implementation, with lifetime and package-qualified path", () => {
      const parsed = parse();

      assert.deepEqual(
        parsed.units.map((u) => [
          u.registrationKey,
          u.lifetime,
          u.modulePath,
          u.isDefault,
        ]),
        [
          [
            "restClient",
            "singleton",
            "@test/lib/clients/buildRestClient.ts",
            true,
          ],
          [
            "graphClient",
            "scoped",
            "@test/lib/clients/buildGraphClient.ts",
            false,
          ],
        ],
      );
    });

    it("should carry dependency keys verbatim, and omit them when the manifest has none", () => {
      assert.deepEqual(parse().units[0]?.dependencyKeys, ["baseUrl", "logger"]);
      // Absent, NOT empty: a unit whose manifest never wrote the field is "unknown", and the two
      // must stay distinguishable or the blind-spot advisory has nothing to key on.
      assert.equal(
        parse({ dependencyKeys: false }).units[0]?.dependencyKeys,
        undefined,
      );
      // A unit the manifest simply did not give keys to reads the same way.
      assert.equal(parse().units[1]?.dependencyKeys, undefined);
    });

    it("should register the contract default-slot alias the way the runtime does", () => {
      // Convention: camel-cased contract name → the implementation marked default.
      assert.equal(parse().accessKeys.get("apiClient"), "restClient");
      // Explicit `accessKey` on any implementation wins, exactly as `resolveManifestAccessKey` does.
      const explicit = parse({ accessKey: true });
      assert.equal(explicit.accessKeys.get("httpClient"), "restClient");
      assert.equal(explicit.accessKeys.has("apiClient"), false);
    });

    it("should expand group roots of both kinds into member registration keys", () => {
      const parsed = parse();

      assert.deepEqual(parsed.groupMembersByGroupKey.get("readers"), [
        "restClient",
        "graphClient",
      ]);
      assert.deepEqual(parsed.groupMembersByGroupKey.get("namedReaders"), [
        "restClient",
      ]);
      // Fixed manifest keys are structure, never groups.
      assert.equal(parsed.groupMembersByGroupKey.has("contracts"), false);
      assert.equal(
        parsed.groupMembersByGroupKey.has("manifestSchemaVersion"),
        false,
      );
    });
  });

  describe("When the manifest declares its features", () => {
    it("should report whether dependency keys are carried in full", () => {
      assert.equal(parse().carriesDependencyKeys, true);
      // The bootstrap case: a manifest written before the field existed declares nothing.
      assert.equal(parse({ features: false }).carriesDependencyKeys, false);
    });
  });

  describe("When the source does not export iocManifest", () => {
    it("should fail rather than return empty supply", () => {
      assert.throws(
        () =>
          parseComposedManifestSupplySource(
            "export const somethingElse = {};",
            "/pkg/ioc-manifest.ts",
            "@test/lib",
          ),
        /does not export iocManifest/,
      );
    });
  });
});

const installPackage = (
  root: string,
  packageName: string,
  source: string,
): void => {
  const pkgDir = path.join(root, "node_modules", ...packageName.split("/"));
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: packageName,
      exports: { "./iocManifest": "./ioc-manifest.ts" },
    }),
  );
  writeFileSync(path.join(pkgDir, "ioc-manifest.ts"), source);
};

describe("loadComposedManifestSupply", () => {
  const makeRoot = (): string => {
    const root = mkdtempSync(path.join(tmpdir(), "ioc-composed-supply-"));
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "@test/app", type: "module" }),
    );
    return root;
  };

  describe("When several packages are composed", () => {
    it("should merge group members across manifests rather than let one shadow another", async () => {
      const root = makeRoot();
      installPackage(root, "@test/lib-a", manifestSource());
      installPackage(
        root,
        "@test/lib-b",
        manifestSource().replace(/"restClient"/g, '"altClient"'),
      );

      const supply = await loadComposedManifestSupply(root, [
        "@test/lib-a",
        "@test/lib-b",
      ]);

      // Composition merges group roots, so the collection is the union — which is the collection
      // the cradle will actually hand out.
      assert.deepEqual(supply.groupMembersByGroupKey.get("readers"), [
        "restClient",
        "graphClient",
        "altClient",
      ]);
      assert.equal(supply.packagesWithoutDependencyData.length, 0);
    });

    it("should name every package whose manifest carries no dependency data", async () => {
      const root = makeRoot();
      installPackage(root, "@test/lib-new", manifestSource());
      installPackage(
        root,
        "@test/lib-old",
        manifestSource({ features: false, dependencyKeys: false }),
      );

      const supply = await loadComposedManifestSupply(root, [
        "@test/lib-new",
        "@test/lib-old",
      ]);

      assert.deepEqual(supply.packagesWithoutDependencyData, ["@test/lib-old"]);
    });
  });

  describe("When a composed package cannot be read", () => {
    it("should throw by default", async () => {
      const root = makeRoot();

      await assert.rejects(
        loadComposedManifestSupply(root, ["@test/missing"]),
        /cannot locate installed package/,
      );
    });

    it("should degrade to a named blind spot when the caller tolerates it", async () => {
      // Inspection's stance: a report is a view, and an unresolvable package must thin it rather
      // than crash it — while still being disclosed, never silently dropped.
      const root = makeRoot();

      const supply = await loadComposedManifestSupply(root, ["@test/missing"], {
        tolerateUnreadablePackages: true,
      });

      assert.deepEqual(supply.units, []);
      assert.deepEqual(supply.packagesWithoutDependencyData, ["@test/missing"]);
    });
  });
});
