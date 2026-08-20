/* Stand-in for the LIBRARY package's own generated output, reached by the app through the
package's `./iocTypes` export. This file is generated output of `@test/lib-router`, not of the app —
from the app's vantage it is an ordinary imported type, which is exactly the point of the
cross-package case. */
import type { IRouter } from "../types/IRouter.js";

export interface IocGeneratedCradle {
  openLibraryRouterScope: OpenLibraryRouterScope;
}

/** The opener the library emits for its `libraryRouter` variant. */
export type OpenLibraryRouterScope = (lbv: { requestId: string }) => {
  libraryRouter: IRouter;
  dispose: () => Promise<void>;
};

export interface IocExternals {}

export interface IocScopeProvided {}
