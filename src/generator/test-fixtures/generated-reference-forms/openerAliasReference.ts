// RESOLVED: an emitted scope-root opener alias in a deps position. The opener is the sanctioned
// scope-resolver handle, injectable like any other registration, so its alias is an enumerated
// generated-reference form here — recognized by NAME against the openers this generation emits,
// the same mechanism `groupAliasReference` uses for group aliases.
import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type { MediaStorage, ScopedStorage, UploadService } from "./contracts.js";
import type { OpenScopedStorageScope } from "./generated/ioc-registry.types.js";

type Deps = { openScopedStorageScope: OpenScopedStorageScope };

export const buildStorage = (): MediaStorage => ({
  upload: (name) => name,
});

/** The variant behind `OpenScopedStorageScope`: `scopedStorage` → `openScopedStorageScope` → `OpenScopedStorageScope`. */
export const buildScopedStorage = (): ScopeRoot<
  ScopedStorage,
  Record<string, never>
> => ({
  upload: (name) => name,
});

export const buildUploadService = ({
  openScopedStorageScope,
}: Deps): UploadService => ({
  upload: (name) => {
    void openScopedStorageScope;
    return name;
  },
});
