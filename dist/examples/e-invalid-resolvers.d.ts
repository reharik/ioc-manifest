/**
 * Intentionally problematic resolvers for manual inspection of warnings.
 * These are isolated under unique export names; some share a duplicate key on purpose.
 */
export declare const buildDuplicateOne: () => {
    n: number;
};
export declare const buildDuplicateTwo: () => {
    n: number;
};
/** Tagged but empty metadata object — key falls back to export name `buildEmptyMeta`. */
export declare const buildEmptyMeta: () => void;
/** Loosely typed factory — still registers; demonstrates boundary behavior. */
export declare const buildLoose: (deps: unknown) => {
    deps: unknown;
};
//# sourceMappingURL=e-invalid-resolvers.d.ts.map