/**
 * Lifetime marker: everything ranking it resolves per scope.
 *
 * Declared here, next to the group base that carries it, because lifetime is a property of the
 * GROUP — a family whose members are handed out interchangeably cannot have members that disagree
 * about how long they live. See `LoggingService`.
 */
export interface IScoped {}
