import type { Foo } from "./contract.js";

export const buildB = (_deps: Record<string, unknown>): Foo => ({ x: "b" });
