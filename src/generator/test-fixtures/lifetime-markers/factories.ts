import type {
  AsyncScopedService,
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

/**
 * Async factory carrying a marker. The marker walk enters at the written contract site with
 * `Promise<>` unwrapped syntactically — entering at the checker-inferred return type instead would
 * find `Promise<AsyncScopedService>`, which has no heritage to `IScoped`, and the factory would
 * silently fall back to the default lifetime.
 */
export const buildAsyncScopedService = async (): Promise<AsyncScopedService> => ({
  __brand: "IScoped",
  ready: true,
});
