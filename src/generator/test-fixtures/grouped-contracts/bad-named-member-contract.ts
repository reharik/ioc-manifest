import type { Named } from "../../../named/named.js";
import type { Consumer, DomainEventHandler } from "./contracts.js";

/** Door 1: `Named<MemberContract>` on a grouped member's registration key. */
type Deps = { alphaHandler: Named<DomainEventHandler> };

export const buildNamedMemberConsumer = ({ alphaHandler }: Deps): Consumer => ({
  run: () => alphaHandler.handle("e"),
});
