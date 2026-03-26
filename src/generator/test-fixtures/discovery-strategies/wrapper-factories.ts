import { injectable } from "../../../core/injectable.js";
import type { Foo } from "./contract.js";

export const makeWrapped = injectable((): Foo => ({ x: "wrapped" }));

export const makeWrappedZero = injectable((): Foo => ({ x: "zero" }));

export type Deps = {
  dep: string;
};

export const makeWrappedWithDeps = injectable(
  ({ dep }: Deps): Foo => ({ x: dep }),
);

