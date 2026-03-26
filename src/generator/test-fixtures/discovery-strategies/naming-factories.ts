import type { Foo } from "./contract.js";

export const buildFoo = (): Foo => ({ x: "build" });

export const notDiscoveredByNaming = (): Foo => ({ x: "nope" });

