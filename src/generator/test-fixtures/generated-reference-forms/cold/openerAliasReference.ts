// COLD START: the generated file this refers to does NOT exist on disk. The opener alias is
// recognized off the import specifier and the variant declared below — never by resolving the alias
// — so the claim holds on the very first run, before any opener has been written anywhere.
import type { ScopeRoot } from "../../../../scopeRoots/scopeRoot.js";
import type {
  MediaStorage,
  ScopedStorage,
  UploadService,
} from "../contracts.js";
import type { OpenScopedStorageScope } from "./generated/ioc-registry.types.js";

type Deps = { openScopedStorageScope: OpenScopedStorageScope };

export const buildStorage = (): MediaStorage => ({
  upload: (name) => name,
});

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
