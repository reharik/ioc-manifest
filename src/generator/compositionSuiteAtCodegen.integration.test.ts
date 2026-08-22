/**
 * @fileoverview App-mode `ioc generate` runs the composition suite — the same checks, over the
 * same program, as `ioc validate`.
 *
 * The defect: an app package's generate already COMPOSED (loaded composed manifests, emitted
 * `ioc-composed.ts`, walked composed subtrees, resolved composed opener and slot keys) but never
 * JUDGED the composition. Every compositional check lived only in `validate`, a verb the primary
 * workflow — generated output not checked in, gen on every change — structurally never runs. So
 * gen was passing while validation had all manner of errors.
 *
 * What is pinned here: gen fails on each class of composition error; ONE run names them all; no
 * output is written when it does; the SAME fixtures through `runValidate` reach the same verdicts;
 * library mode is untouched; a warning-severity finding warns and lets generation through; and a
 * healthy app's output is byte-identical to what it was before the suite existed.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";
import { tryLoadIocConfig } from "../config/loadIocConfig.js";
import { runValidate } from "../validate/runValidate.js";
import { generateManifest } from "./generateManifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iocManifestIndex = path
  .join(__dirname, "../index.js")
  .replace(/\\/g, "/");

const LIB = "@test/lib";

const TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "Node16",
    moduleResolution: "Node16",
    lib: ["ES2022"],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ["src/**/*.ts"],
};

const APP_CONTRACTS = `export interface Clock {
  now(): number;
}

export interface Logger {
  log(message: string): void;
}
`;

const APP_CLOCK = `import type { Clock } from "../contracts.js";

export const buildClock = (): Clock => ({ now: () => 0 });
`;

const APP_LOGGER = `import type { Logger } from "../contracts.js";

export const buildLogger = (): Logger => ({ log: () => undefined });
`;

/** A local logger whose shape does NOT satisfy what the library demands under the same key. */
const APP_DIVERGENT_LOGGER = `import type { Logger } from "../contracts.js";

export const buildLogger = (): Logger => ({ log: () => undefined });
`;

const appIocConfig = (options: {
  readonly composed?: readonly string[];
  readonly extra?: string;
}): string =>
  `import { defineIocConfig } from "${iocManifestIndex}";

export default defineIocConfig({
  discovery: {
    scanDirs: ["src/factories"],
    generatedDir: "src/generated",
    includes: ["**/*.{ts,tsx}"],
  },${
    options.composed !== undefined
      ? `\n  composedManifests: ${JSON.stringify(options.composed)},`
      : ""
  }${options.extra ?? ""}
});
`;

/** A library manifest as the generator emits one, with full unit identity on each implementation. */
const libManifest = (
  contracts: string,
  version: number = MANIFEST_SCHEMA_VERSION,
): string => `export const iocManifest = {
  manifestSchemaVersion: ${version},
  moduleImports: [],
  contracts: { ${contracts} },
};
`;

const libImpl = (
  registrationKey: string,
  extra = "",
): string =>
  `{ registrationKey: ${JSON.stringify(registrationKey)}, exportName: ${JSON.stringify(
    `build${registrationKey.charAt(0).toUpperCase()}${registrationKey.slice(1)}`,
  )}, modulePath: ${JSON.stringify(`${registrationKey}.ts`)}${extra} }`;

const libRegistryTypes = (cradle: string, externals: string): string =>
  `export interface IocGeneratedCradle {
${cradle}
}

export interface IocExternals {
${externals}
}
`;

type LibraryFixture = {
  readonly name: string;
  readonly manifest: string;
  readonly registryTypes: string;
};

/** A library that demands `logger` from whoever composes it, and supplies a `mailer`. */
const healthyLibrary = (): LibraryFixture => ({
  name: LIB,
  manifest: libManifest(`Mailer: { smtp: ${libImpl("mailer")} }`),
  registryTypes: libRegistryTypes(
    "  mailer: { send(to: string): void };",
    "  logger: { log(message: string): void };",
  ),
});

type FixtureOptions = {
  readonly libraries?: readonly LibraryFixture[];
  readonly composed?: readonly string[];
  /** Extra `ioc.config.ts` body, appended inside `defineIocConfig({...})`. */
  readonly configExtra?: string;
  readonly factories?: Readonly<Record<string, string>>;
  /** Library mode: no `composedManifests` key at all. */
  readonly libraryMode?: boolean;
  /** Compiler options merged over the fixture default. */
  readonly compilerOptions?: Readonly<Record<string, unknown>>;
};

type Fixture = {
  readonly projectRoot: string;
  readonly configPath: string;
  readonly generatedDir: string;
};

const buildAppFixture = (options?: FixtureOptions): Fixture => {
  const projectRoot = realpathSync(
    mkdtempSync(path.join(tmpdir(), "ioc-composition-gen-")),
  );
  const srcDir = path.join(projectRoot, "src");
  const factoriesDir = path.join(srcDir, "factories");
  mkdirSync(factoriesDir, { recursive: true });

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "@test/app", type: "module" }),
  );
  writeFileSync(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify(
      {
        ...TSCONFIG,
        compilerOptions: {
          ...TSCONFIG.compilerOptions,
          ...(options?.compilerOptions ?? {}),
        },
      },
      null,
      2,
    ),
  );

  for (const lib of options?.libraries ?? []) {
    const pkgDir = path.join(projectRoot, "node_modules", ...lib.name.split("/"));
    mkdirSync(path.join(pkgDir, "generated"), { recursive: true });
    writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: lib.name,
        type: "module",
        exports: {
          "./iocManifest": {
            types: "./generated/ioc-manifest.ts",
            import: "./generated/ioc-manifest.ts",
          },
          "./iocTypes": {
            types: "./generated/ioc-registry.types.ts",
            import: "./generated/ioc-registry.types.ts",
          },
        },
      }),
    );
    writeFileSync(
      path.join(pkgDir, "generated", "ioc-manifest.ts"),
      lib.manifest,
    );
    writeFileSync(
      path.join(pkgDir, "generated", "ioc-registry.types.ts"),
      lib.registryTypes,
    );
  }

  writeFileSync(path.join(srcDir, "contracts.ts"), APP_CONTRACTS);
  const factories = options?.factories ?? { "buildClock.ts": APP_CLOCK };
  for (const [name, source] of Object.entries(factories)) {
    writeFileSync(path.join(factoriesDir, name), source);
  }

  const configPath = path.join(srcDir, "ioc.config.ts");
  writeFileSync(
    configPath,
    options?.libraryMode === true
      ? appIocConfig({ ...(options.configExtra !== undefined ? { extra: options.configExtra } : {}) })
      : appIocConfig({
          composed: options?.composed ?? [LIB],
          ...(options?.configExtra !== undefined
            ? { extra: options.configExtra }
            : {}),
        }),
  );

  return {
    projectRoot,
    configPath,
    generatedDir: path.join(srcDir, "generated"),
  };
};

const generate = async (fixture: Fixture): Promise<void> => {
  await generateManifest({
    paths: { projectRoot: fixture.projectRoot },
    iocConfigPath: fixture.configPath,
  });
};

const generateExpectingFailure = async (fixture: Fixture): Promise<string> => {
  try {
    await generate(fixture);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  assert.fail("generation should have failed on composition errors");
};

const generatedFiles = (fixture: Fixture): string[] =>
  existsSync(fixture.generatedDir)
    ? readdirSync(fixture.generatedDir).sort((a, b) => a.localeCompare(b))
    : [];

/** The same fixture through `ioc validate`, for the parity assertions. */
const validateFixture = async (fixture: Fixture) => {
  const config = await tryLoadIocConfig(fixture.configPath);
  assert.ok(config !== undefined);
  return runValidate({
    projectRoot: fixture.projectRoot,
    configPath: fixture.configPath,
    config: config!,
    json: false,
  });
};

const validateSummaries = async (fixture: Fixture): Promise<string[]> => {
  const result = await validateFixture(fixture);
  assert.equal(result.kind, "report");
  return result.kind === "report"
    ? result.report.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.summary)
    : [];
};

describe("app-mode generation runs the composition suite", () => {
  describe("When the composed picture is healthy", () => {
    it("should write the same output the suite-free pipeline wrote", async () => {
      const fixture = buildAppFixture({
        libraries: [healthyLibrary()],
        factories: { "buildClock.ts": APP_CLOCK, "buildLogger.ts": APP_LOGGER },
      });

      await generate(fixture);
      const first = generatedFiles(fixture).map((name) => [
        name,
        readFileSync(path.join(fixture.generatedDir, name), "utf8"),
      ]);
      assert.deepEqual(
        first.map(([name]) => name),
        ["ioc-composed.ts", "ioc-manifest.ts", "ioc-registry.types.ts"],
      );

      // Byte-identical across a second run: the suite reads, it never writes, and it does not
      // perturb what emission produced.
      await generate(fixture);
      const second = generatedFiles(fixture).map((name) => [
        name,
        readFileSync(path.join(fixture.generatedDir, name), "utf8"),
      ]);
      assert.deepEqual(second, first);

      const validated = await validateFixture(fixture);
      assert.equal(validated.kind, "report");
      if (validated.kind === "report") {
        assert.equal(validated.report.errorCount, 0);
      }
    });
  });

  describe("When the composed set carries several classes of error at once", () => {
    /**
     * Four offenders in one fixture, one per class the suite adjudicates:
     *
     * - an UNSATISFIED external (`apiKey`, demanded by the library, supplied by nobody),
     * - a TYPE-INCOMPATIBLE supply (`logger`: the app supplies a `Logger`, the library demands a
     *   wider shape),
     * - a composed DEFAULT AMBIGUITY on an UNGROUPED contract (`Mailer`, two implementations, no
     *   `default: true`, no convention key),
     * - a stale SCHEMA VERSION on a second library.
     */
    const brokenFixture = (): Fixture =>
      buildAppFixture({
        composed: [LIB, "@test/stale"],
        libraries: [
          {
            name: LIB,
            manifest: libManifest(
              `Mailer: { smtp: ${libImpl("smtpMailer")}, ses: ${libImpl("sesMailer")} }`,
            ),
            registryTypes: libRegistryTypes(
              "  smtpMailer: { send(to: string): void };\n  sesMailer: { send(to: string): void };",
              "  apiKey: string;\n  logger: { log(message: string): void; child(name: string): unknown };",
            ),
          },
          {
            name: "@test/stale",
            manifest: libManifest(`Cache: { memory: ${libImpl("cache")} }`, 1),
            registryTypes: libRegistryTypes("  cache: { get(k: string): unknown };", ""),
          },
        ],
        factories: {
          "buildClock.ts": APP_CLOCK,
          "buildLogger.ts": APP_DIVERGENT_LOGGER,
        },
      });

    it("should fail generation with every offender in ONE aggregated report", async () => {
      const fixture = brokenFixture();
      const message = await generateExpectingFailure(fixture);

      assert.match(message, /App-mode generation refused/);
      assert.match(message, /\[externals\].*"apiKey"/s);
      assert.match(message, /\[externals\].*"logger"/s);
      assert.match(message, /incompatible/i);
      assert.match(message, /\[default-ambiguity\]/);
      assert.match(message, /\[schema-version\]/);
      assert.match(message, /No files were written/);
    });

    it("should write no output at all", async () => {
      const fixture = brokenFixture();
      await generateExpectingFailure(fixture);

      assert.deepEqual(
        generatedFiles(fixture).filter((f) => f.startsWith("ioc-")),
        [],
      );
    });

    it("should reach the same verdicts through validate", async () => {
      // Validate reads committed artifacts, so the fixture is generated green first, then broken.
      // What is pinned is the OUTPUT — the same error summaries, from the same shared module.
      const fixture = brokenFixture();
      const genMessage = await generateExpectingFailure(fixture);

      // Give validate something to read: emit the local artifacts with the suite unable to run
      // (library mode), then restore the app config so validate composes.
      const libraryConfig = appIocConfig({});
      writeFileSync(fixture.configPath, libraryConfig);
      await generate(fixture);
      writeFileSync(
        fixture.configPath,
        appIocConfig({ composed: [LIB, "@test/stale"] }),
      );

      const summaries = await validateSummaries(fixture);
      assert.ok(
        summaries.length >= 3,
        `validate should report the same offenders, got ${summaries.length}`,
      );
      for (const summary of summaries) {
        assert.ok(
          genMessage.includes(summary),
          `gen's report should carry validate's finding: ${summary}`,
        );
      }
    });
  });

  describe("When a composed registry file does not compile", () => {
    it("should fail on the integrity error and report the comparisons it skipped", async () => {
      const fixture = buildAppFixture({
        libraries: [
          {
            name: LIB,
            manifest: libManifest(`Mailer: { smtp: ${libImpl("mailer")} }`),
            // `MissingLogger` is bound to nothing. Before the integrity gate this resolved to an
            // error type, and every comparison against an error type passes.
            registryTypes: libRegistryTypes(
              "  mailer: MissingLogger;",
              "  logger: { log(message: string): void };",
            ),
          },
        ],
        factories: { "buildClock.ts": APP_CLOCK, "buildLogger.ts": APP_LOGGER },
      });

      const message = await generateExpectingFailure(fixture);

      assert.match(message, /\[registry-integrity\]/);
      assert.match(message, /do not compile/);
      assert.match(message, /TS2304/);
      // The tainted-skip semantics carry into generation as part of the failure report: the
      // comparisons the gate withheld are named, so a red gen never reads as coverage it did
      // not have.
      assert.match(message, /Skipped \d+ externals type comparison/);
      assert.match(message, /"logger".*tainted by/);
      assert.deepEqual(
        generatedFiles(fixture).filter((f) => f.startsWith("ioc-")),
        [],
      );
    });
  });

  describe("When the only finding is warning-severity", () => {
    it("should warn and let generation through", async () => {
      /**
       * A demanded key with NO readable type: the composed package's `IocExternals` declares
       * `logger` with no annotation at all. The syntactic pass still sees the key — it is a
       * demand — but the checker has no type node to read, so no verdict can be reached and the
       * suite says exactly that instead of guessing. Warning, not error: an unverifiable
       * comparison is not a failed one.
       *
       * `noImplicitAny` is off for this fixture only, so the shape is a missing type rather than a
       * compile error, which would be a `[registry-integrity]` failure and a different test.
       */
      const fixture = buildAppFixture({
        compilerOptions: { strict: false, noImplicitAny: false },
        libraries: [
          {
            name: LIB,
            manifest: libManifest(`Mailer: { smtp: ${libImpl("mailer")} }`),
            registryTypes: `export interface IocGeneratedCradle {
  mailer: { send(to: string): void };
}

export interface IocExternals {
  logger;
}
`,
          },
        ],
        factories: { "buildClock.ts": APP_CLOCK, "buildLogger.ts": APP_LOGGER },
      });

      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
      };
      try {
        await generate(fixture);
      } finally {
        console.warn = originalWarn;
      }

      assert.ok(
        generatedFiles(fixture).includes("ioc-manifest.ts"),
        "a warning must not stop generation",
      );

      const validated = await validateFixture(fixture);
      assert.equal(validated.kind, "report");
      if (validated.kind === "report") {
        // Severity parity, both directions: validate calls this a warning and no error, and gen
        // printed the same finding as a warning rather than refusing.
        assert.equal(validated.report.errorCount, 0);
        assert.ok(validated.report.warningCount > 0);
      }
      assert.ok(
        warnings.some((w) => w.includes("Composition checks")),
        `gen should have warned; captured: ${JSON.stringify(warnings)}`,
      );
    });
  });

  describe("When the package is in library mode", () => {
    it("should run no composition checks and emit unchanged output", async () => {
      const fixture = buildAppFixture({
        libraryMode: true,
        factories: { "buildClock.ts": APP_CLOCK },
      });

      await generate(fixture);
      const files = generatedFiles(fixture);
      assert.deepEqual(files, ["ioc-manifest.ts", "ioc-registry.types.ts"]);
      assert.ok(
        !existsSync(path.join(fixture.generatedDir, "ioc-composed.ts")),
        "library mode emits no composed manifest",
      );

      // The information the suite needs does not exist here: a library's `IocExternals` is a
      // promise to whichever app composes it later, and no composed set is present to judge it
      // against. Validate says the same thing about the same config.
      const config = await tryLoadIocConfig(fixture.configPath);
      const validated = await runValidate({
        projectRoot: fixture.projectRoot,
        configPath: fixture.configPath,
        config: config!,
        json: false,
      });
      assert.equal(validated.kind, "library-mode");

      rmSync(fixture.projectRoot, { recursive: true, force: true });
    });
  });
});
