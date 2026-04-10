/** Contract type living under a workspace-style scan root (importPrefix + subpath). */
export interface PackageOwnedReadContract {
  readonly kind: "packageRead";
}
