// The intermediate module: the factory file below has no generated import of its own, and this
// one cannot resolve either.
import type { Channels, IocGeneratedCradle } from "./generated/ioc-registry.types.js";

export type SharedChannels = Channels;
export type SharedStorage = IocGeneratedCradle["storage"];
