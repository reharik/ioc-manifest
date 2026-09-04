/**
 * @fileoverview Generation-time diagnostic for accepted units whose deps parameter could not be
 * read — the PRODUCING side of the dependency-key coverage story.
 *
 * The consuming side already existed: a package that withholds `"dependencyKeysComplete"` makes
 * every app composing it print an advisory naming the package. But the advisory is printed in a
 * repo whose author cannot act on it — the fix is a one-line edit in the *library*, at a factory
 * whose name the advisory does not know. The author of that factory, running generation in their
 * own package, heard nothing at all. That asymmetry is what this module closes: the run that
 * produces the incomplete manifest names the units that made it incomplete, in the file, at the
 * line, quoting the parameter, with the edit that fixes it.
 *
 * WHY WARN AND NOT ERROR (by default). The class analogue — `CLASS_INVALID_CONSTRUCTOR_SHAPE` —
 * is a hard discovery error, and the temptation is to match it. It should not be matched by
 * default, because the two say different things. A class with a CLASSIC-mode constructor cannot be
 * constructed by the container at all: rejecting it stops broken code from shipping. A factory
 * written `(deps: Deps)` runs perfectly — Awilix passes the proxy cradle as that one object and
 * every property read resolves. What is defective is not the code, it is the generator's view of
 * it. A build tool that fails a build over code that works, on a check that did not exist in the
 * previous release, teaches teams to switch the check off rather than fix the factories.
 *
 * WHY IT IS STILL WORTH ERRORING ON, opt-in. The consequence is not cosmetic. A unit with no
 * recorded demand is skipped by the lifetime-inversion check, ends the scope-root subtree walk
 * early, and withholds the coverage token for the whole package — degrading every downstream
 * consumer's analysis, not just this one's. That is precisely the silent-skip failure class the
 * coverage token and the composed-supply lifetime fix were both about. So `dependencyKeyCoverage`
 * in `ioc.config` promotes this to a hard failure for teams that have cleaned their package and
 * want CI to hold the line (see {@link IocConfig.dependencyKeyCoverage}).
 *
 * AWILIX STRICT MODE DOES NOT CHANGE THE ANSWER, in either direction. `strict` is a RUNTIME
 * container option (`IocRuntimeOptions.strict`, default on) resolved in `bootstrap.ts`; generation
 * never observes it and cannot condition on it. And were it observable, it would argue the same
 * way for both settings: under `strict: false` an unchecked inversion resolves quietly and rots,
 * under `strict: true` it throws in production at the first resolve. Neither is a reason to be
 * quieter here.
 */
import type { DependencyKeysUnknownShape } from "./discoverFactories/inferFactoryDependencyContracts.js";
import type { UnknownDependencyKeysUnit } from "./discoverFactories/discoverFactories.js";
import type {
  IocConfig,
  IocDependencyKeyCoverage,
} from "../config/iocConfig.js";

/**
 * How each unreadable shape is described and repaired.
 *
 * `cause` is written to be recognisable as what the author typed — a reader must be able to match
 * the sentence to their own line without decoding a category name. `fix` is per-shape rather than
 * a shared "destructure the first parameter", because for three of these shapes that sentence
 * alone is wrong or incomplete advice: a defaulted parameter needs the default moved onto the
 * pattern, a rest element is already destructured, and an unresolvable signature has nothing to
 * destructure.
 */
const SHAPE_GUIDANCE: Record<
  DependencyKeysUnknownShape,
  { cause: string; fix: string }
> = {
  "non-destructured-parameter": {
    cause:
      "the first parameter is a plain identifier (`(deps: Deps)`), so the keys it will read off `deps` at runtime are not written anywhere this analysis can see",
    fix: "destructure the first parameter — `({ a, b }: Deps)` — naming the cradle keys the body uses",
  },
  "defaulted-parameter": {
    cause:
      "the first parameter is a plain identifier carrying a default (`(deps: Deps = ...)`), so the keys it will read off `deps` at runtime are not written anywhere this analysis can see. The default is not the problem; the missing destructuring is",
    fix: "destructure the first parameter and keep the default on the pattern — `({ a, b }: Deps = { ... })`",
  },
  "array-binding-parameter": {
    cause:
      "the first parameter is an array binding pattern (`([a, b]: Deps)`), and the cradle is an object keyed by registration name, not a positional tuple",
    fix: "destructure by name instead — `({ a, b }: Deps)`",
  },
  "rest-element": {
    cause:
      "the binding pattern ends in a rest element (`({ a, ...rest }: Deps)`). This one looks like it records its demands and does the opposite: `rest` may be read for any cradle key at all, so the keys the pattern *does* name cannot be trusted as the whole set and all of them are discarded",
    fix: "name every cradle key the body uses and drop the rest element — `({ a, b, c }: Deps)`. If the body genuinely forwards the whole cradle, that unit cannot have its demand set recorded and this package cannot claim complete coverage",
  },
  "nested-binding": {
    cause:
      "the binding pattern destructures through a nested pattern (`({ logger: { log } }: Deps)`), so the name bound is a property of a dependency rather than a cradle key",
    fix: "bind the cradle key itself and reach into it in the body — `({ logger }: Deps)`, then use `logger.log`",
  },
  "computed-property": {
    cause:
      "the binding pattern uses a computed property name (`({ [KEY]: value }: Deps)`), which is not resolvable before the code runs",
    fix: "write the cradle key as a literal — `({ logger }: Deps)` or `({ logger: value }: Deps)`",
  },
  "callable-parameter-type": {
    cause:
      "the first parameter is destructured but its type is a function type, which has no cradle keys to read — the unit most likely takes something other than the cradle first",
    fix: "make the first parameter the deps object — `({ a, b }: Deps)` — and move the callable to a later parameter or into the deps type",
  },
  "unresolvable-signature": {
    cause:
      "TypeScript produced no readable signature for this unit, so its parameters could not be inspected at all",
    fix: "check that the file type-checks and that the export is a plain function, arrow function or class declaration (a re-exported binding or a value produced by a helper cannot be read)",
  },
};

const siteOf = (unit: UnknownDependencyKeysUnit): string =>
  unit.line !== undefined ? `${unit.modulePath}:${unit.line}` : unit.modulePath;

/**
 * The parameter as one line, short enough to sit inside an indented block.
 *
 * A formatted multi-line binding pattern quoted verbatim wraps out of the block and swallows the
 * `why`/`fix` lines under it. The quote exists to let the reader recognise their own code, not to
 * reproduce it — one line does that, and the `path:line` above it goes to the original.
 */
const QUOTE_LIMIT = 100;

const quoteParameter = (parameterText: string): string => {
  const oneLine = parameterText
    .replace(/\s+/g, " ")
    // The trailing comma a formatter left before the closing brace reads as a typo once the
    // newline it belonged to is gone.
    .replace(/,(\s*[}\]])/g, "$1")
    .trim();
  return oneLine.length > QUOTE_LIMIT
    ? `${oneLine.slice(0, QUOTE_LIMIT - 1)}…`
    : oneLine;
};

const formatUnit = (unit: UnknownDependencyKeysUnit): string => {
  const guidance = SHAPE_GUIDANCE[unit.shape];
  const lines = [
    `  - ${siteOf(unit)} ${unit.unitLabel} "${unit.exportName}" [${unit.shape}]`,
  ];
  if (unit.parameterText !== undefined) {
    lines.push(`      written: (${quoteParameter(unit.parameterText)})`);
  }
  lines.push(`      why: ${guidance.cause}.`);
  lines.push(`      fix: ${guidance.fix}.`);
  return lines.join("\n");
};

/**
 * The whole block, headline first. Exported for the tests that pin each shape's wording — the
 * message IS the feature here, so it is asserted directly rather than through console capture.
 */
export const formatUnknownDependencyKeysReport = (
  units: readonly UnknownDependencyKeysUnit[],
): string =>
  [
    `[ioc] ${units.length} accepted unit(s) demand dependencies this generation could not read, so this package's manifest cannot claim "dependencyKeysComplete":`,
    ...units.map(formatUnit),
    `Each of these registers and resolves normally. What they do not do is record WHAT they demand, and three checks are built on that record: lifetime-inversion analysis skips a unit with no recorded demand, a scope-root subtree walk stops at one, and the manifest withholds "dependencyKeysComplete" for the whole package — which downgrades the analysis of every app that composes it, not only this one.`,
    `Set dependencyKeyCoverage: "error" in ioc.config to fail generation on this once the package is clean, or "off" to silence it (the coverage token is withheld either way — the token follows the code, not the setting).`,
  ].join("\n");

/**
 * Reports every accepted unit with an unreadable deps parameter, as a single block.
 *
 * Warns by default; throws when `dependencyKeyCoverage: "error"`; silent under `"off"` and when
 * nothing qualifies. Called from generation right after discovery, so an `"error"` run fails
 * before any artifact is written.
 */
export const reportUnknownDependencyKeys = (
  units: readonly UnknownDependencyKeysUnit[],
  config: IocConfig | undefined,
): void => {
  const level: IocDependencyKeyCoverage =
    config?.dependencyKeyCoverage ?? "warn";
  if (units.length === 0 || level === "off") {
    return;
  }

  const report = formatUnknownDependencyKeysReport(units);
  if (level === "error") {
    throw new Error(report);
  }
  console.warn(report);
};
