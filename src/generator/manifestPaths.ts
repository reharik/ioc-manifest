/** Resolved filesystem layout for manifest generation and factory discovery. */
export type ManifestRuntimePaths = {
  projectRoot: string;
  /** Source tree root: glob `cwd` and base for `modulePath` segments. */
  srcDir: string;
  generatedDir: string;
  /** Primary generated manifest output file. */
  manifestOutPath: string;
};

/** Subset passed into per-file factory discovery (import path + module path math). */
export type FactoryDiscoveryPaths = Pick<
  ManifestRuntimePaths,
  "srcDir" | "generatedDir"
>;
