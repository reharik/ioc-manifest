import type { IScoped } from "./IScoped.js";

/**
 * Reads per-request viewer state, so it must not outlive the request: extending the `IScoped`
 * lifetime marker registers it as `scoped`. A singleton here would freeze the first request's
 * `viewerId` for the life of the process — which is exactly what the codegen lifetime-inversion
 * check reports if the marker is removed.
 */
export interface ViewerReadService extends IScoped {
  whoami: () => string;
}
