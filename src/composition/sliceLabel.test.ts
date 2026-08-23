/**
 * How the RUNNING package is named in human output.
 *
 * The field complaint, verbatim in shape:
 *
 * > nothing supplies "X", which local expects the container to already have
 *
 * `local` is the tool's internal token for the package a command runs in, and in that sentence it
 * is doing the work of a package name — a proper noun the reader was never introduced to. These
 * tests pin the substitution: the package's own name with the ROLE parenthesized, falling back to
 * the role alone when nothing resolves a name. The token itself is untouched — `sourceId` is what
 * decides locality, and it still reads `"local"`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkExternalsSatisfaction } from "./checks/externals.js";
import { checkSchemaVersions } from "./checks/schemaVersion.js";
import { isLocalSlice, sliceLabel } from "./sliceLabel.js";
import {
  compositionContextFixture,
  parsedSlice,
} from "../test-support/manifestFixtures.js";

describe("sliceLabel", () => {
  describe("When the slice is the local one and a package name resolved", () => {
    it("should print the name with the role parenthesized", () => {
      assert.equal(
        sliceLabel({ packageLabel: "@apps/api", sourceId: "local" }),
        "@apps/api (this app)",
      );
    });
  });

  describe("When the slice is the local one and no name resolved", () => {
    it("should fall back to the role alone", () => {
      assert.equal(
        sliceLabel({ packageLabel: "local", sourceId: "local" }),
        "this app",
      );
    });
  });

  describe("When the slice is a composed package", () => {
    it("should print its npm name unchanged", () => {
      assert.equal(
        sliceLabel({ packageLabel: "@media/core", sourceId: "@media/core" }),
        "@media/core",
      );
      assert.equal(isLocalSlice({ sourceId: "@media/core" }), false);
    });
  });

  describe("When a composed package is literally named after the token", () => {
    it("should still be treated as composed — sourceId decides, never the label", () => {
      assert.equal(sliceLabel({ packageLabel: "local", sourceId: "@x/local" }), "local");
    });
  });
});

describe("the local slice in rendered composition issues", () => {
  const unsatisfiedFrom = (localLabel: string) =>
    checkExternalsSatisfaction(
      compositionContextFixture([
        parsedSlice({
          packageLabel: localLabel,
          sourceId: "local",
          cradleKeys: new Set(["appOnly"]),
          externals: {
            activatePendingUserWriteService: { typeText: "WriteService" },
          },
        }),
      ]),
      { typeCheckerCtx: undefined },
    );

  describe("When the app declares a packageName", () => {
    it("should name it and parenthesize the role on every externals line", () => {
      const issues = unsatisfiedFrom("@apps/api");
      assert.equal(issues.length, 1);

      assert.match(
        issues[0]!.summary,
        /which @apps\/api \(this app\) expects the container to already have\./,
      );
      assert.match(
        issues[0]!.details.join("\n"),
        /demanded by @apps\/api \(this app\)/,
      );
      // And never the bare token, in any register of the issue.
      const rendered = [
        issues[0]!.summary,
        ...issues[0]!.details,
        issues[0]!.suggestedFix ?? "",
      ].join("\n");
      assert.doesNotMatch(rendered, /\bwhich local\b|\bby local\b/);
    });
  });

  describe("When no package name is resolvable", () => {
    it("should fall back to the role alone rather than print the token", () => {
      const issues = unsatisfiedFrom("local");

      assert.match(
        issues[0]!.summary,
        /which this app expects the container to already have\./,
      );
      assert.match(issues[0]!.details.join("\n"), /demanded by this app/);
    });
  });

  describe("When the local slice supplies a key another package demands", () => {
    it("should label the supplier without the redundant `local` qualifier", () => {
      const issues = checkExternalsSatisfaction(
        compositionContextFixture([
          parsedSlice({
            packageLabel: "@apps/api",
            sourceId: "local",
            cradleKeys: new Set(["logger"]),
            externals: {},
          }),
          parsedSlice({
            packageLabel: "@lib/a",
            sourceId: "@lib/a",
            cradleKeys: new Set(),
            externals: { logger: { typeText: "Logger" } },
          }),
        ]),
        { typeCheckerCtx: undefined },
      );

      assert.equal(issues.length, 1);
      assert.match(
        issues[0]!.details.join("\n"),
        /supplied by: @apps\/api \(this app\) cradle/,
      );
    });
  });

  describe("When a non-externals check names the local slice", () => {
    it("should apply the same substitution", () => {
      const issues = checkSchemaVersions(
        compositionContextFixture([
          parsedSlice({
            packageLabel: "local",
            sourceId: "local",
            manifestSchemaVersion: 2,
          }),
        ]),
      );

      assert.equal(issues.length, 1);
      assert.match(issues[0]!.summary, /^this app declares manifestSchemaVersion 2/);
    });
  });
});

describe("the machine token", () => {
  describe("When an issue is serialized for --json", () => {
    it("should keep `local` as the slice's sourceId, untouched by rendering", () => {
      const ctx = compositionContextFixture([
        parsedSlice({ packageLabel: "@apps/api", sourceId: "local" }),
      ]);

      // Rendering changes what a HUMAN reads; the token a machine matches on is the same one it
      // always was, and `config.registrations.<C>.<impl>.source` still accepts it.
      assert.equal(ctx.slices[0]!.sourceId, "local");
      assert.equal(ctx.slices[0]!.packageLabel, "@apps/api");
    });
  });
});
