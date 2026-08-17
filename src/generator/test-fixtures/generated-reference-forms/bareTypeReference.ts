// BY-NAME: the documented composition-root pattern. The generated name is only printed back,
// never read into, so it stays legal — this fixture must NOT be rejected.
import type { IocGeneratedCradle } from "./generated/ioc-registry.types.js";

declare function createContainer<T>(): { cradle: T };

export const container = createContainer<IocGeneratedCradle>();
