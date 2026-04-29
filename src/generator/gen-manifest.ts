/**
 * Thin CLI wrapper for `npm run gen:manifest` — forwards optional `--config` / `-c` to
 * {@link generateManifest}.
 */
import { generateManifest } from "./generateManifest.js";

type CliArgs = {
  iocConfigPath?: string;
};

const parseCliArgs = (argv: string[]): CliArgs => {
  // argv: ["node", "<script>", ...args]
  const args = argv.slice(2);

  const configFlagIndex = args.findIndex((x) => x === "--config" || x === "-c");
  if (configFlagIndex !== -1) {
    const value = args[configFlagIndex + 1];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("[gen-manifest] --config requires a non-empty path");
    }
    return { iocConfigPath: value };
  }

  return {};
};

const cliArgs = parseCliArgs(process.argv);

generateManifest({ iocConfigPath: cliArgs.iocConfigPath }).catch((error: unknown) => {
  if (process.env.IOC_DEBUG === "1") {
    console.error(error);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
});
