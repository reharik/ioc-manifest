// REJECTED: `keyof` bakes the PREVIOUS cradle's key set into the new output.
import type { IocGeneratedCradle } from "./generated/ioc-registry.types.js";

export type CradleKey = keyof IocGeneratedCradle;
