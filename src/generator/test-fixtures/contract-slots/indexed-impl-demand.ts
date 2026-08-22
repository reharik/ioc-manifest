import type { RequestPipeline } from "./contracts.js";
import type { IocGeneratedCradle } from "./generated/ioc-registry.types.js";

/**
 * An implementation key demanded through the enumerated `IocGeneratedCradle["key"]` reference form.
 *
 * Exempt from the marker requirement: the property has ALREADY said which cradle key it names, so
 * the ambiguity `Named<T>` exists to remove is not present. Pins the claim-chain exemption.
 */
type IndexedDeps = {
  strictAuthMiddleware: IocGeneratedCradle["strictAuthMiddleware"];
};

export const buildIndexedPipeline = ({
  strictAuthMiddleware,
}: IndexedDeps): RequestPipeline => ({
  run: (path: string) => strictAuthMiddleware.handle(path),
});
