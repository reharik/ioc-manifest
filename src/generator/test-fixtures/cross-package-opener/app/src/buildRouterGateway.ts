// An APP factory injecting a LIBRARY package's opener, named by the alias that package exports.
// Nothing here reaches the app's own generated output: `@test/lib-router/iocTypes` is another
// package's file, so the app's syntactic interception never sees it — only the KEY has to be known,
// and composition is what knows it.
import type { OpenLibraryRouterScope } from "@test/lib-router/iocTypes";

type RouterGatewayDeps = {
  openLibraryRouterScope: OpenLibraryRouterScope;
};

export type RouterGateway = { readonly serve: (path: string) => string };

export const buildRouterGateway = ({
  openLibraryRouterScope,
}: RouterGatewayDeps): RouterGateway => ({
  serve: (path: string) => {
    const { libraryRouter, dispose } = openLibraryRouterScope({
      requestId: path,
    });
    void dispose;
    return libraryRouter.handle(path);
  },
});
