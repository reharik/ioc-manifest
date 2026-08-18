import type { MediaStorage } from "./contracts.js";

/** Two constructor parameters: CLASSIC-mode injection, which is not supported. */
export class TwoParamStorage implements MediaStorage {
  label: string;

  constructor(label: string, _suffix: string) {
    this.label = label;
  }

  put(): void {
    /* noop */
  }
}
