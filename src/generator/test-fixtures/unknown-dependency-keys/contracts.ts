/**
 * Contracts for the unknown-dependency-keys PRODUCING-SIDE fixture.
 *
 * One contract per unreadable parameter shape, so every shape gets its own file, its own module
 * path and its own registration key — which is what lets each test assert that the diagnostic
 * points at the right factory and not merely at some factory.
 */
export interface Logger {
  log: (message: string) => void;
}

export interface NonDestructured {
  run: () => void;
}

export interface Defaulted {
  run: () => void;
}

export interface ArrayBinding {
  run: () => void;
}

export interface RestElement {
  run: () => void;
}

export interface NestedBinding {
  run: () => void;
}

export interface ComputedProperty {
  run: () => void;
}

export interface CallableParameterType {
  run: () => void;
}

export interface Readable {
  run: () => void;
}
