import type { Database } from "./contracts.js";

type CompoundDeps = {
  maybeId: string | undefined;
  createdAt: Date;
  pending: Promise<string>;
  tags: string[];
  pair: [string, number];
  primitiveObject: object;
  boxedObject: Object;
  branded: string & { readonly __brand: unique symbol };
  mixed: string | Database;
};

export const buildCompound = (_deps: CompoundDeps): void => {};
