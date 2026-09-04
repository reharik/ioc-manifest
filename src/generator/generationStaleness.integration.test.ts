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
import { runIocCliInProcess } from "../test-support/runIocCliInProcess.js";
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

/** The flags every invocation below needs to point the CLI at a temp fixture. */
const cliArgsFor = (
  fixture: Fixture,
  args: readonly string[],
): readonly string[] => [
  ...args,
  "--config",
  fixture.configPath,
  "--project",
  fixture.projectRoot,
];

/**
 * The real CLI, in a real process, over a fixture.
 *
 * Kept for the assertions that are about the PROCESS: that the exit code reaches a shell, that the
 * banner and the report land on different file descriptors, that `--json`'s stdout carries the
 * document and nothing else. Those cannot be answered by a function call, so they are not answered
 * by one. Everything about what the report SAYS goes through {@link runCli} instead.
 */
const spawnCli = (
  fixture: Fixture,
  args: readonly string[],
): { stdout: string; stderr: string; status: number | null } => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_ENTRY, ...cliArgsFor(fixture, args)],
    {
      // The repo root, not the fixture: `--import tsx` resolves the loader from the working
      // directory, and a temp fixture has no node_modules of its own. Every path the CLI needs
      // comes from `--config` and `--project`, so the working directory is not under test.
      cwd: path.join(__dirname, "../.."),
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    },
  );
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
};

/**
 * The same CLI, in this process, with both streams captured.
 *
 * `inspect` and `explain` build their reports from state a unit test cannot reach without running
 * the command, so the command is run — but the thing under test is the report and the order of the
 * lines in it, and that survives the trip through `console.log`/`console.error` intact. What it
 * saves is a `tsx` boot and a cold re-analysis per assertion; twelve of those, plus a freshly
 * generated workspace for each, were 39 of this file's 39 seconds.
 */
const runCli = (
  fixture: Fixture,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string; code: number }> =>
  runIocCliInProcess(cliArgsFor(fixture, args));

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

type StaleWorkspace = {
  fixture: Fixture;
  before: Record<string, string>;
  genMessage: string;
};

/** The stale workspace the field reported: green artifacts, then the library regroups underneath. */
const staleWorkspace = async (): Promise<StaleWorkspace> => {
  const fixture = buildFixture();
  await generate(fixture);
  const before = generatedContents(fixture);

  fixture.regroupLibrary();
  const genMessage = await generateExpectingFailure(fixture);

  return { fixture, before, genMessage };
};

const freshWorkspace = async (): Promise<Fixture> => {
  const fixture = buildFixture();
  await generate(fixture);
  return fixture;
};

/**
 * The two workspaces every read-only case in this file wants, built once between them.
 *
 * Building one costs two full generations — a real TypeScript program over a real fixture, twice —
 * and thirteen cases here used to build their own copy of the same two states. Nothing below
 * mutates a shared workspace: the three cases that DO write to one (regenerating after a fix, and
 * anything that edits sources) call `staleWorkspace()` / `freshWorkspace()` directly and get their
 * own, which is what keeps the sharing from coupling one case's assertions to another's order.
 */
let sharedStale: Promise<StaleWorkspace> | undefined;
const theStaleWorkspace = (): Promise<StaleWorkspace> =>
  (sharedStale ??= staleWorkspace());

let sharedFresh: Promise<Fixture> | undefined;
const theFreshWorkspace = (): Promise<Fixture> =>
  (sharedFresh ??= freshWorkspace());

describe("a successful generation records its success", () => {
  describe("When generation succeeds", () => {
    it("should write the artifacts and a success record beside them", async () => {
      const fixture = await theFreshWorkspace();

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
      const fixture = await theFreshWorkspace();

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
      // Its own workspace, not the shared one: this case repairs the drift and regenerates.
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
      const { fixture, before } = await theStaleWorkspace();

      // The refuse-to-write semantics are unchanged; this pins that the marker did not weaken them.
      assert.deepEqual(generatedContents(fixture), before);
    });

    it("should place the marker OUTSIDE the generated directory", async () => {
      const { fixture } = await theStaleWorkspace();

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
      const { fixture } = await theStaleWorkspace();
      const marker = readGenerationState(fixture.generatedDir)!;

      assert.equal(marker.outcome, "failed");
      assert.ok(!Number.isNaN(Date.parse(marker.at)));
      assert.equal(marker.errorCount, 1);
      assert.match(marker.inputsHash!, /^sha256:[0-9a-f]{64}$/);
    });

    it("should tell the reader on stderr that nothing was written", async () => {
      const { genMessage } = await theStaleWorkspace();
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
      const { fixture } = await theStaleWorkspace();
      const result = await validate(fixture);

      assert.equal(result.kind, "report");
      assert.equal(
        result.kind === "report" ? result.staleness?.outcome : undefined,
        "failed",
      );
    });

    it("should carry it as a structured `staleness` field in --json, uncoloured", async () => {
      const { fixture } = await theStaleWorkspace();
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
      const fixture = await theFreshWorkspace();
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
        const { fixture } = await theStaleWorkspace();
        const stale = await runCli(fixture, [...surface.args]);
        const both = `${stale.stderr}\n${stale.stdout}`;

        assert.match(both, /\[stale\] Generated artifacts are STALE/);
        assert.match(
          both,
          /Results below describe the LAST SUCCESSFUL generation/,
        );

        // The control: a workspace whose last generation succeeded says nothing at all.
        const fresh = await theFreshWorkspace();
        const clean = await runCli(fresh, [...surface.args]);
        assert.doesNotMatch(`${clean.stderr}\n${clean.stdout}`, /\[stale\]/);
      });
    });
  }

  /**
   * The same five surfaces, through a real process — three of them, one per verb.
   *
   * What the loop above asserts is the BANNER's words, which the captured run answers exactly. What
   * only a process can answer is the shape of the run around it: that the banner goes to the error
   * stream and the report to the output stream, as two real descriptors that a shell could redirect
   * apart, and that the exit code is the one the verb intends. Neither was pinned before — the loop
   * concatenated the two streams and never looked at a status — so this is coverage the
   * consolidation adds rather than moves.
   *
   * The `--discovery` variants are deliberately not repeated here: they differ from their siblings
   * in where the report's DATA comes from, which is a property of the report, and the loop above
   * already runs all five.
   */
  describe("When the same surfaces run as a real process", () => {
    const verbs = [
      { name: "inspect", args: ["inspect"], status: 0, reportOnStdout: true },
      {
        name: "explain",
        args: ["explain", "authService"],
        status: 0,
        reportOnStdout: true,
      },
      // Validate over a workspace with a composition error exits non-zero — that IS the CI gate —
      // and puts its findings on stderr with them, so stdout is legitimately empty here.
      {
        name: "validate",
        args: ["validate"],
        status: 1,
        reportOnStdout: false,
      },
    ] as const;

    for (const verb of verbs) {
      it(`should keep \`ioc ${verb.name}\`'s banner on stderr and exit ${verb.status}`, async () => {
        const { fixture } = await theStaleWorkspace();
        const { stdout, stderr, status } = spawnCli(fixture, [...verb.args]);

        assert.match(stderr, /\[stale\] Generated artifacts are STALE/);
        assert.doesNotMatch(
          stdout,
          /\[stale\]/,
          "the banner must not ride along inside the report a reader pipes",
        );
        if (verb.reportOnStdout) {
          assert.ok(
            stdout.trim().length > 0,
            "the report itself still has to reach stdout",
          );
        }
        assert.equal(status, verb.status);
      });
    }
  });

  describe("When the surface is asked for --json", () => {
    it("should carry the marker as a field rather than printing a banner into the payload", async () => {
      // A real process: the claim is that NOTHING but the document reaches stdout, and a captured
      // `console.log` cannot see anything a stray `process.stdout.write` might add.
      const { fixture } = await theStaleWorkspace();
      const { stdout, stderr } = spawnCli(fixture, ["inspect", "--json"]);

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
      const fresh = await theFreshWorkspace();
      const { stdout } = await runCli(fresh, ["inspect", "--json"]);

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
    const { fixture, genMessage } = await theStaleWorkspace();

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

describe("a successful generation ignores its own record", () => {
  /** The `.gitignore` at stake: the one beside the marker, which is `src/` here. */
  const gitignoreOf = (fixture: Fixture): string =>
    path.join(path.dirname(fixture.markerPath), ".gitignore");

  const occurrences = (contents: string): number =>
    contents.split("\n").filter((line) => line.trim() === IOC_GENERATION_STATE_FILENAME).length;

  describe("When a package has no .gitignore beside its generated directory", () => {
    it("should create one ignoring the record, since its timestamp changes every run", async () => {
      const fixture = await theFreshWorkspace();

      assert.equal(occurrences(readFileSync(gitignoreOf(fixture), "utf8")), 1);
      // Beside the marker, not at the project root: generation has no business editing a file it
      // does not own.
      assert.equal(path.dirname(gitignoreOf(fixture)), path.dirname(fixture.markerPath));
      assert.equal(existsSync(path.join(fixture.projectRoot, ".gitignore")), false);
    });
  });

  describe("When it writes the entry", () => {
    it("should say so on stdout, so no file appears in git status unannounced", () => {
      const fixture = buildFixture();
      const { stdout, status } = spawnCli(fixture, ["generate"]);

      assert.equal(status, 0);
      assert.match(stdout, /Created src[/\\]\.gitignore ignoring \.ioc-generation-state\.json/u);
      assert.match(stdout, /timestamp changes every run/u);
    });

    it("should say nothing on the runs after, having changed nothing", () => {
      const fixture = buildFixture();
      spawnCli(fixture, ["generate"]);
      const { stdout } = spawnCli(fixture, ["generate"]);

      assert.doesNotMatch(stdout, /\.gitignore/u);
    });
  });

  describe("When generation runs a second time", () => {
    it("should leave the .gitignore byte-identical, so a dirty-tree check stays clean", async () => {
      const fixture = buildFixture();
      await generate(fixture);
      const afterFirst = readFileSync(gitignoreOf(fixture), "utf8");

      await generate(fixture);

      assert.equal(readFileSync(gitignoreOf(fixture), "utf8"), afterFirst);
      assert.equal(occurrences(afterFirst), 1);
    });
  });

  describe("When the consumer manages ignores centrally", () => {
    it("should write nothing under manageGitignore: false", async () => {
      const fixture = buildFixture();
      writeFileSync(
        fixture.configPath,
        appIocConfig.replace("  packageName:", "  manageGitignore: false,\n  packageName:"),
      );

      await generate(fixture);

      // The record itself is unaffected — the setting governs the `.gitignore` and nothing else.
      assert.equal(existsSync(fixture.markerPath), true);
      assert.equal(existsSync(gitignoreOf(fixture)), false);
    });
  });
});
