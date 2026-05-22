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
  IocGroupKind,
  IocGroupNodeManifest,
  IocGroupObjectManifest,
  IocGroupRootManifest,
  IocGroupsManifest,
  IocImplementationLifetime,
  IocModuleNamespace,
  IocRegisterableManifest,
  ModuleFactoryManifestMetadata,
} from "./manifest.js";

export { IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS } from "./manifest.js";

export {
  MANIFEST_SCHEMA_VERSION,
  type ManifestSchemaVersion,
} from "../schemaVersion.js";
