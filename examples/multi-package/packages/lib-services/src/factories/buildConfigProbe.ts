import type { AppConfigSlice } from "../types/AppConfigSlice.js";
import type { ConfigProbe } from "../types/ConfigProbe.js";

type ConfigProbeDeps = {
  config: AppConfigSlice;
};

/** Reads a subset of app config supplied by the composing app (externals slice case). */
export const buildConfigProbe = ({ config }: ConfigProbeDeps): ConfigProbe => ({
  label: `${config.logLevel}:${config.logJsonFilePath ?? "none"}`,
});
