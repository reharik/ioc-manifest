import { generateManifest } from "./generateManifest.js";
const parseCliArgs = (argv) => {
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
generateManifest({ iocConfigPath: cliArgs.iocConfigPath }).catch((error) => {
    console.error(error);
    process.exit(1);
});
//# sourceMappingURL=gen-manifest.js.map