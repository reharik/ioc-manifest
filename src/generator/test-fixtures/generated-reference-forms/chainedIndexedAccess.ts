// REJECTED: reading a member out of a cradle entry needs the entry's resolved type.
import type { IocGeneratedCradle } from "./generated/ioc-registry.types.js";

export type Upload = IocGeneratedCradle["storage"]["upload"];
