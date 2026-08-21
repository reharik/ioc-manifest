/** Top level, but NOT exported — so no module specifier can bind this name at an import site. */
type LocalOnlyShape = {
  readonly label: string;
};

export type UnexportedLocalService = {
  run: () => void;
};

type UnexportedLocalDeps = {
  /**
   * Resolves to a top-level named declaration, which the emitter references by name — but the
   * declaring module exports nothing called `LocalOnlyShape`, so the import it emits is TS2305.
   */
  shape: LocalOnlyShape;
};

export const buildUnexportedLocal = (
  _deps: UnexportedLocalDeps,
): UnexportedLocalService => ({ run: () => {} });
