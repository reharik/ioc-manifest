/**
 * @fileoverview The two worlds, finally both labelled.
 *
 * `ioc generate` describes LIVE SOURCE and refuses to write when it finds a hard error.
 * `ioc validate` describes THE ARTIFACTS — the last successful write. Both are correct; they are
 * correct about different moments. Nothing said so, and the field consequence was a developer
 * watching generation refuse a demand for a grouped member, then watching validate describe the
 * same key as an ordinary unsatisfied external: two true stories with no reconciliation cue.
 *
 * The end of this file is the whole point: one screen in which generation has failed, the marker
 * records it, and validate prints its staleness banner ABOVE the grouped-member guidance it now
 * gives for the same key. Both worlds labelled, in the order a reader needs them.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";
import { tryLoadIocConfig } from "../config/loadIocConfig.js";
import { runValidate } from "../validate/runValidate.js";
import {
  IOC_GENERATION_STATE_FILENAME,
  generationStatePathFor,
  readGenerationRecord,
  readGenerationState,
} from "../diagnostics/generationState.js";
import { formatValidationReportJson } from "../composition/compositionReport.js";
import { generateManifest } from "./generateManifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iocManifestIndex = path
  .join(__dirname, "../index.js")
  .replace(/\\/g, "/");

const LIB = "@media/core";

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

const APP_CONTRACTS = `export interface WriteService {
  run(input: string): string;
}

export interface ActivatePendingUserWriteService extends WriteService {
  readonly op: "activate";
}

export interface AuthService {
  authenticate(token: string): string;
}
`;

/** The app factory that demands the library's implementation by its bare registration key. */
const APP_AUTH_SERVICE = `import type {
  ActivatePendingUserWriteService,
  AuthService,
} from "../contracts.js";

type Deps = {
  activatePendingUserWriteService: ActivatePendingUserWriteService;
};

export const buildAuthService = ({
  activatePendingUserWriteService,
}: Deps): AuthService => ({
  authenticate: (token: string) =>
    activatePendingUserWriteService.run(token),
});
`;

const libImpl = (extra: string): string => `{
        exportName: "buildActivatePendingUserWriteService",
        registrationKey: "activatePendingUserWriteService",
        modulePath: "services/buildActivatePendingUserWriteService.ts",
        relImport: "../services/buildActivatePendingUserWriteService.js",
        contractName: "ActivatePendingUserWriteService",
        implementationName: "activatePendingUserWriteService",
        lifetime: "singleton",
        moduleIndex: 0,${extra}
        dependencyKeys: [],
      }`;

/** Elected default: the contract has a slot key, and a bare demand for it is legal. */
const LIB_IMPL_DEFAULT = libImpl("\n        default: true,");

/** Grouped: no election, no slot key, no individual cradle key. */
const LIB_IMPL = libImpl("");

/**
 * The library BEFORE the regrouping.
 *
 * The implementation is the contract's ELECTED DEFAULT, so the contract has a slot key
 * (`activatePendingUserWriteService`, the camel-cased contract name) and the app's bare demand for
 * it is row one of the demand model — the ordinary, legal spelling. Regrouping is what takes the
 * slot away: a grouped contract elects no default, which is why the grouped manifest below drops
 * the flag.
 */
const LIB_MANIFEST_UNGROUPED = `export const iocManifest = {
  manifestSchemaVersion: ${MANIFEST_SCHEMA_VERSION},
  moduleImports: [],
  contracts: {
    ActivatePendingUserWriteService: {
      activatePendingUserWriteService: ${LIB_IMPL_DEFAULT},
    },
  },
};

export const IOC_MANIFEST_FEATURES = ["dependencyKeys"] as const;
`;

/** The library AFTER the regrouping: the same contract is now a member of `writeServices`. */
const LIB_MANIFEST_GROUPED = `export const iocManifest = {
  manifestSchemaVersion: ${MANIFEST_SCHEMA_VERSION},
  moduleImports: [],
  contracts: {
    ActivatePendingUserWriteService: {
      activatePendingUserWriteService: ${LIB_IMPL},
    },
  },
  writeServices: {
    kind: "object",
    baseType: "WriteService",
    baseTypeId: "@media/core/src/types/WriteService.ts:WriteService",
    members: {
      activatePendingUserWriteService: {
        contractName: "ActivatePendingUserWriteService",
        registrationKey: "activatePendingUserWriteService",
      },
    },
  },
};

export const IOC_MANIFEST_FEATURES = ["dependencyKeys"] as const;
`;

const libRegistryTypes = (cradle: string): string =>
  `export interface IocGeneratedCradle {
${cradle}
}

export interface IocExternals {
}
`;

const LIB_TYPES_UNGROUPED = libRegistryTypes(
  '  activatePendingUserWriteService: { run(input: string): string; readonly op: "activate" };',
);

/** Once grouped, the member claims no cradle key of its own — only the group root does. */
const LIB_TYPES_GROUPED = libRegistryTypes(
  '  writeServices: { activatePendingUserWriteService: { run(input: string): string; readonly op: "activate" } };',
);

const appIocConfig = `import { defineIocConfig } from "${iocManifestIndex}";

export default defineIocConfig({
  packageName: "@apps/api",
  discovery: {
    scanDirs: ["src/factories"],
    generatedDir: "src/generated",
    includes: ["**/*.{ts,tsx}"],
  },
  composedManifests: ${JSON.stringify([LIB])},
});
`;

type Fixture = {
  readonly projectRoot: string;
  readonly configPath: string;
  readonly generatedDir: string;
  readonly markerPath: string;
  /** Swaps the library's published artifacts to the grouped ones — the drift the app has not seen. */
  readonly regroupLibrary: () => void;
};

const buildFixture = (): Fixture => {
  const projectRoot = realpathSync(
    mkdtempSync(path.join(tmpdir(), "ioc-staleness-")),
  );
  const srcDir = path.join(projectRoot, "src");
  const factoriesDir = path.join(srcDir, "factories");
  mkdirSync(factoriesDir, { recursive: true });

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "@apps/api", type: "module" }),
  );
  writeFileSync(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify(TSCONFIG, null, 2),
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
  const libManifestPath = path.join(pkgDir, "generated", "ioc-manifest.ts");
  const libTypesPath = path.join(pkgDir, "generated", "ioc-registry.types.ts");
  writeFileSync(libManifestPath, LIB_MANIFEST_UNGROUPED);
  writeFileSync(libTypesPath, LIB_TYPES_UNGROUPED);

  writeFileSync(path.join(srcDir, "contracts.ts"), APP_CONTRACTS);
  writeFileSync(path.join(factoriesDir, "buildAuthService.ts"), APP_AUTH_SERVICE);

  const configPath = path.join(srcDir, "ioc.config.ts");
  writeFileSync(configPath, appIocConfig);

  const generatedDir = path.join(srcDir, "generated");
  return {
    projectRoot,
    configPath,
    generatedDir,
    markerPath: generationStatePathFor(generatedDir),
    regroupLibrary: () => {
      writeFileSync(libManifestPath, LIB_MANIFEST_GROUPED);
      writeFileSync(libTypesPath, LIB_TYPES_GROUPED);
    },
  };
};

const generate = (fixture: Fixture): Promise<void> =>
  generateManifest({
    paths: { projectRoot: fixture.projectRoot },
    iocConfigPath: fixture.configPath,
  });

const generateExpectingFailure = async (fixture: Fixture): Promise<string> => {
  try {
    await generate(fixture);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  assert.fail("generation should have failed");
};

const generatedFileNames = (fixture: Fixture): string[] =>
  existsSync(fixture.generatedDir)
    ? readdirSync(fixture.generatedDir).sort((a, b) => a.localeCompare(b))
    : [];

const generatedContents = (fixture: Fixture): Record<string, string> =>
  Object.fromEntries(
    generatedFileNames(fixture).map((name) => [
      name,
      readFileSync(path.join(fixture.generatedDir, name), "utf8"),
    ]),
  );

const CLI_ENTRY = path.join(__dirname, "../cli/ioc.ts");

/**
 * The real CLI over a fixture, so the banner is pinned where a developer actually meets it.
 *
 * `inspect` and `explain` build their reports from module-level state that a unit test cannot reach
 * without executing `main()`, and the property under test is precisely that the banner reaches the
 * terminal ahead of the report — which is a property of the process, not of a function.
 */
const runCli = (
  fixture: Fixture,
  args: readonly string[],
): { stdout: string; stderr: string } => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      CLI_ENTRY,
      ...args,
      "--config",
      fixture.configPath,
      "--project",
      fixture.projectRoot,
    ],
    {
      // The repo root, not the fixture: `--import tsx` resolves the loader from the working
      // directory, and a temp fixture has no node_modules of its own. Every path the CLI needs
      // comes from `--config` and `--project`, so the working directory is not under test.
      cwd: path.join(__dirname, "../.."),
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    },
  );
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

const validate = async (fixture: Fixture) => {
  const config = await tryLoadIocConfig(fixture.configPath);
  assert.ok(config !== undefined);
  return runValidate({
    projectRoot: fixture.projectRoot,
    configPath: fixture.configPath,
    config: config!,
    json: false,
  });
};

/** The stale workspace the field reported: green artifacts, then the library regroups underneath. */
const staleWorkspace = async (): Promise<{
  fixture: Fixture;
  before: Record<string, string>;
  genMessage: string;
}> => {
  const fixture = buildFixture();
  await generate(fixture);
  const before = generatedContents(fixture);

  fixture.regroupLibrary();
  const genMessage = await generateExpectingFailure(fixture);

  return { fixture, before, genMessage };
};

describe("a successful generation records its success", () => {
  describe("When generation succeeds", () => {
    it("should write the artifacts and a success record beside them", async () => {
      const fixture = buildFixture();
      await generate(fixture);

      assert.ok(generatedFileNames(fixture).includes("ioc-manifest.ts"));
      assert.equal(existsSync(fixture.markerPath), true);

      const record = readGenerationRecord(fixture.generatedDir)!;
      assert.equal(record.outcome, "success");
      assert.ok(!Number.isNaN(Date.parse(record.at)));
      assert.match(record.inputsHash!, /^sha256:[0-9a-f]{64}$/);

      // The staleness banner keys off FAILED and nothing else — unchanged by the record existing.
      assert.equal(readGenerationState(fixture.generatedDir), undefined);
    });

    it("should keep the record OUTSIDE the generated directory, so generated-diff stays zero", async () => {
      const fixture = buildFixture();
      await generate(fixture);

      assert.equal(
        generatedFileNames(fixture).includes(IOC_GENERATION_STATE_FILENAME),
        false,
        "a timestamped file inside the generated dir would break generated-diff-zero",
      );
      assert.equal(
        path.dirname(fixture.markerPath),
        path.dirname(fixture.generatedDir),
      );
    });
  });

  describe("When a failing generation is later fixed", () => {
    it("should replace the failure record in the same step that publishes the artifacts", async () => {
      const { fixture } = await staleWorkspace();
      assert.equal(existsSync(fixture.markerPath), true);
      assert.equal(readGenerationState(fixture.generatedDir)?.outcome, "failed");

      // Undo the drift and regenerate: success is what clears staleness, nothing else.
      writeFileSync(fixture.configPath, appIocConfig);
      const pkgDir = path.join(
        fixture.projectRoot,
        "node_modules",
        ...LIB.split("/"),
      );
      writeFileSync(
        path.join(pkgDir, "generated", "ioc-manifest.ts"),
        LIB_MANIFEST_UNGROUPED,
      );
      writeFileSync(
        path.join(pkgDir, "generated", "ioc-registry.types.ts"),
        LIB_TYPES_UNGROUPED,
      );
      await generate(fixture);

      // Not removed — replaced. Success is still what ends staleness; what changed is that the
      // successful run now leaves evidence of its own inputs behind.
      assert.equal(existsSync(fixture.markerPath), true);
      assert.equal(readGenerationRecord(fixture.generatedDir)?.outcome, "success");
      assert.equal(readGenerationState(fixture.generatedDir), undefined);
    });
  });
});

describe("a failing generation records the marker and touches nothing", () => {
  describe("When generation refuses to write", () => {
    it("should leave every artifact byte-identical", async () => {
      const { fixture, before } = await staleWorkspace();

      // The refuse-to-write semantics are unchanged; this pins that the marker did not weaken them.
      assert.deepEqual(generatedContents(fixture), before);
    });

    it("should place the marker OUTSIDE the generated directory", async () => {
      const { fixture } = await staleWorkspace();

      assert.equal(existsSync(fixture.markerPath), true);
      assert.equal(
        generatedFileNames(fixture).includes(IOC_GENERATION_STATE_FILENAME),
        false,
        "a timestamped file inside the generated dir would break generated-diff-zero",
      );
      assert.equal(
        path.dirname(fixture.markerPath),
        path.dirname(fixture.generatedDir),
      );
    });

    it("should record the outcome, a timestamp, the error count and an inputs hash", async () => {
      const { fixture } = await staleWorkspace();
      const marker = readGenerationState(fixture.generatedDir)!;

      assert.equal(marker.outcome, "failed");
      assert.ok(!Number.isNaN(Date.parse(marker.at)));
      assert.equal(marker.errorCount, 1);
      assert.match(marker.inputsHash!, /^sha256:[0-9a-f]{64}$/);
    });

    it("should tell the reader on stderr that nothing was written", async () => {
      const { genMessage } = await staleWorkspace();
      // The generation-side mirror of the banner. The thrown message carries the diagnosis; the
      // note is printed beside it, so it is asserted through its constant in the unit tests and
      // through the failure being a refusal here.
      assert.match(genMessage, /\[grouped-member-demand\]/);
    });
  });
});

describe("validate banners the staleness", () => {
  describe("When the last generation attempt failed", () => {
    it("should carry the marker on the report result", async () => {
      const { fixture } = await staleWorkspace();
      const result = await validate(fixture);

      assert.equal(result.kind, "report");
      assert.equal(
        result.kind === "report" ? result.staleness?.outcome : undefined,
        "failed",
      );
    });

    it("should carry it as a structured `staleness` field in --json, uncoloured", async () => {
      const { fixture } = await staleWorkspace();
      const result = await validate(fixture);
      assert.equal(result.kind, "report");
      if (result.kind !== "report") {
        return;
      }

      const json = JSON.parse(
        formatValidationReportJson(result.report, {
          staleness: result.staleness,
        }),
      ) as { staleness: { outcome: string }; issues: unknown[] };

      assert.equal(json.staleness.outcome, "failed");
      assert.ok(Array.isArray(json.issues));
      assert.ok(
        !formatValidationReportJson(result.report, {
          staleness: result.staleness,
        }).includes(""),
      );
    });
  });

  describe("When the last generation attempt succeeded", () => {
    it("should omit the field while keeping the same document root", async () => {
      const fixture = buildFixture();
      await generate(fixture);
      const result = await validate(fixture);

      assert.equal(result.kind, "report");
      assert.equal(
        result.kind === "report" ? result.staleness : "unset",
        undefined,
      );
      // The 4.0 envelope: an OBJECT either way. A consumer never branches on the root type —
      // that is the whole reason the wrap is unconditional rather than state-dependent.
      const json = JSON.parse(
        formatValidationReportJson(
          result.kind === "report"
            ? result.report
            : { issues: [], errorCount: 0, warningCount: 0 },
        ),
      ) as Record<string, unknown>;
      assert.ok(Array.isArray(json.issues));
      assert.equal("staleness" in json, false);
    });
  });
});

describe("every artifact-reading surface banners the staleness", () => {
  const surfaces = [
    { name: "inspect", args: ["inspect"] },
    { name: "inspect --discovery", args: ["inspect", "--discovery"] },
    { name: "explain", args: ["explain", "authService"] },
    { name: "explain --discovery", args: ["explain", "authService", "--discovery"] },
    { name: "validate", args: ["validate"] },
  ] as const;

  for (const surface of surfaces) {
    describe(`When \`ioc ${surface.name}\` runs over stale artifacts`, () => {
      it("should print the banner first, and not print it when generation succeeded", async () => {
        const { fixture } = await staleWorkspace();
        const stale = runCli(fixture, [...surface.args]);
        const both = `${stale.stderr}\n${stale.stdout}`;

        assert.match(both, /\[stale\] Generated artifacts are STALE/);
        assert.match(
          both,
          /Results below describe the LAST SUCCESSFUL generation/,
        );

        // The control: a workspace whose last generation succeeded says nothing at all.
        const fresh = buildFixture();
        await generate(fresh);
        const clean = runCli(fresh, [...surface.args]);
        assert.doesNotMatch(`${clean.stderr}\n${clean.stdout}`, /\[stale\]/);
      });
    });
  }

  describe("When the surface is asked for --json", () => {
    it("should carry the marker as a field rather than printing a banner into the payload", async () => {
      const { fixture } = await staleWorkspace();
      const { stdout, stderr } = runCli(fixture, ["inspect", "--json"]);

      // Nothing may reach stdout but the document.
      const parsed = JSON.parse(stdout) as {
        kind: string;
        staleness?: { outcome: string; errorCount: number };
      };
      assert.equal(parsed.kind, "inspect");
      assert.equal(parsed.staleness?.outcome, "failed");
      assert.equal(parsed.staleness?.errorCount, 1);
      assert.doesNotMatch(stderr, /\[stale\]/);
    });

    it("should omit the field entirely when generation succeeded", async () => {
      const fresh = buildFixture();
      await generate(fresh);
      const { stdout } = runCli(fresh, ["inspect", "--json"]);

      const parsed = JSON.parse(stdout) as Record<string, unknown>;
      assert.equal("staleness" in parsed, false);
    });
  });
});

describe("the two worlds, on one screen", () => {
  /**
   * The field scenario end to end.
   *
   * Generation, reading live source, refuses the demand and names the rule it breaks. Validate,
   * reading the artifacts that generation refused to replace, reports the same key — and now says
   * both things a reader needs: that what follows describes an older moment, and that the key is a
   * grouped member rather than something to shadow-register here.
   */
  it("should show the grouped externals guidance UNDER the staleness banner", async () => {
    const { fixture, genMessage } = await staleWorkspace();

    // World one: live source. Generation refuses, by the group law.
    assert.match(genMessage, /\[grouped-member-demand\]/);
    assert.match(genMessage, /^ +group: +"writeServices"$/m);

    // World two: the artifacts. Validate is bannered, and its guidance is the grouped mirror.
    const result = await validate(fixture);
    assert.equal(result.kind, "report");
    if (result.kind !== "report") {
      return;
    }

    assert.ok(result.staleness !== undefined, "validate must know it is stale");

    const grouped = result.report.issues.find((issue) =>
      issue.summary.includes("activatePendingUserWriteService"),
    );
    assert.ok(grouped, "expected an issue about the stale key");
    assert.match(
      grouped.summary,
      /is a member of composed group "writeServices" and has no individual cradle key\./,
    );

    const rendered = [
      grouped.summary,
      ...grouped.details,
      grouped.suggestedFix ?? "",
    ].join("\n");
    // The advice generation refuses to give, validate must not give either.
    assert.doesNotMatch(rendered, /Register a factory/);
    assert.match(rendered, /re-run `ioc generate`/);
    assert.doesNotMatch(rendered, /writeServices\.[A-Z]/);
  });
});
