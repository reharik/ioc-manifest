/**
 * @fileoverview Generation-time warning for single-implementation contracts whose implementation
 * registration key diverges from the contract access key. Such a contract exposes two cradle names
 * for one thing — the implementation key (from the factory export name) and the default-slot alias
 * (camel-cased contract name) — with all injection sites using the alias, which makes usage of the
 * factory hard to trace by its own name. Multi-implementation contracts need distinct names and are
 * never flagged.
 */
import {
  getContractLevelConfig,
  type IocConfig,
} from "../config/iocConfig.js";
import type { ResolvedContractRegistration } from "./resolveRegistrationPlan.js";

const formatDivergentNameWarning = (
  plan: ResolvedContractRegistration,
  factoryPrefix: string,
): string => {
  const impl = plan.implementations[0]!;
  return (
    `[ioc] Contract ${JSON.stringify(plan.contractName)} has a single implementation ` +
    `${JSON.stringify(impl.implementationName)} registered as ${JSON.stringify(impl.registrationKey)}, ` +
    `but injection sites resolve it through the contract key ${JSON.stringify(plan.accessKey)} — ` +
    `two cradle names for one thing. Rename the factory to ${JSON.stringify(`${factoryPrefix}${plan.contractName}`)} ` +
    `(or rename the contract) so the keys match, or declare the divergence intentional with ` +
    `registrations[${JSON.stringify(plan.contractName)}].$contract.allowDivergentName: true in ioc.config.`
  );
};

/**
 * Warns (never throws) for each contract where:
 * - exactly one implementation exists, and
 * - its `registrationKey` differs from the contract's `accessKey`.
 *
 * Skipped when the divergence is already an explicit choice:
 * - `$contract.allowDivergentName: true` (the dedicated suppression), or
 * - `$contract.accessKey` is configured (the second name was requested by hand), or
 * - the contract is a group base with no elected default (`contractDefaultElected === false`) —
 *   no singular default-slot key is emitted, so there is no second name.
 */
export const validateDivergentNamesAtCodegen = (
  plans: readonly ResolvedContractRegistration[],
  config: IocConfig | undefined,
  factoryPrefix: string,
): void => {
  for (const plan of plans) {
    if (plan.implementations.length !== 1) {
      continue;
    }
    if (plan.contractDefaultElected === false) {
      continue;
    }
    if (plan.implementations[0]!.registrationKey === plan.accessKey) {
      continue;
    }

    const contractConfig = getContractLevelConfig(
      config?.registrations?.[plan.contractName],
      plan.contractName,
    );
    if (
      contractConfig.allowDivergentName === true ||
      contractConfig.accessKey !== undefined
    ) {
      continue;
    }

    console.warn(formatDivergentNameWarning(plan, factoryPrefix));
  }
};
