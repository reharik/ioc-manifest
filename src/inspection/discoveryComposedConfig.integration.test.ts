/**
 * Discovery mode's config-validation universe, across a package boundary.
 *
 * The defect this pins: an app whose `registrations` block configures a COMPOSED contract — electing
 * a library's implementation as the app's default, which the contract-slot design makes a
 * first-class pattern — could not run `ioc inspect --discovery` or `ioc explain <key> --discovery`
 * at all. Discovery-mode validation measured `registrations` keys against LOCAL contract names, so
 * a sanctioned config read as a typo and took the primary diagnostic view down with it, in exactly
 * the apps that use app-side election. Generation never had it: `generateManifest` assembles the
 * composed contract names before planning and threads them into the same validator.
 *
 * The fixture is built on disk per test, half of it under `node_modules`, because a composing app
 * only ever sees a library as a generated manifest — the same shape and the same reason as
 * `composedSubtreeDemand.integration.test.ts`.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { runDiscoveryAnalysis } from "./runDiscoveryAnalysis.js";
import { explainFromDiscovery } from "./explain.js";
import { buildDiscoveryReport, formatDiscoveryReport } from "./index.js";
import {
  composedContractNamesFromSupply,
  EMPTY_COMPOSED_MANIFEST_SUPPLY,
} from "../generator/loadComposedManifestUnits.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iocModule = path.join(__dirname, "../index.js").replace(/\\/g, "/");

const LIB = "@test/lib-storage";

/** A library manifest as this generator writes one: two implementations of one contract. */
const LIBRARY_MANIFEST = `export const iocManifest = {
  manifestSchemaVersion: 3,

  moduleImports: [],

  contracts: {
    Storage: {
      s3Storage: {
        exportName: "buildS3Storage",
        registrationKey: "s3Storage",
        modulePath: "storage/buildS3Storage.ts",
        relImport: "../storage/buildS3Storage.js",
        contractName: "Storage",
        implementationName: "s3Storage",
        lifetime: "singleton",
        moduleIndex: 0,
        lifetimeSource: "default",
      },
      localStorage: {
        exportName: "buildLocalStorage",
        registrationKey: "localStorage",
        modulePath: "storage/buildLocalStorage.ts",
        relImport: "../storage/buildLocalStorage.js",
        contractName: "Storage",
        implementationName: "localStorage",
        lifetime: "singleton",
        moduleIndex: 1,
        lifetimeSource: "default",
      },
    },
  },
} as const;

export const IOC_SCOPE_PROVIDED_KEYS = [] as const;

export const IOC_MANIFEST_FEATURES = ["dependencyKeys", "lifetimeSource"] as const;
`;

const LIBRARY_TYPES = `export interface IocGeneratedCradle {
  storage: unknown;
  s3Storage: unknown;
  localStorage: unknown;
}
export interface IocExternals {}
`;

const APP_CONTRACTS = `export interface AppConfig {
  readonly bucket: string;
}
`;

const APP_FACTORY = `import type { AppConfig } from "../contracts.js";

export const buildConfig = (): AppConfig => ({ bucket: "b" });
`;

const appIocConfig = (options: {
  composed: readonly string[];
  /** The contract name the `registrations` block configures. */
  configuredContract?: string;
}): string => {
  const registrations =
    options.configuredContract === undefined
      ? ""
      : `  registrations: {
    ${options.configuredContract}: { s3Storage: { default: true } },
  },\n`;
  return `import { defineIocConfig } from "${iocModule}";

export default defineIocConfig({
  discovery: {
    scanDirs: ["src/factories"],
    generatedDir: "src/generated",
    includes: ["**/*.{ts,tsx}"],
  },
${options.composed.length > 0 ? `  composedManifests: ${JSON.stringify(options.composed)},\n` : ""}${registrations}});
`;
};

type FixtureOptions = {
  /** Compose the library. Default: true. */
  compose?: boolean;
  /** Contract name the app's `registrations` block names. Omit for no `registrations` block. */
  configuredContract?: string;
  /**
   * Install the composed package on disk. Default: true.
   *
   * `false` with `compose: true` is the degraded case: the config names a package that is declared
   * and absent, so nothing at all is known about its contracts.
   */
  installPackage?: boolean;
};

const buildFixture = (options?: FixtureOptions): string => {
  const root = mkdtempSync(path.join(tmpdir(), "ioc-discovery-config-"));
  const srcDir = path.join(root, "src");
  const factoriesDir = path.join(srcDir, "factories");
  mkdirSync(factoriesDir, { recursive: true });

  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "@test/app", type: "module" }),
  );
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
      },
      include: ["src/**/*.ts"],
    }),
  );

  const compose = options?.compose !== false;
  if (compose && options?.installPackage !== false) {
    const pkgDir = path.join(root, "node_modules", ...LIB.split("/"));
    mkdirSync(path.join(pkgDir, "generated"), { recursive: true });
    writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: LIB,
        exports: {
          "./iocManifest": "./generated/ioc-manifest.ts",
          "./iocTypes": "./generated/ioc-registry.types.ts",
        },
      }),
    );
    writeFileSync(
      path.join(pkgDir, "generated", "ioc-manifest.ts"),
      LIBRARY_MANIFEST,
    );
    writeFileSync(
      path.join(pkgDir, "generated", "ioc-registry.types.ts"),
      LIBRARY_TYPES,
    );
  }

  writeFileSync(path.join(srcDir, "contracts.ts"), APP_CONTRACTS);
  writeFileSync(path.join(factoriesDir, "buildConfig.ts"), APP_FACTORY);
  writeFileSync(
    path.join(srcDir, "ioc.config.ts"),
    appIocConfig({
      composed: compose ? [LIB] : [],
      ...(options?.configuredContract !== undefined
        ? { configuredContract: options.configuredContract }
        : {}),
    }),
  );

  return root;
};

const analyze = async (root: string) =>
  runDiscoveryAnalysis({
    iocConfigPath: path.join(root, "src/ioc.config.ts"),
    paths: { projectRoot: root },
  });

describe("discovery-mode config validation over the composed contract universe", () => {
  describe("When the app's registrations configure a COMPOSED contract", () => {
    it("should run rather than refuse the sanctioned app-side election", async () => {
      // The field shape from the #22 report: `registrations: { Storage: { s3Storage: {...} } }` in
      // an app that declares no `Storage` of its own. Both discovery-mode verbs used to die here.
      const root = buildFixture({ configuredContract: "Storage" });

      const analysis = await analyze(root);

      assert.deepEqual(
        analysis.registrationPlan.map((plan) => plan.contractName),
        ["AppConfig"],
      );
      assert.match(
        formatDiscoveryReport(buildDiscoveryReport(analysis), {
          color: false,
        }),
        /buildConfig → AppConfig/,
      );
    });

    it("should let `explain --discovery` reach the composed election", async () => {
      const root = buildFixture({ configuredContract: "Storage" });
      const analysis = await analyze(root);

      // The local half only — this pins that the VIEW is reachable at all, which was the defect.
      // What the composed half renders is `explainComposed.test.ts`'s subject.
      const report = explainFromDiscovery("config", analysis);
      assert.equal(report.resolution.kind, "registration");
      assert.equal(report.mode, "discovery");
    });
  });

  describe("When the app's registrations name a contract nobody declares", () => {
    it("should still refuse, and say how far it looked", async () => {
      const root = buildFixture({ configuredContract: "Sttorage" });

      await assert.rejects(analyze(root), (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        assert.match(
          message,
          /unknown contract "Sttorage" — not a contract in this package or any composed manifest/,
        );
        assert.match(message, /Known local contracts: AppConfig/);
        assert.match(
          message,
          /Known contracts from composed packages: Storage/,
        );
        assert.match(message, /Did you mean: "Storage"/);
        return true;
      });
    });
  });

  describe("When a composed package the config declares cannot be read", () => {
    it("should report the undecidable name and still produce the view", async () => {
      // Reported, not refused. With the manifest unreadable the universe is INCOMPLETE, so an
      // unknown name is genuinely undecidable — it may be a typo, or it may be declared in the very
      // file that could not be opened. Refusing would take the whole view away over one
      // unresolvable dependency; accepting silently would hide a real typo.
      const root = buildFixture({
        configuredContract: "Storage",
        installPackage: false,
      });

      const warnings: string[] = [];
      const realError = console.error;
      console.error = (...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
      };
      let analysis;
      try {
        analysis = await analyze(root);
      } finally {
        console.error = realError;
      }

      assert.deepEqual(
        analysis.registrationPlan.map((plan) => plan.contractName),
        ["AppConfig"],
      );
      const advisory = warnings.find((line) =>
        line.includes('unknown contract "Storage"'),
      );
      assert.ok(advisory, `expected an advisory, got: ${warnings.join("\n")}`);
      assert.match(
        advisory,
        /Reported, not refused: "@test\/lib-storage" could not be read/,
      );
      assert.match(advisory, /Run `ioc generate` for the authoritative answer/);
    });
  });

  describe("When the package composes nothing", () => {
    it("should keep a library-mode report byte-identical", async () => {
      const root = buildFixture({ compose: false });
      const analysis = await analyze(root);

      assert.equal(
        formatDiscoveryReport(buildDiscoveryReport(analysis), {
          color: false,
        }),
        [
          "buildConfig.ts",
          "  ✔ buildConfig → AppConfig  key: config  singleton",
          "",
          "Summary: 1 file(s) scanned · 1 unit(s) discovered · 0 near-miss(es) · 0 not-a-candidate file(s)",
          "         0 file(s) excluded by config",
        ].join("\n"),
      );
    });
  });
});

describe("composedContractNamesFromSupply", () => {
  it("should project the universe off supply already parsed, per package and in union", () => {
    const names = composedContractNamesFromSupply({
      ...EMPTY_COMPOSED_MANIFEST_SUPPLY,
      units: [
        {
          packageName: "@a/one",
          contractName: "Storage",
          implementationName: "s3",
          registrationKey: "s3",
          exportName: "buildS3",
          modulePath: "@a/one/s.ts",
          lifetime: "singleton",
          isDefault: true,
        },
        {
          packageName: "@a/one",
          contractName: "Storage",
          implementationName: "local",
          registrationKey: "local",
          exportName: "buildLocal",
          modulePath: "@a/one/l.ts",
          lifetime: "singleton",
          isDefault: false,
        },
        {
          packageName: "@b/two",
          contractName: "Clock",
          implementationName: "clock",
          registrationKey: "clock",
          exportName: "buildClock",
          modulePath: "@b/two/c.ts",
          lifetime: "singleton",
          isDefault: true,
        },
      ],
    });

    assert.deepEqual([...names.all].sort(), ["Clock", "Storage"]);
    assert.deepEqual([...(names.byPackage.get("@a/one") ?? [])], ["Storage"]);
    assert.deepEqual([...(names.byPackage.get("@b/two") ?? [])], ["Clock"]);
  });

  it("should be empty for a package set that supplies nothing", () => {
    const names = composedContractNamesFromSupply(
      EMPTY_COMPOSED_MANIFEST_SUPPLY,
    );
    assert.equal(names.all.size, 0);
    assert.equal(names.byPackage.size, 0);
  });
});
