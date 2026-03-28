import type { Config, GraphQLServer, KnexConfig, KoaServer, Logger, MediaController, YogaApp } from "./contracts.js";
/** Wide cradle type (simulates generated IocGeneratedCradle with many registrations). */
export interface MockIocCradle {
    config: Config;
    logger: Logger;
    knexConfig: KnexConfig;
    graphqlServer: GraphQLServer;
    koaServer: KoaServer;
    yogaApp: YogaApp;
    mediaController: MediaController;
}
//# sourceMappingURL=mock-cradle.d.ts.map