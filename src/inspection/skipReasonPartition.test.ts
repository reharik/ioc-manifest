/**
 * The partition and gloss tables are exhaustive by type. The type guarantee is the real one; these
 * tests exist so it survives a stray `as` somewhere upstream, and so a new reason cannot be added
 * with a classification but no sentence.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IocDiscoverySkipReason } from "../generator/discoverFactories/discoveryOutcomeTypes.js";
import {
  IOC_DISCOVERY_SKIP_REASON_GLOSS,
  IOC_DISCOVERY_SKIP_REASON_PARTITION,
  glossForSkipReason,
  partitionForSkipReason,
} from "./skipReasonPartition.js";
import { IOC_GROUP_REJECTION_GLOSS } from "../groups/baseTypeAssignability.js";

const ALL_REASONS = Object.values(IocDiscoverySkipReason);

describe("skip reason partition", () => {
  describe("When every skip reason is looked up", () => {
    it("should classify each one as near_miss or not_a_candidate", () => {
      for (const reason of ALL_REASONS) {
        const partition = partitionForSkipReason(reason);
        assert.ok(
          partition === "near_miss" || partition === "not_a_candidate",
          `unclassified skip reason ${reason}`,
        );
      }
      assert.equal(
        Object.keys(IOC_DISCOVERY_SKIP_REASON_PARTITION).length,
        ALL_REASONS.length,
      );
    });

    it("should keep the documented not-a-candidate set", () => {
      const notCandidates = ALL_REASONS.filter(
        (r) => partitionForSkipReason(r) === "not_a_candidate",
      ).sort();

      assert.deepEqual(notCandidates, [
        "class_abstract",
        "excluded_by_config",
        "no_factory_pattern_in_source",
        "no_matching_export",
      ]);
    });
  });

  describe("When every near-miss reason is glossed", () => {
    it("should carry a non-empty sentence", () => {
      for (const reason of ALL_REASONS) {
        if (partitionForSkipReason(reason) !== "near_miss") continue;
        const gloss = glossForSkipReason(reason);
        assert.ok(
          gloss !== undefined && gloss.length > 0,
          `missing gloss for ${reason}`,
        );
      }
    });

    it("should gloss the conditionally promoted class_abstract reason too", () => {
      assert.ok(
        glossForSkipReason(IocDiscoverySkipReason.CLASS_ABSTRACT) !== undefined,
      );
    });

    it("should not gloss reasons that are never near-misses", () => {
      assert.equal(
        glossForSkipReason(IocDiscoverySkipReason.NO_MATCHING_EXPORT),
        undefined,
      );
      assert.equal(
        Object.keys(IOC_DISCOVERY_SKIP_REASON_GLOSS).length,
        ALL_REASONS.filter((r) => partitionForSkipReason(r) === "near_miss")
          .length + 1,
      );
    });
  });
});

describe("group rejection gloss", () => {
  describe("When every rejection reason is looked up", () => {
    it("should carry a non-empty sentence", () => {
      const reasons = [
        "base_type_not_named",
        "contract_type_not_named",
        "nominal_heritage_not_declared",
        "contract_type_unresolved",
      ] as const;

      assert.deepEqual(
        Object.keys(IOC_GROUP_REJECTION_GLOSS).sort(),
        [...reasons].sort(),
      );
      for (const reason of reasons) {
        assert.ok(IOC_GROUP_REJECTION_GLOSS[reason].length > 0);
      }
    });
  });
});
