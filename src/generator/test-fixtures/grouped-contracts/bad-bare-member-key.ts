import type { Consumer, EmailStrategy } from "./contracts.js";

/**
 * Door 3: the bare member-key demand. Routed to the grouped error rather than to
 * `named-marker-required`, whose advice — "add `Named<>`" — would name an illegal fix.
 */
type Deps = { emailStrategy: EmailStrategy };

export const buildBareMemberConsumer = ({ emailStrategy }: Deps): Consumer => ({
  run: () => emailStrategy.notify("m"),
});
