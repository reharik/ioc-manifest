/** Full app config; satisfies lib-services {@link AppConfigSlice} external demand. */
export type AppConfig = {
  logLevel: "debug" | "info" | "warn" | "error";
  logJsonFilePath?: string;
  nodeEnv: string;
  port: number;
};
