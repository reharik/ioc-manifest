/**
 * The producing side of dependency-key coverage.
 *
 * A package containing a factory written `(deps: Deps)` withholds `"dependencyKeysComplete"`, and
 * every app that composes it prints an advisory naming the package. The author of that factory —
 * the only person who can fix it — heard nothing, in the one repo where the fix lives. These tests
 * pin the message that closes that gap, per unreadable shape.
 *
 * Each case asserts the same three things, because each is a way the old silence came back: the
 * FACTORY (so the fix is a jump, not a hunt), the MODULE PATH (so it is the right factory), and the
 * SHAPE (so the reader is told what they wrote, not merely that something was wrong).
 */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import type { UnknownDependencyKeysUnit } from "./discoverFactories/discoverFactories.js";
import {
  formatUnknownDependencyKeysReport,
  reportUnknownDependencyKeys,
} from "./reportUnknownDependencyKeys.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(
  __dirname,
  "test-fixtures",
  "unknown-dependency-keys",
);
const projectRoot = path.resolve(__dirname, "../..");
const srcDir = path.join(projectRoot, "src");
const generatedDir = path.join(srcDir, "generated");
const scanDirs = [{ absPath: srcDir }];

const FIXTURE_FILES = [
  "contracts.ts",
  "logger.ts",
  "readable.ts",
  "non-destructured.ts",
  "defaulted.ts",
  "array-binding.ts",
  "rest-element.ts",
  "nested-binding.ts",
  "computed-property.ts",
  "callable-parameter-type.ts",
].map((f) => path.join(fixtureDir, f));

/**
 * One discovery over the whole fixture, shared by every case. The pass is deterministic and the
 * fixture is fixed, so re-running it per shape buys nothing but seconds.
 */
const discovered = ((): readonly UnknownDependencyKeysUnit[] => {
  const program = ts.createProgram({
    rootNames: FIXTURE_FILES,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });
  return discoverFactories(FIXTURE_FILES, program, projectRoot, "build", {
    projectRoot,
    scanDirs,
    generatedDir,
  }).unknownDependencyKeyUnits;
})();

const reportFor = (exportName: string): string => {
  const unit = discovered.find((u) => u.exportName === exportName);
  assert.ok(
    unit !== undefined,
    `expected "${exportName}" to be reported as unreadable; reported: ${discovered
      .map((u) => u.exportName)
      .join(", ")}`,
  );
  return formatUnknownDependencyKeysReport([unit]);
};

/** The three invariants every case shares, checked in one place so no case can quietly drop one. */
const assertNamesFactoryModuleAndShape = (
  report: string,
  expected: { exportName: string; moduleFile: string; shape: string },
): void => {
  assert.match(
    report,
    new RegExp(`"${expected.exportName}"`),
    "the report must name the factory",
  );
  assert.match(
    report,
    new RegExp(expected.moduleFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "the report must name the module path",
  );
  assert.match(
    report,
    new RegExp(`\\[${expected.shape}\\]`),
    "the report must name the shape that caused it",
  );
};

describe("unknown dependency keys, reported to the package that produced them", () => {
  describe("When a factory takes its dependencies as a plain parameter", () => {
    it("should name the factory, its module and the non-destructured shape", () => {
      const report = reportFor("buildNonDestructured");

      assertNamesFactoryModuleAndShape(report, {
        exportName: "buildNonDestructured",
        moduleFile: "non-destructured.ts",
        shape: "non-destructured-parameter",
      });
      assert.match(report, /written: \(deps: NonDestructuredDeps\)/);
      assert.match(report, /destructure the first parameter/);
    });
  });

  describe("When the plain parameter also carries a default", () => {
    it("should name the defaulted shape and keep the default in the suggested fix", () => {
      // Reporting this as plain "non-destructured" would send the reader to delete the default,
      // which changes behaviour and does not fix the diagnostic.
      const report = reportFor("buildDefaulted");

      assertNamesFactoryModuleAndShape(report, {
        exportName: "buildDefaulted",
        moduleFile: "defaulted.ts",
        shape: "defaulted-parameter",
      });
      assert.match(report, /The default is not the problem/);
      assert.match(report, /keep the default on the pattern/);
    });
  });

  describe("When the first parameter is an array binding pattern", () => {
    it("should name the array-binding shape and say the cradle is keyed, not positional", () => {
      const report = reportFor("buildArrayBinding");

      assertNamesFactoryModuleAndShape(report, {
        exportName: "buildArrayBinding",
        moduleFile: "array-binding.ts",
        shape: "array-binding-parameter",
      });
      assert.match(report, /not a positional tuple/);
    });
  });

  describe("When the binding pattern ends in a rest element", () => {
    it("should name the rest shape and say the keys it did list are discarded too", () => {
      // The one that looks idiomatic. A reader seeing only "keys could not be read" would point at
      // the `logger` right there in the pattern and conclude the tool is broken — so the message
      // has to say, in as many words, that naming a key and then adding `...rest` discards it.
      const report = reportFor("buildRestElement");

      assertNamesFactoryModuleAndShape(report, {
        exportName: "buildRestElement",
        moduleFile: "rest-element.ts",
        shape: "rest-element",
      });
      assert.match(
        report,
        /looks like it records its demands and does the opposite/,
      );
      assert.match(
        report,
        /cannot be trusted as the whole set and all of them are discarded/,
      );
      assert.match(report, /drop the rest element/);
    });
  });

  describe("When the binding pattern destructures through a nested pattern", () => {
    it("should name the nested shape and say the bound name is not a cradle key", () => {
      const report = reportFor("buildNestedBinding");

      assertNamesFactoryModuleAndShape(report, {
        exportName: "buildNestedBinding",
        moduleFile: "nested-binding.ts",
        shape: "nested-binding",
      });
      assert.match(
        report,
        /a property of a dependency rather than a cradle key/,
      );
    });
  });

  describe("When the binding pattern uses a computed property name", () => {
    it("should name the computed shape and ask for a literal key", () => {
      const report = reportFor("buildComputedProperty");

      assertNamesFactoryModuleAndShape(report, {
        exportName: "buildComputedProperty",
        moduleFile: "computed-property.ts",
        shape: "computed-property",
      });
      assert.match(report, /write the cradle key as a literal/);
    });
  });

  describe("When the destructured parameter's type is itself callable", () => {
    it("should name the callable shape rather than blame the destructuring", () => {
      const report = reportFor("buildCallableParameterType");

      assertNamesFactoryModuleAndShape(report, {
        exportName: "buildCallableParameterType",
        moduleFile: "callable-parameter-type.ts",
        shape: "callable-parameter-type",
      });
      assert.match(report, /no cradle keys to read/);
    });
  });

  describe("When TypeScript yields no readable signature for the unit", () => {
    it("should name the unresolvable shape and NOT advise destructuring", () => {
      /*
       * Unlike the shapes above, this one has no fixture: it fires when the checker returns no
       * signature or the module was never read into the program — states a source file cannot be
       * written into. It is still reachable in a real run (a file outside the program, an export
       * discovery cannot re-find), and it is exactly the branch that used to `continue` in silence,
       * so the wording is pinned from a hand-built record instead of skipped.
       */
      const report = formatUnknownDependencyKeysReport([
        {
          modulePath: "media/mediaServeController.ts",
          exportName: "buildMediaServeController",
          unitLabel: "registration unit",
          shape: "unresolvable-signature",
        },
      ]);

      assertNamesFactoryModuleAndShape(report, {
        exportName: "buildMediaServeController",
        moduleFile: "media/mediaServeController.ts",
        shape: "unresolvable-signature",
      });
      assert.match(report, /no readable signature/);
      assert.ok(
        !/destructure/.test(report.split("Each of these")[0]!),
        "there is nothing to destructure when the signature could not be read at all",
      );
    });
  });

  describe("When a factory's deps parameter IS readable", () => {
    it("should not appear in the report at all", () => {
      // The check has to stay quiet on the shape the docs recommend, or it trains people to ignore
      // it — the same trap the abstract-class warning had to be narrowed out of.
      assert.ok(
        !discovered.some((u) => u.exportName === "buildReadable"),
        "a destructured factory is fully readable",
      );
      assert.ok(
        !discovered.some((u) => u.exportName === "buildLogger"),
        "a factory with no parameters demands nothing, and is known to",
      );
    });
  });

  describe("When every offending shape in the fixture is collected", () => {
    it("should report each one exactly once, and only the offenders", () => {
      assert.deepStrictEqual([...discovered.map((u) => u.shape)].sort(), [
        "array-binding-parameter",
        "callable-parameter-type",
        "computed-property",
        "defaulted-parameter",
        "nested-binding",
        "non-destructured-parameter",
        "rest-element",
      ]);
    });
  });
});

describe("unknown dependency keys severity", () => {
  const offender: UnknownDependencyKeysUnit = {
    modulePath: "media/mediaServeController.ts",
    exportName: "buildMediaServeController",
    unitLabel: "registration unit",
    shape: "non-destructured-parameter",
  };

  const captureWarnings = (run: () => void): string[] => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]): void => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      run();
    } finally {
      console.warn = original;
    }
    return warnings;
  };

  describe("When no severity is configured", () => {
    it("should warn and let generation continue", () => {
      // The default cannot be `error`: `(deps: Deps)` RUNS — Awilix hands the proxy cradle over as
      // that one object — so failing the build over it would fail builds of working code on a
      // check that did not exist in the previous release.
      const warnings = captureWarnings(() => {
        reportUnknownDependencyKeys([offender], undefined);
      });
      assert.strictEqual(warnings.length, 1);
      assert.match(warnings[0]!, /buildMediaServeController/);
    });
  });

  describe('When dependencyKeyCoverage is "error"', () => {
    it("should throw the same report, before any artifact is written", () => {
      assert.throws(
        () =>
          reportUnknownDependencyKeys([offender], {
            discovery: { scanDirs: "src" },
            dependencyKeyCoverage: "error",
          }),
        /buildMediaServeController/,
      );
    });
  });

  describe('When dependencyKeyCoverage is "off"', () => {
    it("should say nothing, while the coverage token stays withheld regardless", () => {
      const warnings = captureWarnings(() => {
        reportUnknownDependencyKeys([offender], {
          discovery: { scanDirs: "src" },
          dependencyKeyCoverage: "off",
        });
      });
      assert.deepStrictEqual(warnings, []);
    });
  });
});
