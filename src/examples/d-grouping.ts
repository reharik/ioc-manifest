/**
 * Lesson d — groups, and the law that comes with them: **grouped ⇒ group-only.**
 *
 * A contract that is a member of a configured group is consumed through the group and through
 * nothing else. It has no contract key, and its implementations claim no individual cradle keys.
 * That is the symmetric twin of "scope-rooted ⇒ opener-only": both say that a contract has exactly
 * one sanctioned way in, and both exist so a family cannot be half a family.
 *
 * The family below is a RECORD group (`kind: "object"`), which keys its members by contract — so
 * every member is reachable, but through the group value rather than through a cradle key of its
 * own. `buildDispatchService` at the bottom shows the whole consumption pattern.
 *
 * A COLLECTION group (`kind: "collection"`) is the other kind: its members are individually
 * anonymous by declaration, which is the right shape when the consumer wants "all of them" and does
 * not care which is which. The `loggers` group in `examples/multi-package` is one.
 *
 * If you find yourself wanting both — the family for one consumer and one member for another —
 * that is a real scenario, and a deliberately deferred one. See "Consumer-divergent group
 * consumption — considered, deferred" in `docs/design/per-package-manifest.md`.
 */

import type { NotificationChannels } from "../generated/ioc-registry.types.js";

export type CacheClient = {
  get: (k: string) => string | undefined;
};

/** An ordinary, ungrouped contract: it keeps its own cradle key, as every ungrouped contract does. */
export const buildMemoryCache = (): CacheClient => {
  const store = new Map<string, string>();
  return {
    get: (k: string) => store.get(k),
  };
};

/** The group base. Membership is nominal: a contract joins by declaring `extends` heritage to it. */
export interface NotificationChannel {
  deliver: (message: string) => string;
}

/** Member contract one. Single implementation — and still slotless, because grouped outranks that. */
export interface EmailChannel extends NotificationChannel {
  readonly medium: "email";
}

/** Member contract two. */
export interface SmsChannel extends NotificationChannel {
  readonly medium: "sms";
}

export const buildEmailChannel = (): EmailChannel => ({
  medium: "email",
  deliver: (message: string) => `email:${message}`,
});

export const buildSmsChannel = (): SmsChannel => ({
  medium: "sms",
  deliver: (message: string) => `sms:${message}`,
});

/** What the group's consumer builds. */
export type DispatchService = {
  broadcast: (message: string) => readonly string[];
  urgent: (message: string) => string;
};

type DispatchServiceDeps = {
  /**
   * The group, by its root key. This is the ONLY legal way to reach `emailChannel` or `smsChannel`:
   * neither has a cradle key, and `notificationChannel` — the contract key the base would otherwise
   * have had — does not exist either.
   *
   * A record group's value is typed member-by-member, so `.emailChannel` below is as precisely
   * typed as an injected key would have been. That is the trade the two kinds make: `object` keeps
   * per-member access and costs a contract per member; `collection` gives up per-member access and
   * lets one contract have many implementations.
   *
   * Named by the group's emitted type alias — one of the two sanctioned ways to reference a
   * generated type in a deps position (the other is `IocGeneratedCradle["notificationChannels"]`).
   */
  notificationChannels: NotificationChannels;
};

export const buildDispatchService = ({
  notificationChannels,
}: DispatchServiceDeps): DispatchService => ({
  broadcast: (message: string) =>
    Object.values(notificationChannels).map((channel) =>
      channel.deliver(message),
    ),
  // Per-member access — through the group, which is the point of record kind.
  urgent: (message: string) => notificationChannels.emailChannel.deliver(message),
});
