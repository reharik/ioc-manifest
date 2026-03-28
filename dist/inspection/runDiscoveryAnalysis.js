import { discoverFactories } from "../generator/discoverFactories/discoverFactories.js";
import { createIocProgramForDiscovery, getDiscoveryTargetFiles, reportDiscoveryProgramDiagnostics, } from "../generator/iocProgramContext.js";
import { mergeManifestOptionsWithIocConfig, resolveManifestOptions, } from "../generator/manifestOptions.js";
import { resolveIocConfigPath, tryLoadIocConfig, } from "../config/loadIocConfig.js";
/**
 * Re-runs factory discovery from source (and TypeScript) for inspection / CLI.
 * Does not read or write the generated manifest.
 */
export const runDiscoveryAnalysis = async (opts) => {
    const base = resolveManifestOptions(opts?.paths !== undefined ? { paths: opts.paths } : undefined);
    const cfgPath = resolveIocConfigPath(base.paths.projectRoot, opts?.iocConfigPath);
    const config = await tryLoadIocConfig(cfgPath);
    const options = config
        ? mergeManifestOptionsWithIocConfig(base, config)
        : base;
    const { paths: { projectRoot, srcDir, generatedDir }, includePatterns, excludePatterns, factoryExportPrefix, } = options;
    const files = await getDiscoveryTargetFiles(srcDir, includePatterns, excludePatterns);
    const program = createIocProgramForDiscovery(projectRoot, files);
    reportDiscoveryProgramDiagnostics(program, projectRoot, files);
    const { contractMap, acceptedFactories, discoveryFiles } = discoverFactories(files, program, projectRoot, factoryExportPrefix, { srcDir, generatedDir }, config ?? undefined, { collectFileRecords: true });
    return {
        discoveryFiles,
        contractMap,
        acceptedFactories,
    };
};
//# sourceMappingURL=runDiscoveryAnalysis.js.map