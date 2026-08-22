import type { Logger } from "./Logger.js";

/**
 * This package's own logging contract — the adapted host logger, resolvable as `serviceLogger`.
 *
 * It is a DISTINCT contract from {@link Logger} even though the shape is identical, and that is the
 * point. A contract's camel-cased name is its cradle slot key, so a contract named `Logger` here
 * would claim `logger` — the very key this package demands from the composing app — and
 * `buildServiceLogger` would become its own dependency. Naming the adapted contract for what it is
 * keeps `logger` free to mean "the host's logger", which is what the deps site says.
 *
 * Declared as an interface rather than `type ServiceLogger = Logger` so the emitted cradle names it
 * too: a bare alias of an alias resolves to the target's own name, so the generated property would
 * read `serviceLogger: Logger` while the contract is `ServiceLogger`. Identity would be correct
 * either way — type-level aliases are never followed at a contract site — but the emitted text
 * would be needlessly harder to read.
 */
export interface ServiceLogger extends Logger {}
