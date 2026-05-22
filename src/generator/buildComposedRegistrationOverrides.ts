import {
  getImplOverrideForImplementation,
  IOC_CONTRACT_CONFIG_KEY,
  isIocImplementationOverride,
  type IocConfig,
} from "../config/iocConfig.js";
import type { ComposedRegistrationOverrides } from "../runtime/composedOverrides.js";

/**
 * Builds the override object emitted into `ioc-composed.ts` from the app's registrations block.
 */
export const buildComposedRegistrationOverridesFromConfig = (
  config: IocConfig,
): ComposedRegistrationOverrides | undefined => {
  const registrations = config.registrations;
  if (registrations === undefined) {
    return undefined;
  }

  const contracts: Record<
    string,
    {
      defaultImplementation?: string;
      sourceOverride?: Record<string, "local" | string>;
    }
  > = {};

  for (const [contractName, perContract] of Object.entries(registrations)) {
    let defaultImplementation: string | undefined;
    const sourceOverride: Record<string, "local" | string> = {};

    for (const [key, raw] of Object.entries(perContract)) {
      if (key === IOC_CONTRACT_CONFIG_KEY) {
        continue;
      }
      if (!isIocImplementationOverride(raw)) {
        continue;
      }
      const implOverride = getImplOverrideForImplementation(
        perContract,
        key,
      );
      if (implOverride?.default === true) {
        defaultImplementation = key;
      }
      if (implOverride?.source !== undefined) {
        sourceOverride[key] = implOverride.source;
      }
    }

    if (
      defaultImplementation !== undefined ||
      Object.keys(sourceOverride).length > 0
    ) {
      contracts[contractName] = {
        ...(defaultImplementation !== undefined
          ? { defaultImplementation }
          : {}),
        ...(Object.keys(sourceOverride).length > 0 ? { sourceOverride } : {}),
      };
    }
  }

  const composedPackageNames = config.composedManifests;
  const hasContracts = Object.keys(contracts).length > 0;
  const hasPackages =
    composedPackageNames !== undefined && composedPackageNames.length > 0;

  if (!hasContracts && !hasPackages) {
    return undefined;
  }

  return {
    ...(hasPackages ? { composedPackageNames } : {}),
    ...(hasContracts ? { contracts } : {}),
  };
};
