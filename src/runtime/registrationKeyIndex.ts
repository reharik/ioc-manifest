import type {
  IocContractManifest,
  ModuleFactoryManifestMetadata,
} from "../core/manifest.js";
import { contractNameToDefaultRegistrationKey } from "../generator/naming.js";

export type RegistrationKeyIndex = {
  readonly metaByRegistrationKey: ReadonlyMap<
    string,
    ModuleFactoryManifestMetadata
  >;
  /** Contract name for each conventional default registration key (camelCase contract). */
  readonly contractByDefaultRegistrationKey: ReadonlyMap<string, string>;
};

export const buildRegistrationKeyIndex = (
  manifestByContract: IocContractManifest,
): RegistrationKeyIndex => {
  const metaByRegistrationKey = new Map<string, ModuleFactoryManifestMetadata>();
  const contractByDefaultRegistrationKey = new Map<string, string>();

  for (const contractName of Object.keys(manifestByContract)) {
    contractByDefaultRegistrationKey.set(
      contractNameToDefaultRegistrationKey(contractName),
      contractName,
    );
  }

  for (const impls of Object.values(manifestByContract)) {
    for (const meta of Object.values(impls)) {
      metaByRegistrationKey.set(meta.registrationKey, meta);
    }
  }

  return { metaByRegistrationKey, contractByDefaultRegistrationKey };
};
