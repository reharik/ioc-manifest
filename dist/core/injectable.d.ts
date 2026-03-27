/**
 * Marks a factory as injectable for discovery.
 *
 * Identity-like by design: it returns the same function reference and preserves
 * the function's type and arity (so runtime bootstrap invocation semantics stay intact).
 */
export declare const injectable: <TFactory extends (...args: never[]) => unknown>(factory: TFactory) => TFactory;
export declare const isInjectable: (value: unknown) => boolean;
//# sourceMappingURL=injectable.d.ts.map