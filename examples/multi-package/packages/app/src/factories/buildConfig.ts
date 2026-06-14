import type { AppConfig } from "../types/AppConfig.js";

export const buildConfig = (): AppConfig => ({
  logLevel: "info",
  logJsonFilePath: "/var/log/app.json",
  nodeEnv: "development",
  port: 3000,
});
