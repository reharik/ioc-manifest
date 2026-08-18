import type { HttpsProxy } from "./contracts.js";

/** Longer acronym run than `APIClient`; pins `HTTPSProxy` → `httpsProxy`, not `hTTPSProxy`. */
export class HTTPSProxy implements HttpsProxy {
  forward(): string {
    return "ok";
  }
}
