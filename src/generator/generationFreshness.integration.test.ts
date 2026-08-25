/**
 * @fileoverview The field scenario, end to end: a library edited without being regenerated.
 *
 * Reported three times in one week, always the same shape. Edit a library's source. Forget the
 * regenerate/rebuild ordering. Run `ioc validate` in the app. Read a confidently-worded finding
 * that describes the world as it was before the edit — with nothing at all to distinguish it from a
 * real one.
 *
 * The most recent instance is what this fixture builds literally: a contract is GROUPED in
 * `@media/core`, the app's committed artifacts demand a member key, and validate correctly reports
 * the grouped-member error. Then the developer un-groups the contract in `media-core`'s source,
 * which fixes it — and validate goes on reporting the grouped-world error, because `media-core`'s
 * manifest still says the contract is grouped. The signal that was missing is the whole of this
 * file: a banner naming the library, and a caveat on the finding itself.
 *
 * Two properties are pinned as hard as the banner. The first is that step 4 below — the same error,
 * with the library CURRENT — carries no banner and no caveat: a warning that fires on correct
 * findings would be worse than none. The second is that regenerating in dependency order clears it
 * completely.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { tryLoadIocConfig } from "../config/loadIocConfig.js";
import { runValidate, type RunValidateResult } from "../validate/runValidate.js";
import { readGenerationRecord } from "../diagnostics/generationState.js";
import { formatValidationReportJson } from "../composition/compositionReport.js";
import { runIocCliInProcess } from "../test-support/runIocCliInProcess.js";
import { generateManifest } from "./generateManifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iocManifestIndex = path
  .join(__dirname, "../index.js")
  .replace(/\\/g, "/");
const CLI_ENTRY = path.join(__dirname, "../cli/ioc.ts");

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

const LIB_CONTRACTS = `export interface MediaSink {
  write(payload: string): string;
}

export interface S3MediaSink extends MediaSink {
  readonly kind: "s3";
}
`;

const LIB_FACTORY = `import type { S3MediaSink } from "../contracts.js";

export const buildS3MediaSink = (): S3MediaSink => ({
  kind: "s3",
  write: (payload: string) => payload,
});
`;

/**
 * The library's config, in both worlds.
 *
 * Grouping is declared in `ioc.config.ts`, so "un-grouping a contract in the library's source" is
 * literally an edit to this file — and the config's source text is one of the inputs the generation
 * record fingerprints, which is what makes the edit visible.
 */
const libIocConfig = (grouped: boolean): string =>
  `import { defineIocConfig } from "${iocManifestIndex}";

export default defineIocConfig({
  packageName: "${LIB}",
  discovery: {
    scanDirs: ["src/factories"],
    generatedDir: "src/generated",
    includes: ["**/*.{ts,tsx}"],
  },${
    grouped
      ? `
  groups: {
    mediaSinks: {
      kind: "collection",
      baseType: "MediaSink",
    },
  },`
      : ""
  }
});
`;

const APP_CONTRACTS = `export interface UploadService {
  upload(payload: string): string;
}
`;

/** The app factory that demands the library's implementation by its bare registration key. */
const APP_FACTORY = `import type { S3MediaSink } from "${LIB}";
import type { UploadService } from "../contracts.js";

type Deps = { s3MediaSink: S3MediaSink };

export const buildUploadService = ({ s3MediaSink }: Deps): UploadService => ({
  upload: (payload: string) => s3MediaSink.write(payload),
});
`;

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
  /** The directory both packages live under — what {@link copyOf} duplicates. */
  readonly workspaceRoot: string;
  readonly appRoot: string;
  readonly appConfigPath: string;
  readonly libRoot: string;
  readonly libConfigPath: string;
  readonly appFactoryPath: string;
  readonly libGeneratedDir: string;
  readonly appGeneratedDir: string;
  readonly setLibraryGrouped: (grouped: boolean) => void;
};

/**
 * Every path in the workspace, derived from its root alone.
 *
 * Split out from {@link buildFixture} so a COPY of a generated workspace can be described without
 * regenerating it — see {@link copyOf}.
 */
const fixtureAt = (workspaceRoot: string): Fixture => {
  const appRoot = path.join(workspaceRoot, "apps", "api");
  const libRoot = path.join(workspaceRoot, "packages", "media-core");
  const libConfigPath = path.join(libRoot, "src", "ioc.config.ts");
  return {
    workspaceRoot,
    appRoot,
    appConfigPath: path.join(appRoot, "src", "ioc.config.ts"),
    libRoot,
    libConfigPath,
    appFactoryPath: path.join(
      appRoot,
      "src",
      "factories",
      "buildUploadService.ts",
    ),
    libGeneratedDir: path.join(libRoot, "src", "generated"),
    appGeneratedDir: path.join(appRoot, "src", "generated"),
    setLibraryGrouped: (grouped: boolean) =>
      writeFileSync(libConfigPath, libIocConfig(grouped), "utf8"),
  };
};

const write = (filePath: string, contents: string): void => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
};

/**
 * A real two-package workspace, both halves of which really generate.
 *
 * The library is a genuine package that runs its own `ioc generate` rather than a hand-written
 * manifest, because the thing under test is precisely that a REAL generation leaves a record and
 * that a later edit to the sources it read moves the fingerprint. A hand-written manifest would pin
 * the comparison and skip everything that produces the inputs to it.
 *
 * It lives OUTSIDE `node_modules` and is symlinked in, the way a workspace tool links one. Placing
 * the sources under `node_modules` would put them outside the library's own generation program —
 * a group's base type is resolved excluding `node_modules` — so the library could not declare the
 * group this scenario turns on.
 */
const buildFixture = (): Fixture => {
  const workspaceRoot = realpathSync(
    mkdtempSync(path.join(tmpdir(), "ioc-fresh-")),
  );
  const appRoot = path.join(workspaceRoot, "apps", "api");
  const libRoot = path.join(workspaceRoot, "packages", "media-core");

  write(
    path.join(appRoot, "package.json"),
    JSON.stringify({ name: "@apps/api", type: "module" }),
  );
  write(path.join(appRoot, "tsconfig.json"), JSON.stringify(TSCONFIG, null, 2));

  write(
    path.join(libRoot, "package.json"),
    JSON.stringify({
      name: LIB,
      type: "module",
      exports: {
        ".": { types: "./src/contracts.ts", import: "./src/contracts.ts" },
        "./iocManifest": {
          types: "./src/generated/ioc-manifest.ts",
          import: "./src/generated/ioc-manifest.ts",
        },
        "./iocTypes": {
          types: "./src/generated/ioc-registry.types.ts",
          import: "./src/generated/ioc-registry.types.ts",
        },
      },
    }),
  );
  write(path.join(libRoot, "tsconfig.json"), JSON.stringify(TSCONFIG, null, 2));
  write(path.join(libRoot, "src", "contracts.ts"), LIB_CONTRACTS);
  write(
    path.join(libRoot, "src", "factories", "buildS3MediaSink.ts"),
    LIB_FACTORY,
  );
  const libConfigPath = path.join(libRoot, "src", "ioc.config.ts");
  write(libConfigPath, libIocConfig(false));

  const linkDir = path.join(appRoot, "node_modules", LIB.split("/")[0]!);
  mkdirSync(linkDir, { recursive: true });
  // RELATIVE, the way a workspace tool writes one — and the reason `copyOf` can duplicate a
  // generated workspace at all: an absolute link would keep pointing at the original library from
  // inside the copy, so two "independent" fixtures would share one package.
  symlinkSync(
    path.relative(linkDir, libRoot),
    path.join(linkDir, LIB.split("/")[1]!),
    "dir",
  );

  write(path.join(appRoot, "src", "contracts.ts"), APP_CONTRACTS);
  const appFactoryPath = path.join(
    appRoot,
    "src",
    "factories",
    "buildUploadService.ts",
  );
  write(appFactoryPath, APP_FACTORY);
  const appConfigPath = path.join(appRoot, "src", "ioc.config.ts");
  write(appConfigPath, appIocConfig);

  return fixtureAt(workspaceRoot);
};

/**
 * A byte-for-byte duplicate of an already-generated workspace.
 *
 * Generating one of these costs two real TypeScript programs, and most of the cases below want the
 * SAME generated starting point and then edit one file in it. Copying the finished workspace buys
 * that starting point once instead of once per case, and — unlike sharing the workspace itself —
 * leaves every case free to write, since it owns its copy outright.
 *
 * `verbatimSymlinks` keeps the `node_modules` link a link rather than resolving it into a second
 * copy of the library; it is relative, so it lands correctly inside the copy.
 */
const copyOf = (fixture: Fixture): Fixture => {
  const target = realpathSync(
    mkdtempSync(path.join(tmpdir(), "ioc-fresh-copy-")),
  );
  cpSync(fixture.workspaceRoot, target, {
    recursive: true,
    verbatimSymlinks: true,
  });
  return fixtureAt(target);
};

const genLibrary = (f: Fixture): Promise<void> =>
  generateManifest({
    paths: { projectRoot: f.libRoot },
    iocConfigPath: f.libConfigPath,
  });

const genApp = (f: Fixture): Promise<void> =>
  generateManifest({
    paths: { projectRoot: f.appRoot },
    iocConfigPath: f.appConfigPath,
  });

const validate = async (f: Fixture): Promise<RunValidateResult> => {
  const config = await tryLoadIocConfig(f.appConfigPath);
  assert.ok(config !== undefined);
  return runValidate({
    projectRoot: f.appRoot,
    configPath: f.appConfigPath,
    config: config!,
    json: false,
  });
};

/** The flags every invocation below needs to point the CLI at a temp workspace. */
const cliArgsFor = (f: Fixture, args: readonly string[]): readonly string[] => [
  ...args,
  "--config",
  f.appConfigPath,
  "--project",
  f.appRoot,
];

/**
 * The CLI in a real process.
 *
 * Kept for the four claims that are about the process and not about the report: that stdout and
 * stderr are separate descriptors a shell could redirect apart, that `NO_COLOR` reaching a real
 * environment produces escape-free output, that `--json`'s stdout carries the document and nothing
 * else, and that a freshness warning does not move the exit code.
 */
const spawnCli = (
  f: Fixture,
  args: readonly string[],
): { stdout: string; stderr: string; status: number | null } => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_ENTRY, ...cliArgsFor(f, args)],
    {
      // The repo root, not the fixture: `--import tsx` resolves the loader from the working
      // directory, and a temp fixture has no node_modules of its own.
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
 * The same CLI in this process, with both streams captured.
 *
 * Used wherever the claim is about what the banner SAYS and where it sits relative to the findings
 * it qualifies — properties of the text on a stream, which survive the trip through `console.error`
 * exactly. Each of these used to cost a `tsx` boot plus a cold re-analysis of the workspace.
 */
const runCli = (
  f: Fixture,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string; code: number }> =>
  runIocCliInProcess(cliArgsFor(f, args));

const reportIssues = (result: RunValidateResult) => {
  assert.equal(result.kind, "report");
  return result.kind === "report" ? result.report.issues : [];
};

const freshnessFor = (result: RunValidateResult, sourceId: string) => {
  assert.equal(result.kind, "report");
  return result.kind === "report"
    ? result.freshness.find((entry) => entry.sourceId === sourceId)
    : undefined;
};

/**
 * The workspace at the moment the developer has fixed the library and not regenerated it.
 *
 * Built by walking the real sequence rather than by planting artifacts: green → group the library
 * and regenerate it → un-group its source and stop. Every intermediate state is one a developer
 * actually passes through, and the third test below asserts the middle one is quiet.
 */
const workspaceWithFixedButUnregeneratedLibrary = async (): Promise<Fixture> => {
  const fixture = buildFixture();
  await genLibrary(fixture);
  await genApp(fixture);

  fixture.setLibraryGrouped(true);
  await genLibrary(fixture);

  fixture.setLibraryGrouped(false);
  return fixture;
};

/** Green: both packages generated, nothing edited since. */
const greenWorkspace = async (): Promise<Fixture> => {
  const fixture = buildFixture();
  await genLibrary(fixture);
  await genApp(fixture);
  return fixture;
};

/**
 * The two starting points every case below begins from, each generated once.
 *
 * Reaching either one costs two or three real generations, and this file used to walk that sequence
 * fourteen times to reach two distinct states. A case that only READS its workspace takes the
 * shared one; a case that writes to it takes `copyOf(...)`, which is a filesystem copy of the same
 * finished state and costs no generation at all. Nothing here mutates a shared workspace, so no
 * case can depend on another having run first.
 */
let sharedStaleLibrary: Promise<Fixture> | undefined;
const theWorkspaceWithAStaleLibrary = (): Promise<Fixture> =>
  (sharedStaleLibrary ??= workspaceWithFixedButUnregeneratedLibrary());

let sharedGreen: Promise<Fixture> | undefined;
const theGreenWorkspace = (): Promise<Fixture> =>
  (sharedGreen ??= greenWorkspace());

/** A private, writable copy of the shared green workspace. */
const aGreenWorkspace = async (): Promise<Fixture> =>
  copyOf(await theGreenWorkspace());

/** A private, writable copy of the shared stale-library workspace. */
const aWorkspaceWithAStaleLibrary = async (): Promise<Fixture> =>
  copyOf(await theWorkspaceWithAStaleLibrary());

describe("the field scenario: a library fixed in source but not regenerated", () => {
  describe("When the app validates against the library's previous artifacts", () => {
    it("should still report the old world's error — the finding itself is unchanged", async () => {
      const fixture = await theWorkspaceWithAStaleLibrary();
      const issues = reportIssues(await validate(fixture));

      // The report is not suppressed and not rewritten. Validate's job is to describe the committed
      // artifacts, and this IS what they say; what was missing was any cue about when they said it.
      const grouped = issues.find((issue) =>
        issue.summary.includes("has no individual cradle key"),
      );
      assert.ok(grouped, `expected the grouped-member error, got: ${issues.map((i) => i.summary).join(" | ")}`);
    });

    it("should mark the library as possibly behind its sources", async () => {
      const fixture = await theWorkspaceWithAStaleLibrary();
      const result = await validate(fixture);

      const lib = freshnessFor(result, LIB);
      assert.equal(lib?.currentMatches, false);
      assert.equal(lib?.outcome, "success");

      // The app itself has not been touched since it generated — no false positive on this side.
      assert.equal(freshnessFor(result, "local")?.currentMatches, true);
    });

    it("should carry the caveat on the tainted finding itself, not only in the banner", async () => {
      const fixture = await theWorkspaceWithAStaleLibrary();
      const issues = reportIssues(await validate(fixture));
      const grouped = issues.find((issue) =>
        issue.summary.includes("has no individual cradle key"),
      )!;

      // This is the line that reaches the reader who scrolled straight to the first error.
      assert.equal(grouped.possiblyStale, true);
      assert.equal(
        grouped.stalenessNote,
        "note: @media/core may be stale; this finding may describe the old world",
      );
    });
  });

  describe("When the SAME error is reported with the library current", () => {
    it("should carry no banner and no caveat — a warning on a correct finding is worse than none", async () => {
      // Its own copy: this case regroups the library and regenerates it.
      const fixture = await aGreenWorkspace();
      fixture.setLibraryGrouped(true);
      await genLibrary(fixture);

      const result = await validate(fixture);
      const issues = reportIssues(result);

      const grouped = issues.find((issue) =>
        issue.summary.includes("has no individual cradle key"),
      );
      assert.ok(grouped, "the grouped-member error should be reported");
      assert.equal(grouped!.possiblyStale, undefined);
      assert.equal(grouped!.stalenessNote, undefined);
      assert.equal(freshnessFor(result, LIB)?.currentMatches, true);
    });
  });

  describe("When both packages are regenerated in dependency order", () => {
    it("should come back clean, with nothing flagged", async () => {
      // Its own copy: this case regenerates both packages.
      const fixture = await aWorkspaceWithAStaleLibrary();

      await genLibrary(fixture);
      await genApp(fixture);

      const result = await validate(fixture);
      assert.equal(result.kind, "report");
      if (result.kind !== "report") {
        return;
      }

      assert.deepEqual(
        result.report.issues.map((issue) => issue.summary),
        [],
      );
      assert.deepEqual(
        result.freshness.map((entry) => [entry.sourceId, entry.currentMatches]),
        [
          ["local", true],
          [LIB, true],
        ],
      );
    });
  });
});

describe("the banner, where a developer actually meets it", () => {
  describe("When `ioc validate` runs over a workspace with a behind-the-sources dependency", () => {
    it("should print the banner on stderr, above the report, in the words of the ruling", async () => {
      // The claim is about the WORDS and their order within one stream, which the captured run
      // reproduces exactly; the process-level claims about that stream are the two cases below.
      const fixture = await theWorkspaceWithAStaleLibrary();
      const { stderr } = await runCli(fixture, ["validate"]);

      assert.match(
        stderr,
        /⚠ @media\/core's generated artifacts may predate its sources \(generated .+ ago; sources have changed since\)\. Findings involving its keys may describe the old world — regenerate there first\./,
      );
      // Above the findings it qualifies, on the same stream, so a reader meets it first.
      assert.ok(
        stderr.indexOf("may predate its sources") <
          stderr.indexOf("has no individual cradle key"),
        "the banner must precede the findings it qualifies",
      );
    });

    it("should keep the report on its own channel and the caveat inside it", async () => {
      // A real process: "its own channel" is a claim about two file descriptors.
      const fixture = await theWorkspaceWithAStaleLibrary();
      const { stdout, stderr } = spawnCli(fixture, ["validate"]);

      // Errors put the report on stderr too, but the caveat rides with the finding either way.
      assert.match(stderr, /note: @media\/core may be stale; this finding may describe the old world/);
      assert.equal(stdout.includes("may predate its sources"), false);
    });

    it("should carry no ANSI escapes under NO_COLOR", async () => {
      // A real process: colour is decided from the environment and from whether the stream is a
      // TTY, and both of those are the process's, not the function's.
      const fixture = await theWorkspaceWithAStaleLibrary();
      const { stderr } = spawnCli(fixture, ["validate"]);

      // eslint-disable-next-line no-control-regex
      assert.doesNotMatch(stderr, /\[/);
    });

    it("should not change the exit code — warn loud, never abort", async () => {
      const fixture = await aGreenWorkspace();
      // Green workspace, then an edit inside the library's SCAN SET that regenerates nothing:
      // freshness alone must not fail a run that has no composition errors in it.
      writeFileSync(
        path.join(fixture.libRoot, "src", "factories", "buildS3MediaSink.ts"),
        `${LIB_FACTORY}\n// an edit the library has not regenerated for\n`,
        "utf8",
      );

      // A real process: the claim is about the code a CI step reads, so a real one produces it.
      const { status, stderr } = spawnCli(fixture, ["validate"]);

      assert.match(stderr, /may predate its sources/);
      assert.equal(status, 0);
    });
  });

  describe("When BOTH the app and a dependency are behind their sources", () => {
    it("should tell the developer to regenerate the dependency first", async () => {
      // Its own copy: this case edits the app's sources too.
      const fixture = await aWorkspaceWithAStaleLibrary();
      writeFileSync(
        fixture.appFactoryPath,
        `${APP_FACTORY}\n// an edit the app has not regenerated for\n`,
        "utf8",
      );

      const { stderr } = await runCli(fixture, ["validate"]);

      assert.match(stderr, /⚠ @media\/core's generated artifacts may predate/);
      assert.match(stderr, /⚠ this app's generated artifacts may predate/);
      // Regenerating the app first would compose the library's old manifest and produce a
      // fresh-looking artifact built on stale input.
      assert.match(
        stderr,
        /Regenerate @media\/core before this app: this app's generation composes it, so regenerating here first would just bake the old output in\./,
      );
    });
  });
});

describe("a package with no generation record", () => {
  describe("When the artifacts predate records entirely", () => {
    it("should get one quiet advisory line, not the banner", async () => {
      const fixture = await aGreenWorkspace();

      // The pre-#20 world: artifacts on disk, no record beside them.
      rmSync(path.join(fixture.libRoot, "src", ".ioc-generation-state.json"));
      assert.equal(readGenerationRecord(fixture.libGeneratedDir), undefined);

      const { stderr } = await runCli(fixture, ["validate"]);

      assert.match(
        stderr,
        /note: no generation record for @media\/core — whether its artifacts predate its sources is unknown until it next generates\./,
      );
      // Absence of evidence, at absence-of-evidence volume.
      assert.equal(stderr.includes("⚠ @media/core"), false);
    });

    it("should report it as unknown in --json rather than as a mismatch", async () => {
      const fixture = await aGreenWorkspace();
      rmSync(path.join(fixture.libRoot, "src", ".ioc-generation-state.json"));

      const result = await validate(fixture);
      const lib = freshnessFor(result, LIB);

      assert.equal(lib?.currentMatches, undefined);
      assert.equal(lib?.outcome, undefined);
    });
  });
});

describe("--json", () => {
  describe("When freshness is published as data", () => {
    it("should carry a `freshness` array beside `issues`, and possiblyStale on the tainted ones", async () => {
      const fixture = await theWorkspaceWithAStaleLibrary();
      const result = await validate(fixture);
      assert.equal(result.kind, "report");
      if (result.kind !== "report") {
        return;
      }

      const json = JSON.parse(
        formatValidationReportJson(result.report, {
          freshness: result.freshness,
        }),
      ) as {
        freshness: { name: string; outcome: string; generatedAt: string; currentMatches: boolean }[];
        issues: { summary: string; possiblyStale?: boolean }[];
      };

      // Beside `issues`, never instead of it: the unconditional-`{issues}` envelope extends.
      assert.ok(Array.isArray(json.issues));
      const lib = json.freshness.find((entry) => entry.name === LIB)!;
      assert.deepEqual(Object.keys(lib).sort(), [
        "currentMatches",
        "generatedAt",
        "name",
        "outcome",
      ]);
      assert.equal(lib.currentMatches, false);
      assert.equal(lib.outcome, "success");

      const tainted = json.issues.find((issue) =>
        issue.summary.includes("has no individual cradle key"),
      )!;
      assert.equal(tainted.possiblyStale, true);
    });

    it("should carry no rendered prose or internal attribution on an issue", async () => {
      const fixture = await theWorkspaceWithAStaleLibrary();
      const result = await validate(fixture);
      assert.equal(result.kind, "report");
      if (result.kind !== "report") {
        return;
      }

      const text = formatValidationReportJson(result.report, {
        freshness: result.freshness,
      });

      // `stalenessNote` is the text surface's rendering and `packages` is the matcher's input;
      // neither is a promise this document makes.
      assert.equal(text.includes("stalenessNote"), false);
      assert.equal(text.includes('"packages"'), false);
      // eslint-disable-next-line no-control-regex
      assert.doesNotMatch(text, /\[/);
    });

    it("should reach stdout as one parseable document, uncontaminated by the banner", async () => {
      // A GREEN workspace with a behind-the-sources library: the report goes to stdout, and the
      // banner must not be in it. `--json` is a payload, and a caveat inside a payload corrupts it.
      const fixture = await aGreenWorkspace();
      writeFileSync(
        path.join(fixture.libRoot, "src", "factories", "buildS3MediaSink.ts"),
        `${LIB_FACTORY}\n// edited, not regenerated\n`,
        "utf8",
      );

      // A real process: "reaches stdout as ONE document" is a claim about everything that could
      // have been written to the descriptor, which only a real pipe can settle.
      const { stdout, stderr } = spawnCli(fixture, ["validate", "--json"]);

      const parsed = JSON.parse(stdout) as {
        freshness: { name: string; currentMatches?: boolean }[];
        issues: unknown[];
      };
      assert.deepEqual(parsed.issues, []);
      assert.equal(
        parsed.freshness.find((entry) => entry.name === LIB)?.currentMatches,
        false,
      );
      // `--json` gets the fact as data; the prose banner is suppressed entirely rather than moved.
      assert.equal(stdout.includes("may predate its sources"), false);
      assert.equal(stderr.includes("may predate its sources"), false);
    });
  });
});

describe("inspect and explain", () => {
  describe("When this package's own artifacts may predate its own sources", () => {
    it("should banner it above the manifest-mode report, on stderr", async () => {
      const fixture = await aGreenWorkspace();
      writeFileSync(
        fixture.appFactoryPath,
        `${APP_FACTORY}\n// edited, not regenerated\n`,
        "utf8",
      );

      const { stdout, stderr } = await runCli(fixture, ["inspect"]);

      assert.match(
        stderr,
        /⚠ this app's generated artifacts may predate its sources .+ regenerate here first\./,
      );
      // The report itself is untouched and still pipeable.
      assert.equal(stdout.includes("may predate its sources"), false);
    });

    it("should say nothing when the artifacts and the sources agree", async () => {
      const fixture = await theGreenWorkspace();

      const { stderr } = await runCli(fixture, ["inspect"]);

      assert.equal(stderr.includes("may predate its sources"), false);
      assert.equal(stderr.includes("no generation record"), false);
    });
  });
});

describe("the record on disk", () => {
  describe("When a library generates successfully", () => {
    it("should sit beside the generated directory, never inside the diffed set", async () => {
      const fixture = await theGreenWorkspace();

      const recordPath = path.join(
        fixture.libRoot,
        "src",
        ".ioc-generation-state.json",
      );
      const parsed = JSON.parse(readFileSync(recordPath, "utf8")) as Record<
        string,
        unknown
      >;

      assert.deepEqual(Object.keys(parsed).sort(), ["at", "inputsHash", "outcome"]);
      assert.equal(parsed.outcome, "success");
      assert.match(String(parsed.inputsHash), /^sha256:[0-9a-f]{64}$/);
    });
  });
});
