export {
  keyFromExportName,
  resolveRegistrationKeyForFactory,
  type RegistrationKeyResolutionContext,
} from "./resolver.js";

export { injectable } from "./injectable.js";
export type {
  IocConfigOverrideField,
  IocContainerContractsView,
  IocContainerImplementationView,
  IocContractManifest,
  IocGeneratedContainerManifest,
  IocGeneratedContainerManifestCore,
  IocGroupCollectionManifest,
  IocGroupLeafManifest,
  IocGroupNodeManifest,
  IocGroupObjectManifest,
  IocGroupsManifest,
  IocImplementationLifetime,
  IocManifest,
  IocManifestEntry,
  IocModuleNamespace,
  ModuleFactoryManifestMetadata,
} from "./manifest.js";
export {
  extractGroupRootsFromContainerManifest,
  IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS,
} from "./manifest.js";
