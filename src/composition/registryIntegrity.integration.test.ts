/**
 * `[registry-integrity]` — validate refuses to reason over a generated file that does not compile.
 *
 * The defect: validate's type comparisons run against a `ts.Program` built over the generated
 * registry-types files, and nothing read that program's diagnostics. A name the file failed to
 * resolve became an ERROR type, and TypeScript treats an error type as assignable in both
 * directions — so `ioc validate` reported "no issues found" on a build that could not compile.
 *
 * `silentPassBeforeFix` below is the "before" shape, kept as an executable statement of what used
 * to happen rather than a claim in a comment: the same fixture run through the ungated entry point
 * (`checkExternalsSatisfaction` with no broken set) still reports nothing, which is exactly what
 * the whole run did before the gate existed.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { IocConfig } from "../config/iocConfig.js";
import {
  parsedSlice,
  typesSource,
  compositionContextFixture,
} from "../test-support/manifestFixtures.js";
import { checkExternalsSatisfaction } from "./checks/externals.js";
import { REGISTRY_INTEGRITY_MAX_DIAGNOSTICS } from "./checks/registryIntegrity.js";
import {
  buildValidationReport,
  formatValidationReportJson,
  formatValidationReportText,
} from "./compositionReport.js";
import { runCompositionChecks } from "./runCompositionChecks.js";
import type { ValidationIssue } from "./types.js";

const appConfig = { composedManifests: ["@lib/a"] } as unknown as IocConfig;

const makeRoot = (
  label: string,
  extraCompilerOptions: Record<string, unknown> = {},
): string => {
  const root = mkdtempSync(path.join(tmpdir(), `ioc-registry-integrity-${label}-`));
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2022",
          module: "ES2022",
          ...extraCompilerOptions,
        },
      },
      null,
      2,
    ),
  );
  return root;
};

/** The closure-breaking fixture class: a cradle property typed with a name nothing imports. */
const unboundNameCradle = (key: string, missingName: string): string =>
  `export interface IocGeneratedCradle { ${key}: ${missingName}; }\nexport interface IocExternals {}`;

const LOGGER_TYPE = "{ log: (msg: string) => void }";

/**
 * Local package supplies `logger` (from a file we control the health of) and `clock` is demanded
 * by the composed package with nobody supplying it — an unrelated key, used to prove the gate is
 * precise rather than blanket.
 */
const twoKeyContext = (
  root: string,
  localTypes: string,
  libTypes: string,
) => {
  const localTypesPath = path.join(root, "local.types.ts");
  const libTypesPath = path.join(root, "lib.types.ts");
  writeFileSync(localTypesPath, localTypes);
  writeFileSync(libTypesPath, libTypes);

  return {
    localTypesPath,
    libTypesPath,
    ctx: {
      ...compositionContextFixture([
        parsedSlice({
          packageLabel: "@apps/api",
          sourceId: "local",
          typesPath: localTypesPath,
          cradleKeys: new Set(["logger"]),
          cradleTypes: { logger: { typeText: LOGGER_TYPE } },
        }),
        parsedSlice({
          packageLabel: "@lib/a",
          sourceId: "@lib/a",
          typesPath: libTypesPath,
          externals: {
            logger: { typeText: LOGGER_TYPE },
            clock: { typeText: "{ now: () => number }" },
          },
        }),
      ]),
      projectRoot: root,
    },
  };
};

const categories = (issues: readonly ValidationIssue[]): string[] =>
  issues.map((i) => i.category);

const integrityErrors = (issues: readonly ValidationIssue[]): ValidationIssue[] =>
  issues.filter(
    (i) => i.category === "registry-integrity" && i.severity === "error",
  );

const skipNotice = (issues: readonly ValidationIssue[]): ValidationIssue | undefined =>
  issues.find(
    (i) => i.category === "registry-integrity" && i.severity === "warning",
  );

describe("validate registry integrity", () => {
  describe("When a local generated registry file does not compile", () => {
    const scenario = () => {
      const root = makeRoot("local-broken");
      const { ctx, localTypesPath } = twoKeyContext(
        root,
        unboundNameCradle("logger", "MissingLogger"),
        typesSource("", `logger: ${LOGGER_TYPE}\n  clock: { now: () => number }`),
      );
      return {
        root,
        localTypesPath,
        issues: runCompositionChecks(appConfig, ctx),
        ctx,
      };
    };

    it("should report a registry-integrity error naming the file and the diagnostic", () => {
      const { issues } = scenario();

      const errors = integrityErrors(issues);
      assert.equal(errors.length, 1);
      assert.match(errors[0]!.summary, /@apps\/api/);
      assert.match(errors[0]!.details.join("\n"), /local\.types\.ts/);
      assert.match(
        errors[0]!.details.join("\n"),
        /TS2304: Cannot find name 'MissingLogger'\./,
      );
      // Distinguishes stale output from an emission bug, and says which one to rule out first.
      assert.match(errors[0]!.suggestedFix ?? "", /Re-run `ioc generate`/);
      assert.match(errors[0]!.suggestedFix ?? "", /bug in ioc-manifest/);
    });

    it("should exit nonzero", () => {
      const { issues } = scenario();
      const report = buildValidationReport(issues);
      assert.ok(report.errorCount > 0);
      // Plain text pinned: the category tag is tinted when stdout is a terminal, and an anchored
      // match would then be testing the escape sequence rather than the line.
      assert.match(
        formatValidationReportText(report, { color: false }),
        /^\[registry-integrity\] /m,
      );
    });

    it("should emit no externals verdict for the tainted key, and say it was skipped", () => {
      const { issues } = scenario();

      // The heart of it: not satisfied, not unsatisfied, not "unverified" — no verdict at all.
      const loggerVerdicts = issues.filter(
        (i) => i.category === "externals" && i.summary.includes('"logger"'),
      );
      assert.deepEqual(loggerVerdicts, []);

      const skipped = skipNotice(issues);
      assert.ok(skipped, "the skip is reported, not silent");
      assert.match(skipped.summary, /Skipped 1 externals type comparison/);
      assert.match(skipped.details.join("\n"), /"logger"/);
      assert.match(skipped.details.join("\n"), /local\.types\.ts/);
    });

    it("should still adjudicate keys the broken file does not taint", () => {
      const { issues } = scenario();

      // `clock` is demanded by @lib/a and supplied by nobody. Neither side of that verdict reads
      // the broken file, so precise tainting leaves it alone.
      const clock = issues.find(
        (i) => i.category === "externals" && i.summary.includes('"clock"'),
      );
      assert.ok(clock, "an untainted key still gets its verdict");
      assert.match(clock.summary, /Unsatisfied/);
    });

    it("should have silently passed before the gate existed", () => {
      const { ctx } = scenario();

      // The ungated path — what every validate run did before this change. The broken file's
      // `MissingLogger` resolves to an error type, error types are assignable in both directions,
      // and the run reports success on a build that cannot compile.
      const silentPassBeforeFix = checkExternalsSatisfaction(ctx);
      const loggerVerdicts = silentPassBeforeFix.filter((i) =>
        i.summary.includes('"logger"'),
      );
      assert.deepEqual(
        loggerVerdicts,
        [],
        "before: no complaint about logger, because the comparison passed",
      );
      assert.equal(
        buildValidationReport(silentPassBeforeFix).errorCount,
        1,
        "before: the only error was the unrelated unsupplied `clock`",
      );

      // After: the same fixture fails, and fails for the right reason.
      const after = runCompositionChecks(appConfig, ctx);
      assert.equal(integrityErrors(after).length, 1);
      assert.ok(buildValidationReport(after).errorCount > 1);
    });
  });

  describe("When a composed package's generated registry file does not compile", () => {
    it("should name that package's file, not the local one, and advise regenerating upstream", () => {
      const root = makeRoot("composed-broken");
      const { ctx } = twoKeyContext(
        root,
        typesSource(`logger: ${LOGGER_TYPE}`, ""),
        `export interface IocGeneratedCradle {}\nexport interface IocExternals { logger: MissingLogger; clock: { now: () => number } }`,
      );

      const issues = runCompositionChecks(appConfig, ctx);
      const errors = integrityErrors(issues);
      assert.equal(errors.length, 1);
      assert.match(errors[0]!.summary, /@lib\/a/);
      assert.match(errors[0]!.details.join("\n"), /lib\.types\.ts/);
      assert.ok(
        !errors[0]!.details.join("\n").includes("local.types.ts"),
        "the healthy local file is not implicated",
      );
      // A consumer cannot regenerate someone else's published package.
      assert.match(errors[0]!.suggestedFix ?? "", /Regenerate and republish @lib\/a/);

      // Both keys are demanded BY the broken file, so both comparisons are tainted here.
      const skipped = skipNotice(issues);
      assert.ok(skipped);
      assert.match(skipped.summary, /Skipped 2 externals type comparisons/);
      assert.deepEqual(
        issues.filter((i) => i.category === "externals"),
        [],
      );
    });
  });

  describe("When the program is healthy", () => {
    it("should report no registry-integrity issues and adjudicate normally", () => {
      const root = makeRoot("healthy");
      const { ctx } = twoKeyContext(
        root,
        typesSource(`logger: ${LOGGER_TYPE}`, ""),
        typesSource("", `logger: ${LOGGER_TYPE}\n  clock: { now: () => number }`),
      );

      const issues = runCompositionChecks(appConfig, ctx);
      assert.ok(!categories(issues).includes("registry-integrity"));
      // `logger` matches and is silent; `clock` has no supplier and is reported. Unchanged.
      assert.equal(issues.length, 1);
      assert.equal(issues[0]!.category, "externals");
      assert.match(issues[0]!.summary, /Unsatisfied.*"clock"/);
    });
  });

  describe("When the workspace tsconfig constrains the emit layout", () => {
    it("should not mistake validate's own program construction for a broken file", () => {
      // `rootDir` describes where sources may sit relative to an output directory. Validate's
      // program is synthetic and read-only — its roots are several packages' registry files at
      // once, a shape no real build compiles — so a layout constraint reports TS6059 against a
      // registry file whose contract types live in a sibling package, which the workspace's own
      // `tsc` never says because it never makes that file a root. This is the shape of the real
      // multi-package example, where `example:full` caught it.
      const root = makeRoot("root-dir", {
        moduleResolution: "Bundler",
        rootDir: "./app",
        outDir: "./dist",
        declaration: true,
      });
      mkdirSync(path.join(root, "app"), { recursive: true });
      mkdirSync(path.join(root, "vendor"), { recursive: true });
      writeFileSync(
        path.join(root, "vendor", "contracts.ts"),
        `export type Logger = ${LOGGER_TYPE};`,
      );

      const localTypesPath = path.join(root, "app", "local.types.ts");
      const libTypesPath = path.join(root, "app", "lib.types.ts");
      const importContracts = 'import type { Logger } from "../vendor/contracts.js";\n';
      writeFileSync(
        localTypesPath,
        `${importContracts}export interface IocGeneratedCradle { logger: Logger }\nexport interface IocExternals {}`,
      );
      writeFileSync(
        libTypesPath,
        `${importContracts}export interface IocGeneratedCradle {}\nexport interface IocExternals { logger: Logger; clock: { now: () => number } }`,
      );

      const ctx = {
        ...compositionContextFixture([
          parsedSlice({
            packageLabel: "@apps/api",
            sourceId: "local",
            typesPath: localTypesPath,
            cradleKeys: new Set(["logger"]),
            cradleTypes: { logger: { typeText: "Logger" } },
          }),
          parsedSlice({
            packageLabel: "@lib/a",
            sourceId: "@lib/a",
            typesPath: libTypesPath,
            externals: {
              logger: { typeText: "Logger" },
              clock: { typeText: "{ now: () => number }" },
            },
          }),
        ]),
        projectRoot: root,
      };

      const issues = runCompositionChecks(appConfig, ctx);
      assert.deepEqual(
        issues.filter((i) => i.category === "registry-integrity"),
        [],
      );
      // ...and the healthy comparisons still run rather than being skipped.
      assert.equal(issues.length, 1);
      assert.match(issues[0]!.summary, /Unsatisfied.*"clock"/);
    });
  });

  describe("When a broken file has more diagnostics than the report shows", () => {
    it("should carry the first N and count the rest rather than dropping them", () => {
      const root = makeRoot("many-diagnostics");
      const missing = Array.from(
        { length: REGISTRY_INTEGRITY_MAX_DIAGNOSTICS + 3 },
        (_, i) => `  k${i}: Missing${i};`,
      ).join("\n");
      const { ctx } = twoKeyContext(
        root,
        `export interface IocGeneratedCradle {\n  logger: ${LOGGER_TYPE};\n${missing}\n}\nexport interface IocExternals {}`,
        typesSource("", `logger: ${LOGGER_TYPE}\n  clock: { now: () => number }`),
      );

      const errors = integrityErrors(runCompositionChecks(appConfig, ctx));
      assert.equal(errors.length, 1);
      const diagnosticLines = errors[0]!.details.filter((d) =>
        d.startsWith("TS"),
      );
      assert.equal(diagnosticLines.length, REGISTRY_INTEGRITY_MAX_DIAGNOSTICS);
      assert.match(
        errors[0]!.details.join("\n"),
        /\(3 further errors in this file not shown\)/,
      );
    });
  });

  describe("When output is requested as JSON", () => {
    it("should parse and carry the registry-integrity category", () => {
      const root = makeRoot("json");
      const { ctx } = twoKeyContext(
        root,
        unboundNameCradle("logger", "MissingLogger"),
        typesSource("", `logger: ${LOGGER_TYPE}\n  clock: { now: () => number }`),
      );

      const json = formatValidationReportJson(
        buildValidationReport(runCompositionChecks(appConfig, ctx)),
      );
      const parsed = (JSON.parse(json) as { issues: ValidationIssue[] }).issues;
      assert.ok(Array.isArray(parsed));

      const integrity = parsed.find(
        (i) => i.category === "registry-integrity" && i.severity === "error",
      );
      assert.ok(integrity, "the category survives serialization");
      assert.equal(typeof integrity.summary, "string");
      assert.ok(Array.isArray(integrity.details));
      assert.equal(typeof integrity.suggestedFix, "string");
    });
  });
});
