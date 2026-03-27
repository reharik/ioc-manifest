import type { IocConfig } from "./iocConfig.js";
export declare const loadIocConfig: (absoluteConfigPath: string) => Promise<IocConfig>;
export declare const resolveIocConfigPath: (projectRoot: string, explicitPath?: string) => string;
export declare const tryLoadIocConfig: (absoluteConfigPath: string) => Promise<IocConfig | undefined>;
//# sourceMappingURL=loadIocConfig.d.ts.map