/**
 * Derives a registration key from an export name when `key` is omitted (legacy / convenience).
 * `buildAlbumService` → `albumService`
 */
export declare const keyFromExportName: (exportName: string) => string;
export type RegistrationKeyResolutionContext = {
    /** e.g. path relative to project root */
    modulePath: string;
    contractName: string;
    exportName: string;
};
/**
 * Precedence: `ioc.config` `registrations[contract][implementation].name` (passed as `configRegistrationName`)
 * → conventional key from export name.
 * Never returns an empty string; throws with actionable detail if a key cannot be determined.
 */
export declare const resolveRegistrationKeyForFactory: (exportName: string, configRegistrationName: string | undefined, contractName: string, ctx: RegistrationKeyResolutionContext) => string;
//# sourceMappingURL=resolver.d.ts.map