/** Low-level: only config + logger from the wide cradle — must not pull GraphQLServer, KoaServer, etc. */
export const buildKnexConfig = ({ config, logger, }) => {
    logger.log(config.env);
    return { client: "pg" };
};
/** High-level service: only logger — must not infer GraphQLServer as a dependency. */
export const buildGraphQLServer = ({ logger }) => {
    return { listen: () => logger.log("ok") };
};
/** Single identifier parameter typed as full cradle — omit dependency list. */
export const buildWithFullCradleParam = (deps) => {
    deps.logger.log("x");
    return { client: "pg" };
};
/** Rest element in binding — omit (would require whole-object semantics). */
export const buildWithRest = ({ logger, ...rest }) => {
    void rest;
    logger.log("x");
    return { client: "pg" };
};
/** Explicitly destructures own contract slot — allowed to include GraphQLServer. */
export const buildGraphQLServerWithExplicitSelf = ({ graphqlServer, logger, }) => {
    logger.log("x");
    return graphqlServer;
};
/** Narrow deps type (only selected keys in the type) — still binding-pattern based. */
export const buildFromNarrowDeps = ({ logger, }) => {
    logger.log("x");
    return { client: "pg" };
};
/** Renamed binding: property key on cradle is still `logger`. */
export const buildRenamedBinding = ({ logger: logSvc, }) => {
    logSvc.log("x");
    return { client: "pg" };
};
//# sourceMappingURL=factories.js.map