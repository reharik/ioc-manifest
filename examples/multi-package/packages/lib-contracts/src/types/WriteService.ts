/**
 * Shared base type for the cross-package `writeServices` RECORD group.
 *
 * Where `LoggingService` shows a collection — anonymous members a consumer iterates — this shows the
 * other kind: members reachable by key, which is what makes a member able to name a *particular*
 * sibling. Grouped ⇒ group-only, so naming the group is the only way it can.
 */
export interface WriteService {
  readonly writes: string;
}
