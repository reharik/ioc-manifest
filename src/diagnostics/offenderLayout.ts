/**
 * @fileoverview The shape of one offender inside an aggregated generation error.
 *
 * ### Why generation borrows validate's layout
 *
 * `ioc validate` prints an issue as a claim sentence followed by LABELED FIELDS on their own lines
 * — `key:`, `demanded:`, `supplied:`, `Suggested fix:`. Generation's aggregated errors printed the
 * same information as one long paragraph per offender, because a paragraph is what a thrown
 * `Error.message` naturally is. The information was identical; the scanning cost was not. A reader
 * looking for "which key?" in a validate issue finds it at a fixed column on its own line, and in a
 * generation offender had to read a sentence to the end.
 *
 * Both verbs report on the same workspace and increasingly on the same rules, so they should read
 * the same way. This module is that layout, in one place, so the two aggregated generation errors
 * (the demand model and the group-lifetime law) cannot drift apart from each other either.
 *
 * ### The three registers, laid out
 *
 * 1. **The claim** — one sentence on the offender line, next to its bracketed code. What happened.
 * 2. **The mechanism** — labeled fields, values aligned. The key, the contract, the group, the
 *    site as `file:line`. This is the part no documentation page can supply.
 * 3. **The guidance** — one beat per line, in the order a reader acts on them, with the pointer to
 *    the deferred design question (where a rule has one) last, immediately before the docs link.
 *
 * Nothing here colours: this text ends up in `Error.message`, which must stay escape-free. The CLI
 * tints the result at the catch (see `colorizeDiagnostic.ts`), and the landmarks it looks for — a
 * bracketed code at line start, a `file.ts:12`, a quoted key, the `→ docs:` arrow — are exactly the
 * ones this layout puts on their own lines.
 */

/** One labeled field. `label` carries no colon; the renderer adds and aligns it. */
export type OffenderField = {
  readonly label: string;
  readonly value: string;
};

export type Offender = {
  /** The bracketed diagnostic code, without brackets. */
  readonly code: string;
  /** One sentence: what happened. Rendered on the offender line after the code. */
  readonly claim: string;
  /** The mechanism, in fixed-column form. */
  readonly fields: readonly OffenderField[];
  /**
   * Guidance, one rendered line per beat, in the order a reader acts on them.
   *
   * Where a rule points at a deferred design question, that pointer is the LAST beat — it is the
   * one a reader consults after deciding what to do, not before.
   */
  readonly guidance: readonly string[];
  /** Resolved docs URL for this offender's own code, when it points somewhere the preamble does not. */
  readonly docsUrl?: string;
};

/** `  - ` — the offender bullet every aggregated generation error already used. */
const BULLET = "  - ";

/** Continuation indent: under the offender's text, not under its bullet. */
const INDENT = "      ";

/**
 * Renders one offender as its own block of lines.
 *
 * Field values are aligned to the widest label IN THIS OFFENDER rather than across the whole error.
 * Per-offender alignment keeps each block internally scannable without making a short offender pay
 * for a long one's labels, and it means adding a field to one code cannot re-indent every other.
 */
export const formatOffender = (offender: Offender): string => {
  const width = offender.fields.reduce(
    (widest, field) => Math.max(widest, field.label.length + 1),
    0,
  );

  return [
    `${BULLET}[${offender.code}] ${offender.claim}`,
    ...offender.fields.map(
      (field) => `${INDENT}${`${field.label}:`.padEnd(width + 2)}${field.value}`,
    ),
    ...offender.guidance.map((beat) => `${INDENT}${beat}`),
    ...(offender.docsUrl !== undefined
      ? [`${INDENT}→ docs: ${offender.docsUrl}`]
      : []),
  ].join("\n");
};

/**
 * The whole aggregated error: a preamble, the family's docs pointer, then one block per offender.
 *
 * Offenders are separated by a blank line. With one field-per-line inside a block, run-together
 * blocks would read as a single wall; the blank line is what makes "how many offenders are there?"
 * answerable at a glance, which is the first question a reader of an aggregate asks.
 */
export const formatAggregatedOffenders = (
  preamble: string,
  familyDocsLine: string | undefined,
  offenders: readonly Offender[],
): string =>
  [
    preamble,
    ...(familyDocsLine !== undefined ? [familyDocsLine] : []),
    "",
    offenders.map(formatOffender).join("\n\n"),
  ].join("\n");
