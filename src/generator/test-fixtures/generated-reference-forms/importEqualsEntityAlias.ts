// REJECTED: an import-equals alias renaming a generated name outside the import clause.
import type * as Ioc from "./generated/ioc-registry.types.js";
import Cradle = Ioc.IocGeneratedCradle;

export type Storage = Cradle["storage"];
