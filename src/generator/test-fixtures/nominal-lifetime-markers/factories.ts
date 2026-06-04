import type { PlainService, ScopedService } from "./contracts.js";

export const buildScopedService = (): ScopedService => ({
  label: "scoped",
});

export const buildPlainService = (): PlainService => ({
  id: "plain",
});
