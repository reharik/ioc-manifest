/**
 * @fileoverview Which composed externals have their assertion relocated to a scope boundary, and to
 * which openers.
 *
 * ### The seam this module is
 *
 * `composition/checks/externals.ts` decides what to REPORT about a scope-reachable key.
 * `writeComposedManifest.ts` decides what to EMIT for one. Both answers come from the same
 * classification, and they must agree exactly: a key the report clears while the emitted assertion
 * still demands it produces a green `ioc generate` and a red `tsc` over that run's own output —
 * which is the failure this whole pass exists to close. So the classification is read once, here,
 * and handed to both.
 *
 * ### What relocates, and to where
 *
 * Only **scope-reachable and satisfied** keys: every variant that reaches the key carries it, and
 * the assertion moves onto those variants' openers. A key some variant fails to carry is an ERROR
 * instead, reported by the externals check, and generation never reaches emission — there is no
 * third state where an assertion is emitted against a boundary already said to be wrong.
 *
 * A key satisfied by `scopeProvided` rather than by a declared lbv relocates with an EMPTY opener
 * list: the value is registered onto the child scope by hand and never travels through an opener's
 * parameter, so there is no signature to assert against.
 *
 * An `unreachable` key — one no path reaches AND every factory demanding it is scoped — leaves the
 * pick too, with no opener to re-assert against. It is not "relocated" in the moving sense; the
 * obligation is gone rather than owed elsewhere. It travels through this module all the same
 * because the emission mechanism is the same one: what makes a cleared key safe is leaving the
 * `Pick<AppCradle, …>`, and a key the check clears while the pick still names it is exactly the
 * green-generate/red-tsc split this module exists to prevent.
 *
 * `unreachable-blocked` does NOT leave the pick, because the externals check does not clear it —
 * the fall-through in `composition/checks/externals.ts` says why.
 */
import type {
  ComposedResolutionGraph,
  ScopeVariantReach,
} from "../composition/composedResolutionGraph.js";
import { classifyExternalReachability } from "../composition/composedResolutionGraph.js";
import type { CompositionContext } from "../composition/types.js";
import type { RelocatedExternalAssertion } from "./writeComposedManifest.js";

export type RelocatedExternalsInput = {
  readonly context: CompositionContext;
  readonly graph: ComposedResolutionGraph;
  /** `ioc.config.scopeProvided` — an explicit statement that a key enters at a scope boundary. */
  readonly scopeProvidedKeys: readonly string[];
};

/**
 * Openers that must carry the key, sorted and deduplicated.
 *
 * Only variants that DECLARE the key in their late-bound-value set are named. A variant satisfied
 * by `scopeProvided` instead is deliberately left out: that declaration says the value is
 * registered onto the child scope by hand, so it never passes through the opener's parameter, and
 * an assertion against a signature that was never going to carry it would fail a correct build.
 *
 * Sorted for the same reason every other emitted list is: the artifact has to be byte-stable across
 * runs, and map iteration order is not a contract worth resting that on.
 */
const openerKeysFor = (
  key: string,
  reaches: readonly ScopeVariantReach[],
): string[] =>
  [
    ...new Set(
      reaches
        .filter((reach) => reach.variant.declaredLbvKeys.includes(key))
        .map((reach) => reach.variant.openerKey),
    ),
  ].sort((a, b) => a.localeCompare(b));

/**
 * The relocated assertions for one composed package, by its `sourceId`.
 *
 * Keyed by `sourceId` rather than by display label because that is the token the composed package
 * specs are resolved under — a label is prose and can collide.
 */
export const relocatedExternalsBySourceId = (
  input: RelocatedExternalsInput,
): ReadonlyMap<string, readonly RelocatedExternalAssertion[]> => {
  const scopeProvided = new Set(input.scopeProvidedKeys);
  const bySourceId = new Map<string, RelocatedExternalAssertion[]>();

  input.context.slices.forEach((slice, sliceIndex) => {
    for (const externalKey of Object.keys(slice.externals)) {
      // A key something in the composed set SUPPLIES is satisfied the ordinary way and never
      // relocates: the root cradle really does have it, and the existing assertion is the true one.
      const supplied = input.context.slices.some((candidate) =>
        candidate.cradleKeys.has(externalKey),
      );
      if (supplied) {
        continue;
      }

      const reachability = classifyExternalReachability(
        input.graph,
        externalKey,
        sliceIndex,
        scopeProvided,
      );

      // A cleared key: no assertion, no opener, and out of the pick. The externals check reports
      // nothing for it, so an assertion left behind here would fail `tsc` over an artifact this
      // very run declared clean.
      if (reachability.kind === "unreachable") {
        const cleared = bySourceId.get(slice.sourceId) ?? [];
        cleared.push({
          key: externalKey,
          reachingOpenerKeys: [],
          reason: "unreachable",
        });
        bySourceId.set(slice.sourceId, cleared);
        continue;
      }

      // `unreachable-blocked` keeps its assertion: the externals check reports it as an ordinary
      // unsatisfied external, so the emitted artifact must keep demanding it. See the fall-through
      // in `composition/checks/externals.ts` for why that classification is not acted on.
      if (reachability.kind !== "scope-only") {
        continue;
      }
      // An unsatisfied variant means the externals check is about to fail the run. Emission is not
      // reached, and relocating an assertion onto a boundary already judged wrong would be emitting
      // a claim this run has contradicted.
      if (reachability.reaches.some((reach) => !reach.satisfied)) {
        continue;
      }

      // No early return on an empty opener list. The key still RELOCATES — it must leave the
      // `AppCradle` pick, where it could only ever be false — and an empty list simply means every
      // reach was settled by `scopeProvided`, which carries no signature to assert against.
      const openerKeys = openerKeysFor(externalKey, reachability.reaches);

      const entries = bySourceId.get(slice.sourceId) ?? [];
      entries.push({ key: externalKey, reachingOpenerKeys: openerKeys });
      bySourceId.set(slice.sourceId, entries);
    }
  });

  // Key order follows `IocExternals` property order, which emission already follows for the
  // non-relocated keys — so a key moving between the two blocks does not also move in the file.
  return bySourceId;
};
