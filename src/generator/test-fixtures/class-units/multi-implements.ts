import type { Auditor, MediaStorage } from "./contracts.js";

/** Two `implements` entries: ambiguous contract until `classes[Class].contract` picks one. */
export class DualUnit implements MediaStorage, Auditor {
  label = "dual";

  put(): void {
    /* noop */
  }

  audit(): string {
    return "dual";
  }
}
