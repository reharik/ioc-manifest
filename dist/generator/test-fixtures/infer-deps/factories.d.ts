import type { GraphQLServer, KnexConfig } from "./contracts.js";
import type { MockIocCradle } from "./mock-cradle.js";
/** Low-level: only config + logger from the wide cradle — must not pull GraphQLServer, KoaServer, etc. */
export declare const buildKnexConfig: ({ config, logger, }: MockIocCradle) => KnexConfig;
/** High-level service: only logger — must not infer GraphQLServer as a dependency. */
export declare const buildGraphQLServer: ({ logger }: MockIocCradle) => GraphQLServer;
/** Single identifier parameter typed as full cradle — omit dependency list. */
export declare const buildWithFullCradleParam: (deps: MockIocCradle) => KnexConfig;
/** Rest element in binding — omit (would require whole-object semantics). */
export declare const buildWithRest: ({ logger, ...rest }: MockIocCradle) => KnexConfig;
/** Explicitly destructures own contract slot — allowed to include GraphQLServer. */
export declare const buildGraphQLServerWithExplicitSelf: ({ graphqlServer, logger, }: MockIocCradle) => GraphQLServer;
/** Narrow deps type (only selected keys in the type) — still binding-pattern based. */
export declare const buildFromNarrowDeps: ({ logger, }: {
    logger: import("./contracts.js").Logger;
}) => KnexConfig;
/** Renamed binding: property key on cradle is still `logger`. */
export declare const buildRenamedBinding: ({ logger: logSvc, }: MockIocCradle) => KnexConfig;
//# sourceMappingURL=factories.d.ts.map