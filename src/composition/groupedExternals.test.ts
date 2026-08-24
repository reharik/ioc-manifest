/**
 * `stale-app-demands-now-grouped-key` — the grouped mirror of codegen's `grouped-member-demand`.
 *
 * The field case: an app's committed artifacts predate a library contract's regrouping. Validate is
 * right that nothing supplies the key — a grouped contract claims no individual cradle key, so
 * nothing CAN — but its generic remedy told the reader to "register a factory for it in this app",
 * which is a shadow registration of another package's family member. That is the one fix the group
 * law exists to forbid, and the same advice codegen stopped giving in the demand-model pass.
 *
 * These tests pin the swapped guidance across all three spellings a stale `IocExternals` can carry
 * (member registration key, member contract key, the base's would-be slot key), both group kinds,
 * and the absence of the register-a-factory sentence.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkExternalsSatisfaction } from "./checks/externals.js";
import { buildComposedGroupKeyIndex } from "./composedGroupIndex.js";
import {
  compositionContextFixture,
  parsedSlice,
} from "../test-support/manifestFixtures.js";
import type { ParsedManifestSlice } from "./types.js";

const LIB = "@media/core";

/**
 * The library's group roots, as its manifest states them.
 *
 * `writeServices` is a RECORD group: property keys are contract keys, and `archiveUserWriteService`
 * is keyed by its contract while the container resolves it from `legacyArchiveWriter` — the only
 * shape that can tell the record property from the registration key. `changeLogSinks` is a
 * COLLECTION group, whose members are individually anonymous.
 */
const LIBRARY_GROUP_ROOTS: ParsedManifestSlice["groupRoots"] = {
  writeServices: {
    kind: "object",
    baseType: "WriteService",
    baseTypeId: "@media/core/src/types/WriteService.ts:WriteService",
    members: {
      activatePendingUserWriteService: {
        contractName: "ActivatePendingUserWriteService",
        registrationKey: "activatePendingUserWriteService",
      },
      archiveUserWriteService: {
        contractName: "ArchiveUserWriteService",
        registrationKey: "legacyArchiveWriter",
      },
    },
  },
  changeLogSinks: {
    kind: "collection",
    baseType: "ChangeLogSink",
    baseTypeId: "@media/core/src/types/ChangeLogSink.ts:ChangeLogSink",
    members: [
      { contractName: "ChangeLogSink", registrationKey: "fileChangeLog" },
      { contractName: "ChangeLogSink", registrationKey: "wireChangeLog" },
    ],
  },
};

/** A stale app whose `IocExternals` still demands `staleKey`, against the regrouped library. */
const staleAppAgainstLibrary = (staleKey: string, typeText = "WriteService") =>
  compositionContextFixture([
    parsedSlice({
      packageLabel: "@apps/api",
      sourceId: "local",
      cradleKeys: new Set(["authService"]),
      externals: { [staleKey]: { typeText } },
    }),
    parsedSlice({
      packageLabel: LIB,
      sourceId: LIB,
      cradleKeys: new Set(["writeServices", "changeLogSinks"]),
      groupRoots: LIBRARY_GROUP_ROOTS,
      externals: {},
    }),
  ]);

const issueFor = (staleKey: string, typeText?: string) => {
  const issues = checkExternalsSatisfaction(
    staleAppAgainstLibrary(staleKey, typeText),
    { typeCheckerCtx: undefined },
  );
  assert.equal(issues.length, 1, `expected one issue for ${staleKey}`);
  return issues[0]!;
};

const renderedText = (issue: ReturnType<typeof issueFor>): string =>
  [issue.summary, ...issue.details, issue.suggestedFix ?? ""].join("\n");

describe("buildComposedGroupKeyIndex", () => {
  describe("When a composed manifest declares group roots", () => {
    it("should account for a key by registration, contract and base spelling", () => {
      const index = buildComposedGroupKeyIndex(
        staleAppAgainstLibrary("anything"),
      );

      // Registration key.
      assert.equal(index.get("legacyArchiveWriter")?.groupKey, "writeServices");
      // Contract key — the record's own property, which is what the group value exposes.
      assert.equal(
        index.get("archiveUserWriteService")?.memberProperty,
        "archiveUserWriteService",
      );
      // The base's would-be slot key.
      assert.equal(index.get("writeService")?.groupKey, "writeServices");
      assert.equal(index.get("writeService")?.contractName, undefined);
      // Collection members, by registration key and by their contract's would-be key.
      assert.equal(index.get("fileChangeLog")?.groupKey, "changeLogSinks");
      assert.equal(index.get("changeLogSink")?.groupKey, "changeLogSinks");
    });

    it("should leave a key no group accounts for unindexed", () => {
      const index = buildComposedGroupKeyIndex(
        staleAppAgainstLibrary("anything"),
      );
      assert.equal(index.get("logger"), undefined);
    });
  });
});

describe("stale-app-demands-now-grouped-key", () => {
  const spellings = [
    { name: "the member's registration key", key: "activatePendingUserWriteService" },
    { name: "a member's contract key", key: "archiveUserWriteService" },
    { name: "the group base's would-be slot key", key: "writeService" },
  ] as const;

  for (const spelling of spellings) {
    describe(`When the stale external is ${spelling.name}`, () => {
      it("should report the grouped guidance, naming the composed group", () => {
        const issue = issueFor(spelling.key);

        assert.equal(issue.category, "externals");
        assert.equal(issue.severity, "error");
        assert.match(
          issue.summary,
          /is a member of composed group "writeServices" and has no individual cradle key\./,
        );
        assert.match(
          issue.details.join("\n"),
          /^group: +"writeServices" {2}\(kind: object, declared by @media\/core\)$/m,
        );
      });

      it("should never prescribe a shadow registration in this app", () => {
        const text = renderedText(issueFor(spelling.key));

        // The generic externals remedy, which for a grouped member names a forbidden fix.
        assert.doesNotMatch(text, /Register a factory/);
        assert.doesNotMatch(text, /compose another manifest that supplies it/);
        assert.doesNotMatch(text, /No composed manifest offers this key/);
      });

      it("should tell the reader to regenerate this app", () => {
        const text = renderedText(issueFor(spelling.key));
        assert.match(text, /re-run `ioc generate`/);
      });

      it("should point at the group law rather than the externals page", () => {
        assert.equal(
          issueFor(spelling.key).docUrl,
          "https://reharik.github.io/ioc-manifest/concepts/groups#grouped-means-group-only",
        );
      });
    });
  }

  describe("When the group is a RECORD kind", () => {
    it("should name the record's own property key, never the registration key", () => {
      // `archiveUserWriteService` is exposed under its CONTRACT key while the container resolves it
      // from `legacyArchiveWriter`. Suggesting the latter would name a property the group value
      // does not have — the same divergence the codegen-side doors pin.
      const text = renderedText(issueFor("legacyArchiveWriter"));

      assert.match(
        text,
        /Consume it through the group: `writeServices: WriteServices`, then `writeServices\.archiveUserWriteService`\./,
      );
      assert.doesNotMatch(text, /writeServices\.legacyArchiveWriter/);
      // The PascalCase leak guard, applied on this side too.
      assert.doesNotMatch(text, /writeServices\.[A-Z]/);
    });
  });

  describe("When the group is a COLLECTION kind", () => {
    it("should say the members are anonymous rather than name a property", () => {
      const text = renderedText(issueFor("fileChangeLog", "ChangeLogSink"));

      assert.match(
        text,
        /Consume it through the group: `changeLogSinks: ChangeLogSinks` — a collection group's members are individually anonymous by declaration/,
      );
      assert.doesNotMatch(text, /changeLogSinks\.[A-Za-z]/);
      assert.doesNotMatch(text, /Register a factory/);
    });
  });

  describe("When the unsatisfied key is not any group's business", () => {
    it("should keep the ordinary externals guidance", () => {
      const issue = issueFor("logger", "Logger");

      assert.match(issue.summary, /nothing supplies "logger"/);
      assert.match(issue.suggestedFix!, /Register a factory for Logger/);
      assert.equal(
        issue.docUrl,
        undefined,
        "the ordinary issue takes its category's pointer at report-build time",
      );
    });
  });
});
