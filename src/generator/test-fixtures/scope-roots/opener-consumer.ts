/**
 * The consumer half of stage 3a: a variant, plus two ordinary factories that INJECT its opener.
 *
 * Both sanctioned deps spellings appear, on purpose — the alias (`OpenConsumedRouterScope`) and the
 * indexed access (`IocGeneratedCradle["openConsumedRouterScope"]`). They must resolve to the same
 * opener key, and neither may be read member-by-member: the opener is a handle, carried by name.
 */
import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type { IRequestRouter } from "./deps-contracts.js";
import type {
  IocGeneratedCradle,
  OpenConsumedRouterScope,
} from "./generated/ioc-registry.types.js";

/** What the alias-form consumer builds. */
export interface AliasGateway {
  serve: (path: string) => string;
}

/** What the indexed-form consumer builds. */
export interface IndexedGateway {
  serve: (path: string) => string;
}

type ConsumedRouterDeps = { requestId: string };

/** The variant behind the opener: `consumedRouter` → `openConsumedRouterScope`. */
export const buildConsumedRouter = ({
  requestId,
}: ConsumedRouterDeps): ScopeRoot<IRequestRouter, { requestId: string }> => ({
  handle: (path: string) => `${requestId}:${path}`,
});

type AliasGatewayDeps = { openConsumedRouterScope: OpenConsumedRouterScope };

/** The primary consumer pattern: the opener injected under its own key, named by its alias. */
export const buildAliasGateway = ({
  openConsumedRouterScope,
}: AliasGatewayDeps): AliasGateway => ({
  serve: (path: string) => {
    const { consumedRouter, dispose } = openConsumedRouterScope({
      requestId: path,
    });
    void dispose;
    return consumedRouter.handle(path);
  },
});

type IndexedGatewayDeps = {
  openConsumedRouterScope: IocGeneratedCradle["openConsumedRouterScope"];
};

/** The same demand, spelled through the cradle. Same key, same handling. */
export const buildIndexedGateway = ({
  openConsumedRouterScope,
}: IndexedGatewayDeps): IndexedGateway => ({
  serve: (path: string) => {
    const { consumedRouter, dispose } = openConsumedRouterScope({
      requestId: path,
    });
    void dispose;
    return consumedRouter.handle(path);
  },
});
