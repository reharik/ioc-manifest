import type {
  DualMarked,
  PlainService,
  ScopedService,
} from "./contracts.js";

export const buildScopedService = (): ScopedService => ({
  __brand: "IScoped",
  label: "scoped",
});

export const buildDualMarked = (): DualMarked => ({
  __brand: "IScoped",
  __transientBrand: "ITransient",
  id: "dual",
});

export const buildPlainService = (): PlainService => ({
  id: "plain",
});
