import type { Foo } from "./contract.js";

export const createCustom = (): Foo => ({ x: "create" });

export const notDiscoveredByNaming = (): Foo => ({ x: "nope" });

