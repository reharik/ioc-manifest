import type { IocConfig } from "./iocConfig.js";

export const DEFAULT_MANIFEST_EXPORT_PATH = "./generated/ioc-manifest";

/**
 * App mode: non-empty `composedManifests`. Library mode: omitted or empty (empty emits a warning).
 */
export const isAppMode = (config: IocConfig): boolean =>
  config.composedManifests !== undefined && config.composedManifests.length > 0;

export const isLibraryMode = (config: IocConfig): boolean => !isAppMode(config);

export const resolveManifestExportPath = (config: IocConfig): string =>
  config.manifestExportPath ?? DEFAULT_MANIFEST_EXPORT_PATH;
