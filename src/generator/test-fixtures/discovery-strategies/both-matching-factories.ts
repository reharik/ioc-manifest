import { injectable } from "../../../core/injectable.js";
import type { Foo } from "./contract.js";

export const createBoth = injectable((): Foo => ({ x: "both" }));

