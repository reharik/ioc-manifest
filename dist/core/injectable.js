const INJECTABLE_MARKER = Symbol.for("ioc-config.injectable.marker");
/**
 * Marks a factory as injectable for discovery.
 *
 * Identity-like by design: it returns the same function reference and preserves
 * the function's type and arity (so runtime bootstrap invocation semantics stay intact).
 */
export const injectable = (factory) => {
    // Type assertion is required to attach a non-user-visible marker symbol.
    // Risk: if the symbol type doesn't match the returned value shape, discovery may miss it.
    const withMarker = factory;
    withMarker[INJECTABLE_MARKER] = true;
    return factory;
};
export const isInjectable = (value) => {
    return typeof value === "function" && INJECTABLE_MARKER in value;
};
//# sourceMappingURL=injectable.js.map