import type { Named } from "../../../named/named.js";
import type { Consumer, NotificationStrategy } from "./contracts.js";

/**
 * Door 2, and the most tempting spelling: a member's implementation key plus the FAMILY interface.
 * It reads completely idiomatic — "the email one, as a NotificationStrategy" — and it must be
 * recognized as the group mistake rather than as a strict-identity mismatch, which would tell the
 * reader to write `Named<EmailStrategy>`: a fix that is also illegal.
 */
type Deps = { emailStrategy: Named<NotificationStrategy> };

export const buildNamedBaseConsumer = ({ emailStrategy }: Deps): Consumer => ({
  run: () => emailStrategy.notify("m"),
});
