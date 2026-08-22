/** Contracts for the grouped ⇒ group-only fixture set. */

/**
 * The FIELD shape: the group's base is itself the registered contract, and several factories return
 * it. Membership reaches these through the equality-acceptance branch.
 */
export interface DomainEventHandler {
  handle: (event: string) => string;
}

/** SHAPE-1 base: distinct member contracts declare `extends` heritage to it. */
export interface NotificationStrategy {
  notify: (message: string) => string;
}
export interface EmailStrategy extends NotificationStrategy {
  readonly medium: "email";
}
export interface SmsStrategy extends NotificationStrategy {
  readonly medium: "sms";
}

/** Ungrouped control: keeps its contract key and its member keys throughout. */
export interface Consumer {
  run: () => string;
}

/** A second ungrouped consumer contract, so two consumers never contest one contract's slot. */
export interface AuditConsumer {
  run: () => string;
}

/** A `lifetimeMarkers` interface. Grouping is decided by `config.groups` alone — never by this. */
export interface IScopedUnit {}

/** A group base carrying the marker: the ONLY sanctioned place a family's lifetime is declared. */
export interface AuditChannel extends IScopedUnit {
  write: (line: string) => string;
}
export interface FileAuditChannel extends AuditChannel {
  readonly sink: "file";
}
export interface WireAuditChannel extends AuditChannel {
  readonly sink: "wire";
}

/** Ruling 3: extends the marker and nothing else, so it joins no group and keeps its own keys. */
export interface ScopedLoner extends IScopedUnit {
  id: () => string;
}

/** Ruling 2 offender: a member declaring its own marker, which `NotificationStrategy` lacks. */
export interface MarkedStrategy extends NotificationStrategy, IScopedUnit {
  readonly medium: "marked";
}
