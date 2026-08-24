/**
 * The fix the refusal prescribes, and the field guide's own example: give the foreign type a local,
 * name-importable declaration and annotate with that. One annotation apart from `appRouter.ts` —
 * same factory, same deps, same registration key — so the pair pins both directions of the rule.
 */
import type Router from "@vendor/router";

export interface AppRouter extends Router {}

export type AppRouterDeps = {
  readonly prefix: string;
};

export const buildAppRouter = ({ prefix }: AppRouterDeps): AppRouter =>
  ({ prefix }) as unknown as AppRouter;
