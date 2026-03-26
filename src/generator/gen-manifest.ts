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
  console.error(error);
  process.exit(1);
});
