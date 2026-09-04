export {
  awilixCamelCase,
  keyFromClassName,
  keyFromExportName,
  resolveRegistrationKeyForClass,
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
  IocManifestFeature,
  IocManifestFeatureCoverage,
  IocModuleNamespace,
  IocRegisterableManifest,
  IocUnitKind,
  ModuleFactoryManifestMetadata,
} from "./manifest.js";

export {
  IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS,
  IOC_MANIFEST_FEATURES,
  IOC_MANIFEST_FEATURES_EXPORT_NAME,
  iocManifestFeaturesFor,
  iocUnitKindOf,
} from "./manifest.js";

export {
  MANIFEST_SCHEMA_VERSION,
  type ManifestSchemaVersion,
} from "../schemaVersion.js";
