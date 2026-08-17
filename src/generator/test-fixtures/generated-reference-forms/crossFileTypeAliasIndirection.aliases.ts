// The intermediate module for `crossFileTypeAliasIndirection`: it, not the factory file, holds
// the import of the generated file.
import type { Channels, IocGeneratedCradle } from "./generated/ioc-registry.types.js";

export type SharedChannels = Channels;
export type SharedStorage = IocGeneratedCradle["storage"];
