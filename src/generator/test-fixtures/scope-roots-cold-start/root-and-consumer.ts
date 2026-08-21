/**
 * COLD START with an opener consumer present: a fresh clone, nothing generated, and a factory that
 * already injects an opener by alias.
 *
 * There is deliberately no `generated/` directory in this fixture, so the import below resolves to
 * nothing at all — the module specifier and the import specifier are the entire evidence available,
 * and one generation has to succeed on that.
 */
import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type { IAuthService } from "./contracts.js";
import type { OpenAuthServiceScope } from "./generated/ioc-registry.types.js";

/** What the consumer builds. */
export interface AuthController {
  login: (token: string) => string;
}

type AuthServiceDeps = { requestId: string };

/** The variant behind the opener: `authService` → `openAuthServiceScope`. */
export const buildAuthService = ({
  requestId,
}: AuthServiceDeps): ScopeRoot<IAuthService, { requestId: string }> => ({
  authenticate: (token: string) => `${requestId}:${token}`,
});

type AuthControllerDeps = { openAuthServiceScope: OpenAuthServiceScope };

export const buildAuthController = ({
  openAuthServiceScope,
}: AuthControllerDeps): AuthController => ({
  login: (token: string) => {
    const { authService, dispose } = openAuthServiceScope({ requestId: token });
    void dispose;
    return authService.authenticate(token);
  },
});
