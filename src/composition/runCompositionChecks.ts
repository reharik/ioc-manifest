/**
 * @fileoverview The composition suite — the one implementation of every cross-manifest check.
 *
 * ### The principle
 *
 * **Everything gen can know, gen enforces; validate exists to run the same checks without
 * regenerating.**
 *
 * These checks used to live only in `ioc validate`. An app package's `generate` already COMPOSES —
 * it loads composed manifests, emits `ioc-composed.ts`, walks composed subtrees, resolves composed
 * opener and slot keys — but it did not JUDGE the composition. For the primary workflow, where
 * generated output is not checked in and gen runs on every change, `validate` structurally never
 * runs, so this entire layer was dead code in practice: gen passed while validate had all manner
 * of errors. Both verbs call this module now, over the same program, and can only disagree by
 * disagreeing with themselves.
 */
import type { IocConfig } from "../config/iocConfig.js";
import { checkAppConfigSanity } from "./checks/appConfig.js";
import { checkDefaultAmbiguity } from "./checks/defaultAmbiguity.js";
import { checkExternalsSatisfaction } from "./checks/externals.js";
import { checkGroupConsistency } from "./checks/groups.js";
import { checkRegistryIntegrity } from "./checks/registryIntegrity.js";
import { checkSameKeyConflicts } from "./checks/sameKeyConflict.js";
import { checkSchemaVersions } from "./checks/schemaVersion.js";
import { checkSlotOccupancy } from "./checks/slotOccupancy.js";
import { createCompositionProgram } from "./compositionProgram.js";
import { timePhase } from "../diagnostics/phaseTiming.js";
import type { CompositionContext, ValidationIssue } from "./types.js";

/**
 * Every composition check, aggregated — never first-failure-wins.
 *
 * A red run names every problem it can see in one pass, in both verbs. That shape is why validate
 * was useful, and it is exactly what a generation failure needs to keep: a developer whose gen
 * just went red should get the whole fix list, not one error at a time across four re-runs.
 */
export const runCompositionChecks = (
  config: IocConfig,
  ctx: CompositionContext,
): ValidationIssue[] => {
  // Built once, here, and shared: the integrity gate must adjudicate the SAME program the
  // comparisons then read types out of, or it is vouching for something else.
  const programCtx = timePhase("composition: TypeScript program", () =>
    createCompositionProgram({
      projectRoot: ctx.projectRoot,
      sourceFiles: ctx.sourceFiles,
      typesPaths: ctx.slices.map((slice) => slice.typesPath),
      ...(ctx.pendingArtifacts !== undefined
        ? { overlay: ctx.pendingArtifacts }
        : {}),
      ...(ctx.tsconfig !== undefined ? { tsconfig: ctx.tsconfig } : {}),
    }),
  );
  const integrity = timePhase("composition: registry integrity", () =>
    checkRegistryIntegrity(ctx, programCtx),
  );

  return [
    ...checkSchemaVersions(ctx),
    ...integrity.issues,
    ...timePhase("composition: externals satisfaction", () =>
      checkExternalsSatisfaction(ctx, {
        typeCheckerCtx: programCtx,
        brokenTypesPaths: integrity.brokenTypesPaths,
      }),
    ),
    ...checkSameKeyConflicts(ctx),
    ...timePhase("composition: group consistency", () =>
      checkGroupConsistency(ctx),
    ),
    ...checkDefaultAmbiguity(ctx),
    ...checkSlotOccupancy(ctx),
    ...checkAppConfigSanity(config, ctx),
  ];
};
