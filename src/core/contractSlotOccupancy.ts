/**
 * @fileoverview A registration occupying its contract's SLOT KEY must be the electee.
 *
 * ### The rule
 *
 * A contract with an elected default answers to a slot key — the camel-cased contract name, or a
 * configured `$contract.accessKey`. The slot key means "the elected implementation", and that is
 * the whole reason it exists: a consumer writes it and keeps writing it when the election moves.
 *
 * A factory named after the contract registers under that same name (`buildMediaStorage` → key
 * `mediaStorage`, for contract `MediaStorage`). Awilix cannot hold two registrations under one
 * name, so that registration OWNS the key and no alias is written. When that implementation is
 * also the electee, nothing is wrong — the slot and the key coincide by agreement, and that is the
 * sanctioned single-name case.
 *
 * When it is NOT the electee, the key hands out the occupant while the election names someone
 * else. Both statements were true at once and they contradict each other: the first row of the
 * demand model's table — "a contract key resolves the contract's elected default" — was simply
 * false in that corner. It is now a hard error, at generation and in `ioc validate` alike.
 *
 * ### What this does not cover
 *
 * - **Grouped contracts.** Grouped ⇒ group-only: no slot, so nothing to occupy.
 * - **Scope-rooted contracts.** Opener-only; they claim no registration key and reach no plan.
 * - **An explicitly configured `$contract.accessKey` occupied by an implementation.** Caught
 *   earlier and more specifically while the registration plan is built, with a message about the
 *   config that caused it. This module still states the rule for that shape rather than carving it
 *   out, so the invariant holds even if that earlier guard ever moves.
 */

/** One contract's occupancy facts, in the terms both verbs can supply. */
export type ContractSlotOccupancyRow = {
  readonly contractName: string;
  /** The cradle property the elected default answers to. */
  readonly slotKey: string;
  /** Implementation name of the electee. */
  readonly electedImplementationName: string;
  /** Registration key of the electee. */
  readonly electedRegistrationKey: string;
  /** Every implementation of this contract, merged across the composed set where that applies. */
  readonly implementations: readonly {
    readonly implementationName: string;
    readonly registrationKey: string;
    /** Export identifier, when the caller has one. Used only to make the remedy concrete. */
    readonly exportName?: string;
    /** Source location, when the caller has one. */
    readonly modulePath?: string;
    /** Where this implementation came from, for a composed report. */
    readonly packageLabel?: string;
  }[];
};

export type ContractSlotOccupancyViolation = {
  readonly contractName: string;
  readonly slotKey: string;
  readonly occupantImplementationName: string;
  readonly occupantExportName?: string;
  readonly occupantModulePath?: string;
  readonly occupantPackageLabel?: string;
  readonly electedImplementationName: string;
  /** An export in this contract that already carries a qualifier, when one exists. */
  readonly styleExemplarExportName?: string;
};

/**
 * Every implementation that owns its contract's slot key without being the electee.
 *
 * Pure and shared: `ioc generate` throws one aggregated error built from this, and the composition
 * suite turns the same rows into `ValidationIssue`s carrying the same sentences, so the two verbs
 * cannot describe the same offender differently.
 */
export const findContractSlotOccupancyViolations = (
  rows: readonly ContractSlotOccupancyRow[],
): ContractSlotOccupancyViolation[] => {
  const violations: ContractSlotOccupancyViolation[] = [];

  for (const row of rows) {
    const occupant = row.implementations.find(
      (impl) => impl.registrationKey === row.slotKey,
    );
    if (
      occupant === undefined ||
      occupant.implementationName === row.electedImplementationName
    ) {
      continue;
    }

    // A sibling whose key is NOT the slot key: proof, in this contract's own set, of what a
    // qualified export name looks like. The ELECTEE first — it is by definition not shadowing, and
    // it is the implementation the developer already reached for.
    const nonShadowing = row.implementations.filter(
      (impl) =>
        impl.registrationKey !== row.slotKey &&
        impl.exportName !== undefined &&
        impl.exportName.length > 0,
    );
    const exemplar =
      nonShadowing.find(
        (impl) => impl.implementationName === row.electedImplementationName,
      ) ?? nonShadowing[0];

    violations.push({
      contractName: row.contractName,
      slotKey: row.slotKey,
      occupantImplementationName: occupant.implementationName,
      ...(occupant.exportName !== undefined
        ? { occupantExportName: occupant.exportName }
        : {}),
      ...(occupant.modulePath !== undefined
        ? { occupantModulePath: occupant.modulePath }
        : {}),
      ...(occupant.packageLabel !== undefined
        ? { occupantPackageLabel: occupant.packageLabel }
        : {}),
      electedImplementationName: row.electedImplementationName,
      ...(exemplar?.exportName !== undefined
        ? { styleExemplarExportName: exemplar.exportName }
        : {}),
    });
  }

  return violations;
};

/** The claim, in one sentence. Identical in both verbs. */
export const formatSlotOccupancyClaim = (
  violation: ContractSlotOccupancyViolation,
): string =>
  `Implementation ${JSON.stringify(violation.occupantImplementationName)} occupies contract ` +
  `${JSON.stringify(violation.contractName)}'s slot key ${JSON.stringify(violation.slotKey)} but is not ` +
  `the elected default (${JSON.stringify(violation.electedImplementationName)} is)`;

/**
 * Both exits, named. Identical in both verbs.
 *
 * Two ways out and no third: stop shadowing the slot, or make the occupant the electee. Which one
 * is right depends on what was meant, so the tool refuses to pick.
 */
export const formatSlotOccupancyRemedy = (
  violation: ContractSlotOccupancyViolation,
): string => {
  const exemplar =
    violation.styleExemplarExportName !== undefined
      ? ` (qualify the export, ${JSON.stringify(violation.styleExemplarExportName)}-style, so it registers under a key of its own)`
      : " (qualify the export so it registers under a key of its own)";
  return (
    `Rename the factory so the key stops shadowing the slot${exemplar}, or elect ` +
    `${JSON.stringify(violation.occupantImplementationName)} as the default for ` +
    `${JSON.stringify(violation.contractName)}.`
  );
};

/** Where the offender is, when the caller knew. */
export const formatSlotOccupancyLocation = (
  violation: ContractSlotOccupancyViolation,
): string | undefined => {
  const parts = [
    violation.occupantPackageLabel,
    violation.occupantExportName !== undefined
      ? `export ${JSON.stringify(violation.occupantExportName)}`
      : undefined,
    violation.occupantModulePath,
  ].filter((part): part is string => part !== undefined && part.length > 0);
  return parts.length > 0 ? parts.join(" — ") : undefined;
};
