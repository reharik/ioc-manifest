import { injectable } from "../../../core/injectable.js";
import type { Foo } from "./contract.js";

// Invalid because the return type is a union, which should fail contract type resolution.
export const makeInvalidWrapped = injectable(
  (): Foo | string => ({ x: "bad" }),
);

