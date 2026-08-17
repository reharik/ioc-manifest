// REJECTED: `typeof` on a generated binding asks for the module's inferred shape.
import * as Ioc from "./generated/ioc-registry.types.js";

export type GeneratedModule = typeof Ioc;
