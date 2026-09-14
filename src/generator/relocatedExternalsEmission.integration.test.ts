/**
 * The emitted assertion for a scope-reachable external MOVES rather than vanishes.
 *
 * The gap this closes: composition learned to clear an external whose every resolution path crosses
 * a scope boundary, but `ioc-composed.ts` went on asserting that same key sits in `AppCradle` — a
 * thing that can never be true, since a value bound at scope-open never enters the root cradle. So
 * `ioc generate` passed and `tsc` over that run's own output failed.
 *
 * The assertion is now restated where the obligation actually lands: against the declared late-bound
 * values of each opener that reaches the key. That is strictly MORE than the guard it replaces —
 * `verifyScopeRoots` type-checks a declared lbv against LOCAL demand sites only, and returns early
 * for composed units because a manifest records demand keys and never demand types. Here both types
 * are in scope, so a variant declaring `logContext: string` against a demanded
 * `Record<string, unknown>` is caught for the first time.
 *
 * Every case below compiles the emitted file with a real program and reads real diagnostics: an
 * assertion nobody compiles is a comment.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { generateManifest } from "./generateManifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iocManifestIndex = path
  .join(__dirname, "../index.js")
  .replace(/\\/g, "/");

const LIB = "@test/lib-infra";

/**
 * The library half: a scoped logger demanding a per-request `logContext` it declares external.
 *
 * This is the shape the whole feature exists for — a shared package owning a factory whose
 * dependency only exists inside a scope — and the shape composition refused outright before it.
 */
const LIB_MANIFEST = `export const iocManifest = {
  manifestSchemaVersion: 3,
  moduleImports: [],
  contracts: {
    ScopedLogger: {
      scopedLogger: {
        exportName: "build__ScopedLogger",
        registrationKey: "scopedLogger",
        modulePath: "logger/scopedLogger.ts",
        relImport: "../logger/scopedLogger.js",
        contractName: "ScopedLogger",
        implementationName: "scopedLogger",
        lifetime: "scoped",
        moduleIndex: 0,
        default: true,
        dependencyKeys: ["logContext"],
      },
    },
  },
};

export const IOC_MANIFEST_FEATURES = [
  "dependencyKeys",
  "dependencyKeysComplete",
  "lifetimeSource",
] as const;
`;

const LIB_TYPES = `export interface IocGeneratedCradle {
  scopedLogger: { info(message: string): void };
}

export interface IocExternals {
  logContext: Record<string, unknown>;
}
`;

const APP_CONTRACTS = `export interface ViewerService {
  read(): string;
}

export interface HttpServer {
  listen(): void;
}

export interface RequestContext {
  handle(): string;
}
`;

/** Root-side, reaching nothing in the library — so the root walk has a seed and clears nothing. */
const APP_HTTP_SERVER = `import type { HttpServer } from "../contracts.js";

export const buildHttpServer = (): HttpServer => ({ listen: () => {} });
`;

/** Under the scope only: the single edge that carries the subtree into the library. */
const APP_VIEWER_SERVICE = `import type { ViewerService } from "../contracts.js";

type Deps = { scopedLogger: { info(message: string): void } };

export const buildViewerService = ({ scopedLogger }: Deps): ViewerService => ({
  read: () => {
    scopedLogger.info("read");
    return "ok";
  },
});
`;

type VariantSpec = {
  /** File-name-safe identifier; also the exported factory's suffix. */
  readonly name: string;
  /** The lbv type argument, verbatim. `""` emits the one-argument `ScopeRoot<C>` form. */
  readonly lbv: string;
  /** Cradle keys the variant destructures. */
  readonly demands: readonly string[];
};

const appScopeRootSource = (variants: readonly VariantSpec[]): string =>
  [
    `import type { ScopeRoot } from "${path.join(__dirname, "../scopeRoots/scopeRoot.js").replace(/\\/g, "/")}";`,
    `import type { RequestContext, ViewerService } from "../contracts.js";`,
    "",
    ...variants.map((variant) => {
      // A NAMED local deps type, never an inline object literal: discovery refuses the inline form
      // outright (`analyzeDemandSupply`), so a fixture written that way never reaches emission.
      const depsType = `type ${variant.name}Deps = { ${variant.demands
        .map((key) => `${key}: ViewerService`)
        .join("; ")} };`;
      const deps =
        variant.demands.length === 0
          ? "()"
          : `({ ${variant.demands.join(", ")} }: ${variant.name}Deps)`;
      const lbvArg = variant.lbv === "" ? "" : `, ${variant.lbv}`;
      return [
        ...(variant.demands.length === 0 ? [] : [depsType]),
        `export const build${variant.name} = ${deps}: ScopeRoot<RequestContext${lbvArg}> => ({`,
        `  handle: () => "${variant.name}",`,
        `});`,
        "",
      ].join("\n");
    }),
  ].join("\n");

type FixtureOptions = {
  /** `ioc.config.scopeProvided` for the fixture app. */
  readonly scopeProvided?: readonly string[];
  /**
   * Leaves out the one app factory that reaches the library — the worker half of the worker/api
   * split.
   *
   * Without it nothing local demands `scopedLogger`, so no path reaches `logContext` at all, and
   * the key's fate rests entirely on the lifetime its only demander records.
   */
  readonly omitViewerService?: boolean;
};

const appIocConfig = (options?: FixtureOptions): string => `import { defineIocConfig } from "${iocManifestIndex}";

export default defineIocConfig({
  discovery: {
    scanDirs: ["src/factories"],
    generatedDir: "src/generated",
    includes: ["**/*.{ts,tsx}"],
  },
  composedManifests: ${JSON.stringify([LIB])},${
    options?.scopeProvided === undefined
      ? ""
      : `\n  scopeProvided: ${JSON.stringify(options.scopeProvided)},`
  }${
    options?.omitViewerService === true
      ? ""
      : `\n  registrations: {\n    ViewerService: { viewerService: { lifetime: "scoped" } },\n  },`
  }
});
`;

type Fixture = {
  readonly projectRoot: string;
  readonly configPath: string;
  readonly generatedDir: string;
  readonly srcDir: string;
};

const buildFixture = (
  variants: readonly VariantSpec[],
  options?: FixtureOptions,
): Fixture => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "ioc-relocated-"));
  const srcDir = path.join(projectRoot, "src");
  const factoriesDir = path.join(srcDir, "factories");
  mkdirSync(factoriesDir, { recursive: true });

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "@test/app", type: "module" }),
  );
  writeFileSync(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "Node16",
        moduleResolution: "Node16",
        lib: ["ES2022"],
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        baseUrl: ".",
        // The generated artifacts import `ioc-manifest` itself. The fixture is a temp dir with no
        // install, so the package under test is mapped straight at its sources.
        paths: {
          "ioc-manifest": [
            path.join(__dirname, "../index.ts").replace(/\\/g, "/"),
          ],
        },
      },
      include: ["src/**/*.ts"],
    }),
  );

  const pkgDir = path.join(projectRoot, "node_modules", ...LIB.split("/"));
  mkdirSync(path.join(pkgDir, "generated"), { recursive: true });
  writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: LIB,
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
  writeFileSync(path.join(pkgDir, "generated", "ioc-manifest.ts"), LIB_MANIFEST);
  writeFileSync(
    path.join(pkgDir, "generated", "ioc-registry.types.ts"),
    LIB_TYPES,
  );

  writeFileSync(path.join(srcDir, "contracts.ts"), APP_CONTRACTS);
  writeFileSync(path.join(factoriesDir, "buildHttpServer.ts"), APP_HTTP_SERVER);
  if (options?.omitViewerService !== true) {
    writeFileSync(
      path.join(factoriesDir, "buildViewerService.ts"),
      APP_VIEWER_SERVICE,
    );
  }
  writeFileSync(
    path.join(factoriesDir, "scopeRoots.ts"),
    appScopeRootSource(variants),
  );

  const configPath = path.join(srcDir, "ioc.config.ts");
  writeFileSync(configPath, appIocConfig(options));

  return {
    projectRoot,
    configPath,
    generatedDir: path.join(srcDir, "generated"),
    srcDir,
  };
};

const generate = async (fixture: Fixture): Promise<void> => {
  await generateManifest({
    paths: { projectRoot: fixture.projectRoot },
    iocConfigPath: fixture.configPath,
  });
};

const composedSource = (fixture: Fixture): string =>
  readFileSync(path.join(fixture.generatedDir, "ioc-composed.ts"), "utf8");

/**
 * The emitted source with runs of whitespace collapsed.
 *
 * Generated artifacts are formatted through prettier's API on the way out, so the emitter's line
 * breaks are not the file's line breaks — and prettier also normalises away quoted property names
 * and redundant parentheses. Asserting on collapsed text pins the TYPE that was emitted without
 * pinning a layout this test does not own.
 */
const collapsed = (fixture: Fixture): string =>
  composedSource(fixture).replace(/\s+/g, " ");

/**
 * The emitted file through a real program, with real diagnostics.
 *
 * `ts.formatDiagnostics` rather than a hand-rolled message: what a reader will actually see when
 * one of these assertions goes red is `tsc` output, and a test that reformats it is testing
 * something nobody reads.
 */
const typecheck = (fixture: Fixture): string => {
  const configFile = ts.readConfigFile(
    path.join(fixture.projectRoot, "tsconfig.json"),
    ts.sys.readFile,
  );
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    fixture.projectRoot,
  );
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });
  const diagnostics = [
    ...program.getSemanticDiagnostics(),
    ...program.getSyntacticDiagnostics(),
  ];
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => fixture.projectRoot,
    getNewLine: () => "\n",
  });
};

const SATISFYING_VARIANT: VariantSpec = {
  name: "RequestScope",
  lbv: "{ logContext: Record<string, unknown> }",
  demands: ["viewerService"],
};

describe("relocated externals in ioc-composed.ts", () => {
  describe("When one variant reaches the key and declares it compatibly", () => {
    it("should assert against the opener instead of the cradle", async () => {
      const fixture = buildFixture([SATISFYING_VARIANT]);
      await generate(fixture);
      const source = collapsed(fixture);

      // Read the emitted type through the shape it is made of, not through one long literal: the
      // failure branches are object types and prettier lays them out over several lines.
      assert.ok(
        source.includes(
          'type _LibInfra_logContext_at_openRequestScopeScope = Parameters< AppCradle["openRequestScopeScope"] >[0] extends { logContext: infer T } ? T extends LibInfraExternals["logContext"] ? true :',
        ),
        `relocated assertion not found in:\n${composedSource(fixture)}`,
      );
      assert.ok(
        source.includes(
          "type _LibInfra_logContext_at_openRequestScopeScopeAssert = _IocExpect<_LibInfra_logContext_at_openRequestScopeScope>;",
        ),
      );
      // Both failure branches carry their cause rather than collapsing to a bare `false`.
      assert.ok(
        source.includes(
          'iocError: "the declared late-bound value is not assignable to the demanded type"; key: "logContext"; opener: "openRequestScopeScope"; package: "@test/lib-infra";',
        ),
      );
      assert.ok(
        source.includes(
          'iocError: "this scope opener does not declare the key"; key: "logContext"; opener: "openRequestScopeScope"; package: "@test/lib-infra";',
        ),
      );
      // The key is gone from the cradle side entirely — it was the only external, so there is no
      // pick left to emit.
      assert.doesNotMatch(source, /_LibInfraExternalsPick/);
    });

    it("should compile clean", async () => {
      const fixture = buildFixture([SATISFYING_VARIANT]);
      await generate(fixture);
      assert.equal(typecheck(fixture), "");
    });
  });

  describe("When the reaching variant declares an incompatible type", () => {
    /**
     * The legibility case. `logContext: string` against a demanded `Record<string, unknown>` is
     * exactly the mistake the relocated assertion exists to catch, and the one `verifyScopeRoots`
     * structurally cannot — the demand lives in a composed manifest, which records keys and not
     * types.
     */
    it("should fail the typecheck at the relocated assertion", async () => {
      const fixture = buildFixture([
        { ...SATISFYING_VARIANT, lbv: "{ logContext: string }" },
      ]);
      await generate(fixture);

      const output = typecheck(fixture);

      assert.match(output, /ioc-composed\.ts/);
      assert.match(output, /error TS2344/);
      // The whole point of the object failure branches: the diagnostic names WHICH of the two ways
      // of being wrong this is, and for which key, opener and package. A bare `false` branch gives
      // the reader "Type 'false' does not satisfy the constraint 'true'" and nothing else.
      assert.match(
        output,
        /iocError: "the declared late-bound value is not assignable to the demanded type"/,
      );
      assert.match(output, /key: "logContext"/);
      assert.match(output, /opener: "openRequestScopeScope"/);
      assert.match(output, /package: "@test\/lib-infra"/);
    });
  });

  describe("When a reaching variant declares an empty late-bound-value set", () => {
    it("should refuse the run at the externals check, before emission", async () => {
      const fixture = buildFixture([
        { name: "PublicScope", lbv: "", demands: ["viewerService"] },
      ]);

      // A variant that reaches the key and does not carry it is an ERROR, and generation never
      // reaches emission — which is why an empty-lbv opener is never handed a relocated assertion
      // through the ordinary path.
      // Scope-root verification runs BEFORE the composition suite, so it is the one that speaks
      // here — a sharper message than the composition-side finding, naming the variant and the
      // exact type argument to edit. `ioc validate`, which runs no scope-root pass, reaches the
      // same conclusion through the `[externals]` check instead.
      await assert.rejects(generate(fixture), (error: Error) => {
        assert.match(error.message, /scope-root verification failure/);
        assert.match(
          error.message,
          /variant "publicScope".*demands "logContext"/s,
        );
        return true;
      });
    });

  });

  describe("When several variants reach the key", () => {
    it("should emit one assertion per reaching variant", async () => {
      const fixture = buildFixture([
        { ...SATISFYING_VARIANT, name: "ReadScope" },
        { ...SATISFYING_VARIANT, name: "WriteScope" },
        { ...SATISFYING_VARIANT, name: "AdminScope" },
        { ...SATISFYING_VARIANT, name: "JobScope" },
      ]);
      await generate(fixture);
      const source = collapsed(fixture);

      for (const opener of [
        "openReadScopeScope",
        "openWriteScopeScope",
        "openAdminScopeScope",
        "openJobScopeScope",
      ]) {
        assert.match(
          source,
          new RegExp(`_LibInfra_logContext_at_${opener}Assert`),
          `expected an assertion for ${opener}`,
        );
      }
      assert.equal(typecheck(fixture), "");
    });
  });

  /**
   * The worker half of the worker/api split, with the same library both consumers compose.
   *
   * `LIB_MANIFEST` records `lifetime: "scoped"` on its only demander of `logContext`. A consumer
   * that opens no scope and never resolves through the logger therefore reaches the key by no path
   * at all — and because a root resolve cannot reach a scoped factory, an unrecorded bootstrap
   * resolve cannot be hiding one either. The key is cleared.
   *
   * Compiled with a real program, because that is the half that used to break: a check that clears
   * a key while the emitted `Pick<AppCradle, …>` still names it is a green generate and a red tsc
   * over the same run's output.
   */
  describe("When no path reaches the key and its only demander is scoped", () => {
    it("should drop the key from the cradle pick with no assertion", async () => {
      const fixture = buildFixture([], { omitViewerService: true });
      await generate(fixture);
      const source = collapsed(fixture);

      assert.doesNotMatch(source, /_LibInfraExternalsPick/);
      assert.doesNotMatch(source, /_LibInfra_logContext/);
      // The comment above a cleared key says what is true of it. "Carried at the scope boundary" is
      // the one thing it is NOT — no scope carries it, because no scope reaches it.
      assert.ok(
        source.includes(
          '// "logContext" is demanded only by scoped factories and no resolution path // reaches it, so the root container is never asked for it and there is nothing to assert.',
        ),
        `cleared-key comment not found in:\n${composedSource(fixture)}`,
      );
    });

    it("should compile clean", async () => {
      const fixture = buildFixture([], { omitViewerService: true });
      await generate(fixture);
      assert.equal(typecheck(fixture), "");
    });

    /**
     * The api half, from the same library manifest: the key is reached under a scope, so it
     * relocates to the opener exactly as before. The carve-out changes nothing here.
     */
    it("should still relocate the key in a consumer whose scope reaches it", async () => {
      const fixture = buildFixture([SATISFYING_VARIANT]);
      await generate(fixture);
      const source = collapsed(fixture);

      assert.match(source, /_LibInfra_logContext_at_openRequestScopeScopeAssert/);
      assert.ok(
        source.includes(
          '// "logContext" is carried at the scope boundary, not by the root container —',
        ),
      );
      assert.equal(typecheck(fixture), "");
    });
  });

  describe("When a variant is renamed", () => {
    /**
     * The relocated assertion names an opener cradle key, so the composed file now depends on
     * opener NAMES as well as on cradle shapes. Renaming a variant moves its opener key and both
     * files move together — pinned here so the coupling is a decision rather than a surprise.
     */
    it("should move the assertion with the opener key", async () => {
      const before = buildFixture([{ ...SATISFYING_VARIANT, name: "OldScope" }]);
      await generate(before);
      assert.match(collapsed(before), /AppCradle\["openOldScopeScope"\]/);

      const after = buildFixture([{ ...SATISFYING_VARIANT, name: "NewScope" }]);
      await generate(after);
      const source = collapsed(after);
      assert.match(source, /AppCradle\["openNewScopeScope"\]/);
      assert.doesNotMatch(source, /openOldScopeScope/);
      assert.equal(typecheck(after), "");
    });
  });
});
