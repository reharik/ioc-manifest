/**
 * @fileoverview Fast lookups from Awilix keys back to manifest metadata and contract default slots.
 * Built once per `registerIocFromManifest` call to enrich resolution errors.
 */
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
  /** Contract name for each cradle default-slot key (convention or `$contract.accessKey`). */
  readonly contractByAccessKey: ReadonlyMap<string, string>;
};

export const buildRegistrationKeyIndex = (
  manifestByContract: IocContractManifest,
): RegistrationKeyIndex => {
  const metaByRegistrationKey = new Map<string, ModuleFactoryManifestMetadata>();
  const contractByAccessKey = new Map<string, string>();

  for (const contractName of Object.keys(manifestByContract)) {
    const impls = manifestByContract[contractName]!;
    const list = Object.values(impls);
    const explicit = list.find((m) => m.accessKey !== undefined)?.accessKey;
    const slotKey =
      explicit ?? contractNameToDefaultRegistrationKey(contractName);
    contractByAccessKey.set(slotKey, contractName);
  }

  for (const impls of Object.values(manifestByContract)) {
    for (const meta of Object.values(impls)) {
      metaByRegistrationKey.set(meta.registrationKey, meta);
    }
  }

  return { metaByRegistrationKey, contractByAccessKey };
};
