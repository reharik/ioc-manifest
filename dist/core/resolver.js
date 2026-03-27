/**
 * Derives a registration key from an export name when `key` is omitted (legacy / convenience).
 * `buildAlbumService` → `albumService`
 */
export const keyFromExportName = (exportName) => {
    if (exportName.startsWith("build") && exportName.length > 5) {
        const rest = exportName.slice(5);
        return rest.charAt(0).toLowerCase() + rest.slice(1);
    }
    return exportName.charAt(0).toLowerCase() + exportName.slice(1);
};
/**
 * Precedence: `ioc.config` `registrations[contract][implementation].name` (passed as `configRegistrationName`)
 * → conventional key from export name.
 * Never returns an empty string; throws with actionable detail if a key cannot be determined.
 */
export const resolveRegistrationKeyForFactory = (exportName, configRegistrationName, contractName, ctx) => {
    if (configRegistrationName !== undefined && configRegistrationName.length > 0) {
        return configRegistrationName;
    }
    const derived = keyFromExportName(exportName);
    if (derived.length === 0) {
        throw new Error(`[ioc] Cannot determine Awilix registration key for export ${JSON.stringify(exportName)} (contract ${JSON.stringify(contractName)}) in "${ctx.modulePath}". Set registrations[${JSON.stringify(contractName)}][implementationName].name in ioc.config.ts, or use a factory export name that yields a non-empty key (e.g. buildMyService).`);
    }
    return derived;
};
//# sourceMappingURL=resolver.js.map