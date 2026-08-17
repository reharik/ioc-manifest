// Offending forms: typeof import(…) indexed access and import(…).X into the generated file.
export type CradleViaTypeofImport = typeof import("./generated/ioc-registry.types.js");

export type ChannelsViaImportType =
  import("./generated/ioc-registry.types.js").IocGeneratedCradle["channels"];
