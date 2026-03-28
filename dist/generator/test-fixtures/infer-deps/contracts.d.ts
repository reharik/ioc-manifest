export interface Config {
    env: string;
}
export interface Logger {
    log: (m: string) => void;
}
export interface KnexConfig {
    client: string;
}
export interface GraphQLServer {
    listen: () => void;
}
export interface KoaServer {
    use: () => void;
}
export interface YogaApp {
    run: () => void;
}
export interface MediaController {
    get: () => void;
}
//# sourceMappingURL=contracts.d.ts.map