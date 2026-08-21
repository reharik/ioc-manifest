/**
 * Contracts for the same-generation opener fixtures.
 *
 * A separate directory from `scope-roots/` for one reason: the generated stand-in next door has to
 * PREDATE the scope root, which the shared stand-in cannot (its consumers need the alias to exist).
 */

export interface IAuthService {
  authenticate: (token: string) => string;
}

export interface IClock {
  now: () => number;
}
