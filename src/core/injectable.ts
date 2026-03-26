const INJECTABLE_MARKER: unique symbol = Symbol.for(
  "ioc-config.injectable.marker",
);

type InjectableMarker = {
  /**
   * Marker used by discovery at build-time.
   * @internal
   */
  [INJECTABLE_MARKER]: true;
};

/**
 * Marks a factory as injectable for discovery.
 *
 * Identity-like by design: it returns the same function reference and preserves
 * the function's type and arity (so runtime bootstrap invocation semantics stay intact).
 */
export const injectable = <
  TFactory extends (...args: never[]) => unknown,
>(
  factory: TFactory,
): TFactory => {
  // Type assertion is required to attach a non-user-visible marker symbol.
  // Risk: if the symbol type doesn't match the returned value shape, discovery may miss it.
  const withMarker = factory as TFactory & InjectableMarker;
  withMarker[INJECTABLE_MARKER] = true;
  return factory;
};

export const isInjectable = (value: unknown): boolean => {
  return typeof value === "function" && INJECTABLE_MARKER in value;
};

