import type { AppContext, Hook } from "./hooks.js";

export type UnimportedNameService = {
  run: () => void;
};

type UnimportedNameDeps = {
  /**
   * An anonymous type literal: nothing names it, so its shape is printed rather than referenced.
   *
   * The printed shape spells the field out as `Hook<AppContext>`, while the import walk visits the
   * FIELD TYPE and resolves only `Hook` — `Hook<AppContext>` is a function type, not a
   * `ts.TypeReference`, so the type-argument pass declines and `AppContext` is never collected.
   * Printed text and collected imports are two different traversals, and here they disagree.
   */
  handlers: { onEvent?: Hook<AppContext> };
};

export const buildUnimportedName = (
  _deps: UnimportedNameDeps,
): UnimportedNameService => ({ run: () => {} });
