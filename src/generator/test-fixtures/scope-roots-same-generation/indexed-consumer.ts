/**
 * The same demand, spelled through the cradle, against a cradle that predates the key.
 *
 * `IocGeneratedCradle` itself exists in the stand-in next door; `openAuthServiceScope` is not one of
 * its properties. Reading the key off the source text is what makes that survivable.
 */
import type { IocGeneratedCradle } from "./generated/ioc-registry.types.js";

/** What the indexed-form consumer builds. */
export interface IndexedAuthController {
  login: (token: string) => string;
}

type IndexedAuthControllerDeps = {
  openAuthServiceScope: IocGeneratedCradle["openAuthServiceScope"];
};

export const buildIndexedAuthController = ({
  openAuthServiceScope,
}: IndexedAuthControllerDeps): IndexedAuthController => ({
  login: (token: string) => {
    const { authService, dispose } = openAuthServiceScope({ requestId: token });
    void dispose;
    return authService.authenticate(token);
  },
});
