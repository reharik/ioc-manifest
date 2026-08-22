import type { Consumer, NotificationStrategy } from "./contracts.js";

/**
 * The natural second guess after learning members have no keys: reach for the CONTRACT key instead.
 * A grouped contract has none either, and without recognition this would drift out as an
 * unsatisfied external in some other package's `ioc validate` run.
 */
type Deps = { notificationStrategy: NotificationStrategy };

export const buildAbsentKeyConsumer = ({
  notificationStrategy,
}: Deps): Consumer => ({
  run: () => notificationStrategy.notify("m"),
});
