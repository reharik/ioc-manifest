/* Deliberately STALE stand-in for the prior generated output of the scope-root fixtures.

Nothing here is read by generation — every reference to it is claimed syntactically — but the
fixtures that name an opener alias have to compile, and this is the file they name. `StaleRouter` is
the tell: it is supplied by no fixture factory, so seeing it in an analysis result means a reference
was resolved out of prior output instead of claimed.
*/

export interface StaleRouter {
  handle: (path: string) => string;
}

export interface IocGeneratedCradle {
  openConsumedRouterScope: OpenConsumedRouterScope;
  staleRouter: StaleRouter;
}

/** The opener alias for the `consumedRouter` variant in `opener-consumer.ts`. */
export type OpenConsumedRouterScope = (lbv: { requestId: string }) => {
  consumedRouter: StaleRouter;
  dispose: () => Promise<void>;
};
