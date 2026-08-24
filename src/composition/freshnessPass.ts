/**
 * @fileoverview Asks, of every package in a composed picture, whether its artifacts may predate its
 * sources — and marks the findings that rest on one that may.
 *
 * ### Why it is a pass over the composed set and not a check
 *
 * It is not a `ValidationIssue` producer. Nothing here can fail a build: the ruling is warn loud,
 * never abort (see `diagnostics/freshness.ts` for why). What it produces is a verdict PER PACKAGE,
 * which the surfaces banner, and a taint on the issues the other checks already found, which those
 * issues carry inline.
 *
 * The taint is the half that matters. A banner at the top of a report is read by someone who is
 * reading the report from the top; the developer who has run `ioc validate` for the fourth time
 * today scrolls to the first `[externals]` and starts fixing it. That reader has to meet the caveat
 * on the finding itself or not at all, which is why every check now carries
 * {@link import("./types.js").ValidationIssue.packages} — so a finding can say which packages'
 * artifacts it rests on, and this pass can answer whether any of them is suspect.
 *
 * ### Attribution is by machine token
 *
 * `packages` holds `sourceId`s — `"local"`, or the `composedManifests` entry — never the rendered
 * label. Matching on rendered prose would make "is this finding suspect" depend on how a sentence
 * happens to be worded, and every check words its sentences differently on purpose.
 */
import path from "node:path";
import type { IocConfig } from "../config/iocConfig.js";
import { readGenerationRecord } from "../diagnostics/generationState.js";
import {
  caveatNameFor,
  formatFreshnessCaveat,
  isStale,
  judgeFreshness,
  type PackageFreshness,
} from "../diagnostics/freshness.js";
import {
  currentInputsForConfig,
  currentInputsForPackageRoot,
} from "../diagnostics/currentInputsHash.js";
import { findPackageDirectory } from "../generator/resolveComposedPackageExport.js";
import { isLocalSlice, sliceLabel } from "./sliceLabel.js";
import type { ParsedManifestSlice, ValidationIssue } from "./types.js";

export type AssessFreshnessInput = {
  readonly projectRoot: string;
  /** The running package's config path — fingerprinted as one of its own inputs. */
  readonly configPath: string;
  readonly config: IocConfig;
  readonly slices: readonly ParsedManifestSlice[];
  /**
   * Whether to judge the LOCAL package too.
   *
   * `ioc validate` does: it reports on committed artifacts, so the app's own can be behind its own
   * sources like anyone else's. App-mode `ioc generate` does not: it is READING those sources right
   * now and about to rewrite the artifacts from them, so "the local artifacts are old" is both true
   * and about to stop being true, and saying it would be noise on every single run.
   */
  readonly includeLocal: boolean;
};

/**
 * Where a package's generation record lives, derived from its manifest exactly the way the loaders
 * derive the manifest itself — dirname of the manifest is the generated dir, and the record sits
 * beside that. No second notion of "where a package's output is" is introduced here.
 */
const generatedDirOf = (slice: ParsedManifestSlice): string =>
  path.dirname(slice.manifestPath);

export const assessFreshness = async (
  input: AssessFreshnessInput,
): Promise<readonly PackageFreshness[]> => {
  const out: PackageFreshness[] = [];

  for (const slice of input.slices) {
    const local = isLocalSlice(slice);
    if (local && !input.includeLocal) {
      continue;
    }

    const record = readGenerationRecord(generatedDirOf(slice));
    const current = local
      ? await currentInputsForConfig(
          input.projectRoot,
          input.configPath,
          input.config,
        )
      : await currentInputsForPackageRoot(
          resolvePackageRootQuietly(input.projectRoot, slice.sourceId),
        );

    out.push(
      judgeFreshness({
        // The rendered label, because this is what the banner prints. The `sourceId` beside it is
        // what the taint matches on.
        name: local ? slice.packageLabel : sliceLabel(slice),
        sourceId: slice.sourceId,
        record,
        currentHash: current.hash,
        ...(current.unknown !== undefined
          ? { currentUnknown: current.unknown }
          : {}),
      }),
    );
  }

  return out;
};

/**
 * The composed package's directory, or a path that will simply hold no config.
 *
 * A package whose directory cannot be resolved is one whose sources cannot be re-read, which is
 * already the "unknown" answer — so the resolution failure produces that answer directly instead of
 * propagating out of a diagnostic pass and taking the whole report with it.
 */
const resolvePackageRootQuietly = (
  projectRoot: string,
  packageName: string,
): string => {
  try {
    return findPackageDirectory(projectRoot, packageName);
  } catch {
    return path.join(projectRoot, "node_modules", packageName);
  }
};

/**
 * Marks every finding that resolves through a package whose artifacts may predate its sources.
 *
 * Findings with no attribution are left alone rather than tainted by default. An `app-config`
 * complaint about a `source` naming a package that is not composed reads no manifest at all; a
 * caveat there would be telling the reader to doubt something that has nothing to doubt.
 */
export const applyFreshnessTaint = (
  issues: readonly ValidationIssue[],
  freshness: readonly PackageFreshness[],
): readonly ValidationIssue[] => {
  const staleBySourceId = new Map(
    freshness.filter(isStale).map((entry) => [entry.sourceId, entry] as const),
  );
  if (staleBySourceId.size === 0) {
    return issues;
  }

  return issues.map((issue) => {
    const hits = (issue.packages ?? [])
      .map((sourceId) => staleBySourceId.get(sourceId))
      .filter((entry): entry is PackageFreshness => entry !== undefined);
    if (hits.length === 0) {
      return issue;
    }
    return {
      ...issue,
      possiblyStale: true as const,
      stalenessNote: formatFreshnessCaveat(hits.map(caveatNameFor)),
    };
  });
};
