import type { Plugin } from "@vendor/yoga";
import type {
  GraphQLContext,
  InitialGraphQLContext,
} from "./graphqlContext.js";

/**
 * The field shape: a local, exported alias whose target is a generic instantiation of a
 * third-party generic. Its expansion is a structural intersection mentioning names the vendor
 * package root does not export and names local to this file.
 */
export type ScopedContainerPlugin = Plugin<
  InitialGraphQLContext | GraphQLContext
>;

export const buildUseScopedContainer = (): ScopedContainerPlugin => ({
  onExecute: () => {},
});
