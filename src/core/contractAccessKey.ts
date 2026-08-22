/**
 * @fileoverview The one derivation of a contract's ACCESS KEY — the cradle property its elected
 * default implementation is reachable under.
 *
 * The key existed in three hand-rolled copies before this module: generation read it off
 * `ioc.config` while planning, runtime read it off the manifest while registering the default-slot
 * alias, and the composed-manifest loader read it off a parsed manifest while reconstructing the
 * container the walk measures against. Three copies of one rule is three chances for the layers to
 * disagree about which name a contract answers to — and the whole point of the contract-slot key is
 * that every layer names the SAME property.
 *
 * The rule itself is one line: an explicit `accessKey` when one was configured, otherwise the
 * camel-cased contract name. Both entry points below are that line, differing only in where the
 * explicit value is read from.
 */
import { contractNameToDefaultRegistrationKey } from "../generator/naming.js";

/**
 * The access key of a contract, given whatever explicit `accessKey` was configured for it.
 *
 * The generation-side entry point: `ioc.config`'s `registrations[Contract].$contract.accessKey` is
 * already in hand when a registration plan is built, so there is nothing to search.
 */
export const resolveContractAccessKey = (
  contractName: string,
  explicitAccessKey: string | undefined,
): string =>
  explicitAccessKey ?? contractNameToDefaultRegistrationKey(contractName);

/** The shape both manifest metadata and parsed-manifest rows satisfy for access-key purposes. */
export type ContractAccessKeyCarrier = {
  readonly accessKey?: string | undefined;
};

/**
 * The access key of a contract, read off its implementation rows in a generated manifest.
 *
 * The manifest-side entry point, used by runtime registration, the resolution-error key index, and
 * the composed-manifest supply loader. `accessKey` is emitted onto whichever implementation carried
 * it, so the first row that has one wins — a contract cannot have two.
 */
export const resolveManifestAccessKey = (
  contractName: string,
  implementations: readonly ContractAccessKeyCarrier[],
): string =>
  resolveContractAccessKey(
    contractName,
    implementations.find((impl) => impl.accessKey !== undefined)?.accessKey,
  );
