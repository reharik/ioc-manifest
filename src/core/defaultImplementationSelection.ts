import { contractNameToDefaultRegistrationKey } from "../generator/naming.js";

export type ContractDefaultSelectionRow = {
  readonly implementationName: string;
  readonly registrationKey: string;
  readonly default?: boolean;
};

/**
 * Resolves which implementation backs the contract default slot. Precedence:
 * 1. Exactly one row with `default: true`
 * 2. Exactly one row whose `registrationKey` equals the contract key (camel-cased contract name)
 * 3. Exactly one row total
 * 4. Otherwise throws (ambiguous)
 */
export const selectDefaultImplementationName = (
  contractName: string,
  rows: readonly ContractDefaultSelectionRow[],
): string => {
  if (rows.length === 0) {
    throw new Error(
      `[ioc] Contract ${JSON.stringify(contractName)} has no implementations.`,
    );
  }

  const withDefault = rows.filter((r) => r.default === true);
  if (withDefault.length > 1) {
    const names = withDefault
      .map((r) => r.implementationName)
      .sort((a, b) => a.localeCompare(b))
      .map((n) => JSON.stringify(n))
      .join(", ");
    throw new Error(
      `[ioc] Contract ${JSON.stringify(contractName)} has multiple implementations marked default: true after applying ioc.config overrides: ${names}. Mark exactly one with default: true in source or in registrations[${JSON.stringify(contractName)}][implementationName], or reduce to a single implementation.`,
    );
  }

  if (withDefault.length === 1) {
    return withDefault[0]!.implementationName;
  }

  const contractKey = contractNameToDefaultRegistrationKey(contractName);
  const conventionMatches = rows.filter((r) => r.registrationKey === contractKey);
  if (conventionMatches.length > 1) {
    throw new Error(
      `[ioc] Contract ${JSON.stringify(contractName)} has multiple implementations registered under the contract key ${JSON.stringify(contractKey)}.`,
    );
  }
  if (conventionMatches.length === 1) {
    return conventionMatches[0]!.implementationName;
  }

  if (rows.length === 1) {
    return rows[0]!.implementationName;
  }

  const names = rows
    .map((r) => r.implementationName)
    .sort((a, b) => a.localeCompare(b))
    .map((n) => JSON.stringify(n))
    .join(", ");
  const keys = rows
    .map((r) => `${r.implementationName}→${JSON.stringify(r.registrationKey)}`)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
  throw new Error(
    `[ioc] Contract ${JSON.stringify(contractName)} has ${rows.length} implementations (${names}) but none is selected as the default. Set registrations[${JSON.stringify(contractName)}][implementationName].default: true in ioc.config.ts for exactly one implementation, mark exactly one factory with resolver default: true, register exactly one implementation under the contract key ${JSON.stringify(contractKey)}, or reduce to a single implementation. Registration keys: ${keys}.`,
  );
};
