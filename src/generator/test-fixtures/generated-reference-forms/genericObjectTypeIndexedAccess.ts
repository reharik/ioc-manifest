// REJECTED: indexing through a type-argument-bearing reference instantiates it first.
//
// Spelled directly on the imported binding, this is caught here, at the file level. Spelled through
// a local generic alias (`type Wrapped<T> = IocGeneratedCradle; Wrapped<string>["storage"]`) the
// binding is out of the classifier's sight, and the deps-position backstop rejects it instead —
// see `unclaimedReferenceInDepsPosition`.
import type { IocGeneratedCradle as Cradle } from "./generated/ioc-registry.types.js";

export type Storage = Cradle<string>["storage"];
