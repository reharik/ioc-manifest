/**
 * The breach, verbatim: a factory annotated with a foreign type that the package exposes only as
 * its default export. The contract resolves to the literal name `default` — which is a reserved
 * word, not an importable binding — and every layer downstream carries it: the discovery row, the
 * emitted `import type { default }`, the cradle property.
 */
import Router from "@vendor/router";

export type AppRouterDeps = {
  readonly prefix: string;
};

export const buildAppRouter = ({ prefix }: AppRouterDeps): Router =>
  ({ prefix }) as unknown as Router;
