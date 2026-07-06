import type { NotificationService } from "./contracts.js";

// A locally-declared type that shares the object-group alias name (`Channels`) but is NOT imported
// from the generated registry file. The import-specifier / basename gate must leave it alone so a
// same-named local type is never mistaken for a group-alias consumption.
interface Channels {
  readonly local: true;
}

type ShadowDeps = { chans: Channels };
export const buildShadow = ({ chans }: ShadowDeps): NotificationService => ({
  notifyAll: () => {
    void chans.local;
  },
});
