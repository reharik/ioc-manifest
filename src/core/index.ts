export {
  keyFromExportName,
  resolveRegistrationKeyForFactory,
  type RegistrationKeyResolutionContext,
} from "./resolver.js";

export type {
  IocConfigOverrideField,
  IocContractManifest,
  IocGeneratedContainerManifest,
  IocGeneratedContainerManifestCore,
  IocGroupCollectionManifest,
  IocGroupLeafManifest,
  IocGroupNodeManifest,
  IocGroupObjectManifest,
  IocGroupsManifest,
  IocImplementationLifetime,
  IocModuleNamespace,
  ModuleFactoryManifestMetadata,
} from "./manifest.js";

export {
  extractGroupRootsFromContainerManifest,
  IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS,
} from "./manifest.js";
