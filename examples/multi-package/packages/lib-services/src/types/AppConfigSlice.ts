/** Minimal config slice demanded as an external by lib-services factories. */
export type AppConfigSlice = {
  logLevel: "debug" | "info" | "warn" | "error";
  logJsonFilePath?: string;
};
