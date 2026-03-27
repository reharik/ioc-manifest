export * from "./core/index.js";
export { defineIocConfig, type IocConfig, type IocLifetime, type IocOverride, } from "./config/iocConfig.js";
export { type IocBundleLeaf, type IocBundleNode, type IocBundleReference, type IocBundlesConfig, } from "./bundles/index.js";
export { loadIocConfig, resolveIocConfigPath, tryLoadIocConfig, } from "./config/loadIocConfig.js";
export * from "./runtime/index.js";
/** Manifest generation (call from your app or a build script). */
export { generateManifest } from "./generator/generateManifest.js";
export type { ManifestOptions } from "./generator/manifestOptions.js";
export { DEFAULT_MANIFEST_OPTIONS, mergeManifestOptionsWithIocConfig, resolveManifestOptions, } from "./generator/manifestOptions.js";
export type { ManifestRuntimePaths } from "./generator/manifestPaths.js";
//# sourceMappingURL=index.d.ts.map