/**
 * The same demand, in a deps type the developer COMPOSED rather than wrote as one member list.
 *
 * An intersection has no single member list to read, so the opener's written type node is reachable
 * only through the property's own declaration. Missing it does not merely lose a syntactic claim —
 * it hands the property to the checker, which is where a not-yet-emitted opener alias becomes
 * "references an unresolvable deps type". This is the shape the consuming-app migration hit.
 */
import type { Named } from "../../../named/named.js";
import type { IClock } from "./contracts.js";
import type { OpenAuthServiceScope } from "./generated/ioc-registry.types.js";

/** What the composed-deps consumer builds. */
export interface ComposedController {
  login: (token: string) => string;
}

export const buildAuditClock = (): IClock => ({ now: () => 0 });

type BaseDeps = { auditClock: Named<IClock> };

type ComposedControllerDeps = BaseDeps & {
  openAuthServiceScope: OpenAuthServiceScope;
};

export const buildComposedController = ({
  auditClock,
  openAuthServiceScope,
}: ComposedControllerDeps): ComposedController => ({
  login: (token: string) => {
    const { authService, dispose } = openAuthServiceScope({ requestId: token });
    void dispose;
    return `${auditClock.now()}:${authService.authenticate(token)}`;
  },
});
