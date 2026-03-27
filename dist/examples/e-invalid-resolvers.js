/**
 * Intentionally problematic resolvers for manual inspection of warnings.
 * These are isolated under unique export names; some share a duplicate key on purpose.
 */
export const buildDuplicateOne = () => ({ n: 1 });
export const buildDuplicateTwo = () => ({ n: 2 });
/** Tagged but empty metadata object — key falls back to export name `buildEmptyMeta`. */
export const buildEmptyMeta = () => {
    /* intentionally anonymous behavior */
};
/** Loosely typed factory — still registers; demonstrates boundary behavior. */
export const buildLoose = (deps) => ({ deps });
//# sourceMappingURL=e-invalid-resolvers.js.map