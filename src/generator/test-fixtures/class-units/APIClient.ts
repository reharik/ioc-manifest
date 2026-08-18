import type { ApiClient } from "./contracts.js";

/** Acronym-leading class name; pins the Awilix camelCase policy (`APIClient` → `apiClient`). */
export class APIClient implements ApiClient {
  call(): string {
    return "ok";
  }
}
