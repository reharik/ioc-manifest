/**
 * The adoption path, in one edit: a factory GAINS its `ScopeRoot` annotation and a consumer GAINS
 * the opener dep, in the same change, against generated output that predates both.
 *
 * `OpenAuthServiceScope` is imported from a generated file that does not export it yet — it cannot,
 * because the run that will write it is the run reading this file. Resolution therefore has to come
 * from the opener PLAN (the variants discovered on this run), which is the authority the emitter
 * uses anyway.
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

/** The consumer half, naming the alias this generation is about to emit. */
export const buildAuthController = ({
  openAuthServiceScope,
}: AuthControllerDeps): AuthController => ({
  login: (token: string) => {
    const { authService, dispose } = openAuthServiceScope({ requestId: token });
    void dispose;
    return authService.authenticate(token);
  },
});
