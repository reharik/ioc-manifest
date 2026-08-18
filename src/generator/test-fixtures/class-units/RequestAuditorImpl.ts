import type { MediaStorage, RequestAuditor } from "./contracts.js";

type RequestAuditorImplDeps = {
  s3MediaStorage: MediaStorage;
};

/**
 * Class unit with dependencies (single destructured object constructor parameter) whose contract
 * carries a lifetime marker through its own heritage.
 */
export class RequestAuditorImpl implements RequestAuditor {
  readonly #storage: MediaStorage;

  constructor({ s3MediaStorage }: RequestAuditorImplDeps) {
    this.#storage = s3MediaStorage;
  }

  audit(): string {
    return `audited ${this.#storage.label}`;
  }
}
