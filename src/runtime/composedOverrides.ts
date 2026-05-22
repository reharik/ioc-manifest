/**
 * Internal contract between app-mode codegen (`ioc-composed.ts`) and runtime composition.
 * Users configure overrides via `ioc.config` registrations; do not hand-author this object.
 */
export type ComposedContractOverride = {
  /** Implementation name that wins default selection for this contract (§5.1 rule 1). */
  readonly defaultImplementation?: string;
  /** Implementation name → manifest source for same-key conflicts (§5.2). */
  readonly sourceOverride?: Readonly<Record<string, "local" | string>>;
};

export type ComposedRegistrationOverrides = {
  /**
   * Package names for manifests at indices 1..n (index 0 is always local).
   * Emitted by codegen so runtime can resolve `source` package names to manifest indices.
   */
  readonly composedPackageNames?: readonly string[];
  readonly contracts?: Readonly<Record<string, ComposedContractOverride>>;
};
