/**
 * Contracts for the dependency-key COVERAGE fixture.
 *
 * Nothing here is about scope roots or grouping: the fixture exists to put two factories side by
 * side that differ in exactly one way — whether their deps parameter is destructured — and to see
 * what the manifest then claims about itself.
 */
export interface MediaStorage {
  put: (blob: string) => void;
}

export interface MediaServeController {
  serve: (id: string) => string;
}
